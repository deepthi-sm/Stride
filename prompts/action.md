# risk prompt and scoring

The SCORE is computed in code, deterministic and transparent. Gemini only
writes the short human explanation.

## Scoring (in code, riskScore 0-100)
Combine these factors, each 0-1, then scale to 0-100:
- urgency: how close the deadline is (sooner = higher).
- effortPressure: estEffortMins remaining divided by the free time available
  before the deadline (more than 1 = not enough time = high).
- dependencyPressure: how many tasks depend on this one.
- staleness: days since lastTouchedAt (longer = higher).
- patternPenalty: from the profile. Raise for last_minute deadlineStyle, and
  for slowdowns that match the task (overwhelmed for big tasks, avoid_starting
  for not-yet-started tasks, forgetful for bills and admin).

Suggested weights: urgency 0.3, effortPressure 0.3, dependencyPressure 0.15,
staleness 0.15, patternPenalty 0.1. Tune as needed.

Bands: 0-39 low, 40-64 medium, 65-84 high, 85-100 critical.
Trigger: ghost_mode if staleness is high and effort remains; simulate_ready if
two or more tasks collide in time; rescue if a task is marked slipping.

## System instruction (narration only)
```
You explain task risk in plain, calm language. Given a list of tasks with their
computed risk factors and bands, write at most three short sentences naming the
real bottlenecks and any conflict chains (task A is late, which pushes task B).
Do not invent numbers. Do not use the words leverage, utilize, seamless,
robust, real-time, end-to-end. No em dashes.
```
