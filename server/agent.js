// Agent tools that call Gemini. Module 1 ships parseTasks; later modules add
// assessRisk, buildSchedule, runAction, and counterfactualPlan here.
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
const PARSE_PROMPT_PATH = join(__dirname, '..', 'prompts', 'parse.md');

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

// prompts/parse.md holds both the system instruction (prose) and the JSON
// schema (a fenced ```json block). Read once, split into the two pieces.
let parsePrompt = null;
function loadParsePrompt() {
  if (parsePrompt) return parsePrompt;
  const file = readFileSync(PARSE_PROMPT_PATH, 'utf8');
  const fence = file.match(/```json\s*([\s\S]*?)```/i);
  if (!fence) {
    throw new Error('prompts/parse.md is missing its ```json schema block');
  }
  const schema = JSON.parse(fence[1]);
  // System instruction is everything except the schema fence.
  const systemInstruction = file.replace(fence[0], '').trim();
  parsePrompt = { systemInstruction, schema };
  return parsePrompt;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// parseTasks(text) -> [ { title, deadline, estEffortMins, dependencies[], category } ]
// The current date is injected so relative deadlines like "Friday" resolve.
export async function parseTasks(text) {
  const { systemInstruction, schema } = loadParsePrompt();

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
