// buildSchedule(tasks, profile, signals) -> { scheduledBlocks, tradeoffs, atRisk }
//
// This is a transparent heuristic, computed entirely in code. It does NOT call
// Gemini. It orders tasks by deadline proximity then effort, packs them into
// daily focus blocks placed in the user's productivity window, and explains the
// choices it made in plain language.

const WINDOW_START_HOUR = {
  early_morning: 6,
  afternoon: 13,
  evening: 18,
  late_night: 22,
  varies: 9,
};

const WINDOW_LABEL = {
  early_morning: 'early morning',
  afternoon: 'afternoon',
  evening: 'evening',
  late_night: 'late night',
  varies: 'your best hours',
};

// Sensible defaults used when there is no profile yet.
const DEFAULT_PROFILE = {
  role: 'other',
  productivityWindow: 'varies',
  deadlineStyle: 'on_time',
  slowdowns: [],
  slips: 'none',
  rescueStrategy: 'rebuild',
};

// How much focused work we schedule into one day. Exported so the risk brain
// can measure free time before a deadline the same way the schedule does.
export const DAILY_FOCUS_MINS = 240;
const DEFAULT_EFFORT = 60; // used when a task has no effort estimate

// --- small date helpers, all in local YYYY-MM-DD terms ---
// We stay in the local calendar throughout and never go through toISOString,
// which is UTC and would roll the date back a day in positive-offset timezones.
// A few are exported so other modules reuse the exact same date math.

function pad(n) {
  return String(n).padStart(2, '0');
}

function isoLocal(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseIso(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function isoDate(d) {
  return isoLocal(d);
}

// Today as a local YYYY-MM-DD string.
export function todayIso() {
  return isoLocal(new Date());
}

export function addDays(iso, days) {
  const d = parseIso(iso);
  d.setDate(d.getDate() + days);
  return isoLocal(d);
}

// Whole days from one ISO date to another. Negative means already past.
export function daysUntil(fromIso, toIso) {
  const a = parseIso(fromIso).getTime();
  const b = parseIso(toIso).getTime();
  return Math.round((b - a) / 86400000);
}

// A clock time HH:MM, given the window start hour and minutes already used today.
function clock(startHour, minutesIntoDay) {
  const total = startHour * 60 + minutesIntoDay;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function prettyDate(iso) {
  return parseIso(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

function prettyHours(mins) {
  const m = mins || DEFAULT_EFFORT;
  if (m < 60) return `${m} minutes`;
  const h = Math.round((m / 60) * 10) / 10;
  return h === 1 ? '1 hour' : `${h} hours`;
}

// A day on or before today means "today" for scheduling purposes.
function relativeDay(iso, todayIso) {
  if (iso === todayIso) return 'today';
  if (iso === addDays(todayIso, 1)) return 'tomorrow';
  return prettyDate(iso);
}

export function buildSchedule(tasks, profile, signals) {
  const p = { ...DEFAULT_PROFILE, ...(profile || {}) };
  const window = WINDOW_START_HOUR[p.productivityWindow] != null ? p.productivityWindow : 'varies';
  const startHour = WINDOW_START_HOUR[window];
  const hasProfile = Boolean(profile && profile.productivityWindow);

  const todayIso = isoDate(new Date());

  // Only schedule work that is still open.
  const active = (Array.isArray(tasks) ? tasks : []).filter((t) => t && t.status !== 'done');

  // Order: soonest deadline first, then the bigger task first so it gets runway.
  // Tasks with no deadline fall to the back, ordered by effort.
  const ordered = [...active].sort((a, b) => {
    const da = a.deadline ? daysUntil(todayIso, a.deadline) : Infinity;
    const db = b.deadline ? daysUntil(todayIso, b.deadline) : Infinity;
    if (da !== db) return da - db;
    return (b.estEffortMins || DEFAULT_EFFORT) - (a.estEffortMins || DEFAULT_EFFORT);
  });

  // Pack each task into daily focus blocks, splitting a task across days when it
  // does not fit in what is left of the current day.
  const scheduledBlocks = [];
  let dayOffset = 0;
  let dayRemaining = DAILY_FOCUS_MINS;

  for (const task of ordered) {
    let effort = task.estEffortMins || DEFAULT_EFFORT;
    while (effort > 0) {
      if (dayRemaining <= 0) {
        dayOffset += 1;
        dayRemaining = DAILY_FOCUS_MINS;
      }
      const chunk = Math.min(effort, dayRemaining);
      const usedToday = DAILY_FOCUS_MINS - dayRemaining;
      const date = addDays(todayIso, dayOffset);
      scheduledBlocks.push({
        taskId: task.id,
        title: task.title,
        category: task.category,
        date,
        window,
        start: clock(startHour, usedToday),
        end: clock(startHour, usedToday + chunk),
        durationMins: chunk,
      });
      effort -= chunk;
      dayRemaining -= chunk;
    }
  }

  // The date a task is scheduled to finish is the date of its last block.
  const finishDate = {};
  for (const b of scheduledBlocks) finishDate[b.taskId] = b.date;

  // At risk: the plan cannot finish it on or before its deadline.
  const atRisk = [];
  for (const task of ordered) {
    if (!task.deadline) continue;
    const finish = finishDate[task.id];
    if (!finish) continue;
    // ISO date strings compare correctly with <, >.
    if (finish > task.deadline) {
      const overdue = daysUntil(todayIso, task.deadline) < 0;
      atRisk.push({
        taskId: task.id,
        title: task.title,
        reason: overdue
          ? `The ${prettyDate(task.deadline)} deadline has already passed, so this needs attention first.`
          : `There is not enough focus time before ${prettyDate(task.deadline)}. As planned it wraps up ${relativeDay(finish, todayIso)}.`,
      });
    }
  }

  // Plain-language tradeoffs, built from the actual ordering and splits.
  const tradeoffs = [];

  if (ordered.length >= 2) {
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    if (first.id !== last.id) {
      tradeoffs.push(
        `${first.title} is closest to its deadline, so it takes today's first focus time and ${last.title} waits until ${relativeDay(finishDate[last.id], todayIso)}.`
      );
    }
  }

  for (const task of ordered) {
    const dates = [...new Set(scheduledBlocks.filter((b) => b.taskId === task.id).map((b) => b.date))];
    if (dates.length > 1) {
      tradeoffs.push(
        `${task.title} needs about ${prettyHours(task.estEffortMins)}, more than one day of focus holds, so it is split across ${relativeDay(dates[0], todayIso)} and ${relativeDay(dates[dates.length - 1], todayIso)}.`
      );
    }
  }

  if (atRisk.length === 1) {
    tradeoffs.push(`${atRisk[0].title} is the one to watch. ${atRisk[0].reason}`);
  } else if (atRisk.length > 1) {
    tradeoffs.push(
      `${atRisk.length} tasks cannot fit before their deadlines at the current pace, so they are flagged at risk.`
    );
  }

  tradeoffs.push(
    hasProfile
      ? `Work is placed in ${WINDOW_LABEL[window]} because that is when you said you focus best.`
      : `No best hours are set yet, so work starts mid morning by default. Set your hours and the plan moves with you.`
  );

  return { scheduledBlocks, tradeoffs, atRisk };
}
