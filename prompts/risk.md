# risk prompt and scoring

The SCORE is computed in code, deterministic and transparent. Gemini only writes
the short human explanation. Never a fake probability.

## Scoring (in code, riskScore 0-100)
Each factor is normalized to 0-1, then combined with its weight and scaled to
0-100:
- urgency: how close the deadline is. Due today or overdue is 1, seven or more
  days out is 0.
- effortPressure: effort remaining divided by the free focus time before the
  deadline. At or over 1 means there is not enough time, which is high.
- dependencyPressure: how many other tasks depend on this one finishing.
- staleness: days since lastTouchedAt, longer is higher.
- patternPenalty: from the profile. Raise for a last_minute or close
  deadlineStyle, and for slowdowns that match the task (overwhelmed for big
  tasks, avoid_starting for not-yet-started tasks, forgetful for bills and
  admin).

Weights (tuned from the suggested baseline so a near deadline with high effort
left reaches the high band on its own):
- urgency 0.35
- effortPressure 0.35
- dependencyPressure 0.10
- staleness 0.10
- patternPenalty 0.10

Bands: 0-39 low, 40-64 medium, 65-84 high, 85-100 critical.

Trigger (the router, in precedence order):
- rescue: a task is marked slipping.
- ghost_mode: a task is stale with effort still remaining.
- simulate_ready: two or more tasks collide for the same focus time.
- none: nothing pressing.

## System instruction (narration only)
```
You explain task risk in plain, calm language. You are given a list of tasks
with their already-computed risk factors, scores, and bands. Write the real
bottlenecks and any conflict chains, for example task A is late, which pushes
task B. Keep it to at most three short sentences total across both lists.

Rules:
- Do not invent numbers or recompute the score. Use only what you are given.
- Name actual task titles. Be specific about what is tight and why.
- A bottleneck is a single task carrying the most pressure. A conflict chain is
  two or more tasks competing for the same time or blocked on each other.
- Plain voice. No em dashes. Do not use the words leverage, utilize, seamless,
  robust, real-time, or end-to-end.
```

Return a JSON object that matches this schema:

```json
{
  "type": "OBJECT",
  "properties": {
    "bottlenecks": {
      "type": "ARRAY",
      "items": { "type": "STRING" }
    },
    "conflictChains": {
      "type": "ARRAY",
      "items": { "type": "STRING" }
    }
  },
  "required": ["bottlenecks", "conflictChains"],
  "propertyOrdering": ["bottlenecks", "conflictChains"]
}
```
