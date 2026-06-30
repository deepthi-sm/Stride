# counterfactual prompt (simulator and rescue)

Model: gemini-2.5-flash-lite. Two Gemini calls wrap a code core. Half A reads the
what-if and returns concrete changes. Code applies them to a copy of the task
graph and recomputes buildSchedule and assessRisk. Half B narrates the before
and after. The backend prepends the current date to every call.

## Half A — turn the what-if into concrete changes

System instruction:
```
You convert one free-form what-if question about a plan into concrete changes to
specific tasks. You are given the current tasks (titles, deadlines, effort) and
the question. Return only the changes the question implies, nothing more.

Each change targets one task by its exact title and is one of:
- delay_days: push the task's deadline later by value days.
- set_effort_mins: set the task's estimated effort to value minutes.
- move_last: do this task after everything else (value is 0).
- remove: drop the task entirely (value is 0).

Use task titles exactly as given. If the question names no real task, return an
empty list. Do not invent tasks and do not explain.
```

Half A schema:
```json
{
  "type": "ARRAY",
  "items": {
    "type": "OBJECT",
    "properties": {
      "type": {
        "type": "STRING",
        "enum": ["delay_days", "set_effort_mins", "move_last", "remove"]
      },
      "targetTitle": { "type": "STRING" },
      "value": { "type": "INTEGER" }
    },
    "required": ["type", "targetTitle", "value"],
    "propertyOrdering": ["type", "targetTitle", "value"]
  }
}
```

## Half B — narrate the cascade

System instruction:
```
You explain what changed in a plan, in plain calm language. You are given the
before and after: the schedule, the risk band, and which tasks moved or are now
at risk. Describe the cascade, for example this task slipped, which pushed that
one past its deadline, in at most three short sentences. Then give exactly one
clear recommendation.

Do not invent numbers, use only what you are given. No em dashes. Do not use the
words leverage, utilize, seamless, robust, real-time, or end-to-end.
```

Half B schema:
```json
{
  "type": "OBJECT",
  "properties": {
    "cascade": {
      "type": "ARRAY",
      "items": { "type": "STRING" }
    },
    "recommendation": { "type": "STRING" }
  },
  "required": ["cascade", "recommendation"],
  "propertyOrdering": ["cascade", "recommendation"]
}
```

## Rescue (empty question)

When the question is empty this is a system rescue, not a simulation. Use
profile.rescueStrategy to decide the move, then narrate it with the same Half B
cascade-and-recommendation shape:
- rebuild: re-plan from now, resequencing what is left into the time available.
- protect: shield the single most important task and let lower ones slip.
- suggest_drop: name the one task to drop to save the rest.
- draft_message: write a short message to buy time, such as an extension request,
  and place that message in the recommendation.
