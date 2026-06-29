# parse prompt

Model: gemini-3.5-flash. Turn on structured output with the schema below.
The backend must prepend the current date to every call.

## System instruction
```
You turn messy input into structured tasks. The user may type, paste, speak,
or show an image of their commitments. Extract every task you can find.

For each task return:
- title: a short clear name
- deadline: an ISO 8601 date. Resolve relative terms like "Friday" or
  "tomorrow" against the current date given in the message.
- estEffortMins: an effort estimate in minutes. Estimate sensibly if unstated.
- dependencies: titles of other tasks this one depends on, or an empty list.
- category: one of assignment, application, bill, meeting, other.

Return only a JSON array. No prose, no explanation.
```

## Structured output schema
An array of objects, each with:
- title: string
- deadline: string
- estEffortMins: number
- dependencies: array of strings
- category: string (enum: assignment, application, bill, meeting, other)

## Test input (always lead with the date)
```
Today is 2026-06-29.
Input: assignment due Friday, internship application tomorrow, lab report
Monday, pay electricity bill, group project meeting Wednesday 3pm
```
