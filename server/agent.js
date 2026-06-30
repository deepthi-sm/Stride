// Agent tools that call Gemini. Module 1 ships parseTasks; Module 2 adds
// breakDownTask. Later modules add assessRisk, runAction, and counterfactualPlan
// here. buildSchedule lives in schedule.js because it is pure code, no Gemini.
//
// Only the backend ever calls Gemini. We use the official @google/genai SDK
// with the key from process.env.GEMINI_API_KEY. We do NOT use the legacy
// generativelanguage REST endpoint with a ?key= parameter.

import { GoogleGenAI } from '@google/genai';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODEL = 'gemini-3.5-flash';
const PROMPTS_DIR = join(__dirname, '..', 'prompts');
const PARSE_PROMPT_PATH = join(PROMPTS_DIR, 'parse.md');
const BREAKDOWN_PROMPT_PATH = join(PROMPTS_DIR, 'breakdown.md');
const RISK_PROMPT_PATH = join(PROMPTS_DIR, 'risk.md');
const COUNTERFACTUAL_PROMPT_PATH = join(PROMPTS_DIR, 'counterfactual.md');

let ai = null;
function client() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set. Add it to the project-root .env');
  }
  if (!ai) {
    ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return ai;
}

// A prompt file holds both the system instruction (prose) and the JSON schema
// (a fenced ```json block). Read once, split into the two pieces, and cache.
const promptCache = new Map();
function loadPrompt(path) {
  if (promptCache.has(path)) return promptCache.get(path);
  const file = readFileSync(path, 'utf8');
  const fence = file.match(/```json\s*([\s\S]*?)```/i);
  if (!fence) {
    throw new Error(`${path} is missing its \`\`\`json schema block`);
  }
  const schema = JSON.parse(fence[1]);
  // System instruction is everything except the schema fence.
  const systemInstruction = file.replace(fence[0], '').trim();
  const loaded = { systemInstruction, schema };
  promptCache.set(path, loaded);
  return loaded;
}

// counterfactual.md is special: it holds TWO halves, each with its own plain
// instruction block and its own ```json schema, plus a rescue section. Parse it
// into { halfA, halfB, rescue } once and cache.
let counterfactualPrompt = null;
function fencedBlocks(text) {
  const re = /```(\w*)\n([\s\S]*?)```/g;
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ lang: m[1] || '', body: m[2].trim() });
  }
  return out;
}
function loadCounterfactualPrompt() {
  if (counterfactualPrompt) return counterfactualPrompt;
  const file = readFileSync(COUNTERFACTUAL_PROMPT_PATH, 'utf8');
  const sections = file.split(/^## /m);
  const section = (kw) => sections.find((s) => s.toLowerCase().startsWith(kw)) || '';

  const extractHalf = (text, name) => {
    const blocks = fencedBlocks(text);
    const sys = blocks.find((b) => b.lang !== 'json');
    const schemaBlock = blocks.find((b) => b.lang === 'json');
    if (!sys || !schemaBlock) {
      throw new Error(`counterfactual.md: ${name} is missing its instruction or schema block`);
    }
    return { systemInstruction: sys.body, schema: JSON.parse(schemaBlock.body) };
  };

  const rescueText = section('rescue').replace(/^[^\n]*\n/, '').trim();
  counterfactualPrompt = {
    halfA: extractHalf(section('half a'), 'Half A'),
    halfB: extractHalf(section('half b'), 'Half B'),
    rescue: rescueText,
  };
  return counterfactualPrompt;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// parseTasks(text) -> [ { title, deadline, estEffortMins, dependencies[], category } ]
// The current date is injected so relative deadlines like "Friday" resolve.
export async function parseTasks(text) {
  const { systemInstruction, schema } = loadPrompt(PARSE_PROMPT_PATH);

  const response = await client().models.generateContent({
    model: MODEL,
    contents: `Current date: ${today()}\n\nInput to parse:\n${text}`,
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: schema,
      temperature: 0,
    },
  });

  const raw = (response.text || '').trim();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Model did not return valid JSON for parseTasks');
  }
  return Array.isArray(parsed) ? parsed : [];
}

// breakDownTask(task) -> { subtasks: string[] }
// Turns one task into a few concrete first steps so the user can start without
// thinking. The current date is injected so any deadline context is grounded.
export async function breakDownTask(task) {
  const { systemInstruction, schema } = loadPrompt(BREAKDOWN_PROMPT_PATH);

  const details = [
    `Title: ${task.title}`,
    `Category: ${task.category || 'other'}`,
    task.deadline ? `Deadline: ${task.deadline}` : 'Deadline: none',
    task.estEffortMins ? `Estimated effort: ${task.estEffortMins} minutes` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const response = await client().models.generateContent({
    model: MODEL,
    contents: `Current date: ${today()}\n\nBreak down this task into first steps:\n${details}`,
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: schema,
      temperature: 0.2,
    },
  });

  const raw = (response.text || '').trim();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Model did not return valid JSON for breakDownTask');
  }
  const subtasks = Array.isArray(parsed?.subtasks)
    ? parsed.subtasks.map((s) => String(s).trim()).filter(Boolean)
    : [];
  return { subtasks };
}

// narrateRisk(context) -> { bottlenecks: string[], conflictChains: string[] }
// The score and factors are already computed in code. Gemini only turns them
// into a short, calm, plain-language read. The caller wraps this in try/catch so
// risk still works when Gemini is down; on any trouble we throw and the caller
// falls back to the code-computed text.
export async function narrateRisk(context) {
  const { systemInstruction, schema } = loadPrompt(RISK_PROMPT_PATH);

  const response = await client().models.generateContent({
    model: MODEL,
    contents: `Current date: ${today()}\n\nComputed risk to explain:\n${JSON.stringify(context, null, 2)}`,
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: schema,
      temperature: 0.2,
    },
  });

  const raw = (response.text || '').trim();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Model did not return valid JSON for narrateRisk');
  }
  const clean = (arr) =>
    Array.isArray(arr) ? arr.map((s) => String(s).trim()).filter(Boolean) : [];
  return {
    bottlenecks: clean(parsed?.bottlenecks),
    conflictChains: clean(parsed?.conflictChains),
  };
}

const CHANGE_ENUM = new Set(['delay_days', 'set_effort_mins', 'move_last', 'remove']);

// proposeChanges(tasks, question) -> [ { type, targetTitle, value } ]
// Half A: turn one free-form what-if into concrete changes. The caller wraps
// this in try/catch; on any trouble it falls back to an empty change list.
export async function proposeChanges(tasks, question) {
  const { halfA } = loadCounterfactualPrompt();

  const taskLines = tasks
    .map((t) => `- ${t.title} (deadline ${t.deadline || 'none'}, ${t.estEffortMins || '?'} min)`)
    .join('\n');

  const response = await client().models.generateContent({
    model: MODEL,
    contents: `Current date: ${today()}\n\nCurrent tasks:\n${taskLines}\n\nWhat-if question:\n${question}`,
    config: {
      systemInstruction: halfA.systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: halfA.schema,
      temperature: 0,
    },
  });

  const raw = (response.text || '').trim();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Model did not return valid JSON for proposeChanges');
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((c) => c && CHANGE_ENUM.has(c.type) && typeof c.targetTitle === 'string')
    .map((c) => ({
      type: c.type,
      targetTitle: c.targetTitle.trim(),
      value: Number.isFinite(c.value) ? c.value : 0,
    }));
}

// narrateCounterfactual(context, guidance) -> { cascade: string[], recommendation }
// Half B: explain the before and after in plain language. guidance is appended
// to the system instruction for the rescue framing. Caller wraps in try/catch.
export async function narrateCounterfactual(context, guidance = '') {
  const { halfB } = loadCounterfactualPrompt();
  const systemInstruction = guidance
    ? `${halfB.systemInstruction}\n\n${guidance}`
    : halfB.systemInstruction;

  const response = await client().models.generateContent({
    model: MODEL,
    contents: `Current date: ${today()}\n\nBefore and after to explain:\n${JSON.stringify(context, null, 2)}`,
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: halfB.schema,
      temperature: 0.3,
    },
  });

  const raw = (response.text || '').trim();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Model did not return valid JSON for narrateCounterfactual');
  }
  const cascade = Array.isArray(parsed?.cascade)
    ? parsed.cascade.map((s) => String(s).trim()).filter(Boolean)
    : [];
  const recommendation = parsed?.recommendation ? String(parsed.recommendation).trim() : '';
  return { cascade, recommendation };
}

// Expose the rescue instruction text from the prompt so the engine can pass it
// to Gemini as guidance for the rescue framing.
export function rescueGuidance() {
  return loadCounterfactualPrompt().rescue;
}
