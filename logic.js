/*
 * Pure scoring/streak/badge logic for Dial, kept dependency-free so it can be
 * loaded both as a plain browser <script> (window.DialLogic) and required
 * from Node test files (module.exports) without a build step.
 */
(function (root) {
  "use strict";

  const MODES = ["focus", "short", "long", "custom"];

  const MODE_LABELS = {
    focus: "Focus",
    short: "Short Break",
    long: "Long Break",
    custom: "Custom",
  };

  /** Mode -> the settings key holding its duration. Custom is per-session, so it has none. */
  const MODE_SETTING_KEYS = {
    focus: "focusMinutes",
    short: "shortMinutes",
    long: "longMinutes",
  };

  const ALARM_SOUNDS = ["chime", "bell", "pulse", "none"];

  const ACCENT_REWARDS = [
    { id: "brass", label: "Brass", level: 1 },
    { id: "copper", label: "Copper", level: 2 },
    { id: "jade", label: "Jade", level: 3 },
    { id: "cobalt", label: "Cobalt", level: 4 },
    { id: "amethyst", label: "Amethyst", level: 5 },
  ];

  const DEFAULT_SETTINGS = {
    focusMinutes: 25,
    shortMinutes: 5,
    longMinutes: 15,
    dailyGoal: 8,
    autoStart: false,
    notify: true,
    alarmSound: "chime",
    alarmVolume: 0.6,
    accent: "brass",
    focusGuard: false,
    blockedApps: "Slack, Discord, Music",
  };

  const BADGE_DEFS = [
    { id: "first_sprint", label: "First Sprint", icon: "①" },
    { id: "streak_5", label: "5-Day Streak", icon: "🔥" },
    { id: "streak_10", label: "10-Day Streak", icon: "⚡" },
    { id: "six_in_day", label: "6 in One Day", icon: "☰" },
    { id: "level_5", label: "Level 5", icon: "★" },
    { id: "before_7am", label: "Before 7am", icon: "☀" },
    { id: "fifty_sessions", label: "50 Sessions", icon: "◈" },
  ];

  /* 2,000 compact entries fit comfortably in localStorage and keep a truthful
     30-day view even for someone completing the maximum 24-session goal daily. */
  const MAX_LOGGED_SESSIONS = 2000;
  const MAX_TODOS = 100;

  function todayStr(d) {
    d = d || new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function xpForLevel(level) {
    return 100 + (level - 1) * 40;
  }

  /** Applies `amount` XP to {xp, level}, rolling overflow into further levels. Pure — returns a new object. */
  function applyXp(xp, level, amount) {
    let nextXp = xp + amount;
    let nextLevel = level;
    while (nextXp >= xpForLevel(nextLevel)) {
      nextXp -= xpForLevel(nextLevel);
      nextLevel += 1;
    }
    return { xp: nextXp, level: nextLevel };
  }

  function streakBonus(currentStreak) {
    return Math.min(currentStreak * 2, 20);
  }

  function focusSessionXp(currentStreak) {
    return 20 + streakBonus(currentStreak);
  }

  function daysBetween(a, b) {
    const [ay, am, ad] = a.split("-").map(Number);
    const [by, bm, bd] = b.split("-").map(Number);
    const da = new Date(ay, am - 1, ad);
    const db = new Date(by, bm - 1, bd);
    return Math.round((db - da) / 86400000);
  }

  /**
   * Computes the next current streak given the last date a focus session was
   * completed on and today's date. Pure — does not touch longestStreak.
   */
  function nextStreak(lastSessionDate, currentStreak, today) {
    if (lastSessionDate === today) return currentStreak;
    if (lastSessionDate === null || lastSessionDate === undefined) return 1;
    const gap = daysBetween(lastSessionDate, today);
    return gap === 1 ? currentStreak + 1 : 1;
  }

  /** Every 4th completed focus session (lifetime) is followed by a long break. */
  function nextBreakMode(totalFocusSessionsCompleted) {
    return totalFocusSessionsCompleted % 4 === 0 ? "long" : "short";
  }

  /** Custom errands always receive a short break; only focus sessions advance the long-break cadence. */
  function nextModeAfterWork(completedMode, focusSessionsCompleted) {
    return completedMode === "focus" ? nextBreakMode(focusSessionsCompleted) : "short";
  }

  function isAccentUnlocked(accent, level) {
    const reward = ACCENT_REWARDS.find((item) => item.id === accent);
    return !!reward && level >= reward.level;
  }

  function nextAccentReward(level) {
    return ACCENT_REWARDS.find((item) => item.level > level) || null;
  }

  /**
   * Returns a new badges object (existing badges preserved) with any newly
   * met conditions set to true. `ctx.startHour` is optional (0-23, local time).
   */
  function evaluateBadges(existingBadges, ctx) {
    const b = Object.assign({}, existingBadges);
    if (ctx.totalSessions >= 1) b.first_sprint = true;
    if (ctx.longestStreak >= 5) b.streak_5 = true;
    if (ctx.longestStreak >= 10) b.streak_10 = true;
    if (ctx.todayCount >= 6) b.six_in_day = true;
    if (ctx.level >= 5) b.level_5 = true;
    if (typeof ctx.startHour === "number" && ctx.startHour < 7) b.before_7am = true;
    if (ctx.totalSessions >= 50) b.fifty_sessions = true;
    return b;
  }

  function formatTime(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  }

  /** Trims a sessions log array (newest-first) down to the retention cap. */
  function capSessions(sessions) {
    return sessions.length > MAX_LOGGED_SESSIONS ? sessions.slice(0, MAX_LOGGED_SESSIONS) : sessions;
  }

  /** Rounds and clamps to a whole number within [min, max]. Non-numeric input falls back to min. */
  function clampInt(value, min, max) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  /** Rounds and clamps a custom-duration input to a whole number of minutes within [min, max]. Non-numeric input falls back to min. */
  function clampMinutes(value, min, max) {
    return clampInt(value, typeof min === "number" ? min : 1, typeof max === "number" ? max : 120);
  }

  /** Trims a to-do list (newest-first) down to the retention cap. */
  function capTodos(todos) {
    return todos.length > MAX_TODOS ? todos.slice(0, MAX_TODOS) : todos;
  }

  /**
   * Coerces a stored settings blob into a complete, in-range settings object.
   * Anything missing, out of range, or unrecognised falls back to its default,
   * so a hand-edited or older localStorage payload can't break the timer.
   */
  function normalizeSettings(stored) {
    const s = Object.assign({}, DEFAULT_SETTINGS, stored || {});
    return {
      focusMinutes: clampInt(s.focusMinutes, 1, 120),
      shortMinutes: clampInt(s.shortMinutes, 1, 60),
      longMinutes: clampInt(s.longMinutes, 1, 60),
      dailyGoal: clampInt(s.dailyGoal, 1, 24),
      autoStart: !!s.autoStart,
      notify: !!s.notify,
      alarmSound: ALARM_SOUNDS.indexOf(s.alarmSound) >= 0 ? s.alarmSound : DEFAULT_SETTINGS.alarmSound,
      alarmVolume: clampVolume(s.alarmVolume),
      accent: ACCENT_REWARDS.some((item) => item.id === s.accent) ? s.accent : DEFAULT_SETTINGS.accent,
      focusGuard: !!s.focusGuard,
      blockedApps: typeof s.blockedApps === "string"
        ? s.blockedApps.trim().slice(0, 240)
        : DEFAULT_SETTINGS.blockedApps,
    };
  }

  /** Clamps an alarm volume to [0, 1], rounded to two decimals. */
  function clampVolume(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return DEFAULT_SETTINGS.alarmVolume;
    return Math.min(1, Math.max(0, Math.round(n * 100) / 100));
  }

  /** Parses a "YYYY-MM-DD" key into a local-midnight Date. */
  function parseDay(key) {
    const [y, m, d] = String(key).split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  /**
   * Buckets sessions into the last `days` calendar days ending on `today`,
   * oldest first. Each bucket is {date, count, minutes}; entries logged before
   * durations were recorded contribute to count but add 0 minutes.
   */
  function sessionsPerDay(sessions, days, today) {
    const span = clampInt(days, 1, 366);
    const end = parseDay(today || todayStr());
    const buckets = [];
    const byDate = new Map();

    for (let i = span - 1; i >= 0; i--) {
      const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - i);
      const bucket = { date: todayStr(d), count: 0, minutes: 0 };
      buckets.push(bucket);
      byDate.set(bucket.date, bucket);
    }

    (sessions || []).forEach((s) => {
      const when = new Date(s.time);
      if (isNaN(when.getTime())) return;
      const bucket = byDate.get(todayStr(when));
      if (!bucket) return;
      bucket.count += 1;
      bucket.minutes += typeof s.minutes === "number" ? s.minutes : 0;
    });

    return buckets;
  }

  /**
   * Rolling session totals for today, the last 7 days and the last 30 days
   * (each window ends on `today` inclusive).
   */
  function summarizeSessions(sessions, today) {
    const end = parseDay(today || todayStr());
    const endStamp = end.getTime();
    const weekStart = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 6).getTime();
    const monthStart = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 29).getTime();

    const totals = {
      today: { count: 0, minutes: 0 },
      week: { count: 0, minutes: 0 },
      month: { count: 0, minutes: 0 },
    };

    (sessions || []).forEach((s) => {
      const when = new Date(s.time);
      if (isNaN(when.getTime())) return;
      const dayStamp = new Date(when.getFullYear(), when.getMonth(), when.getDate()).getTime();
      if (dayStamp > endStamp) return;
      const minutes = typeof s.minutes === "number" ? s.minutes : 0;
      if (dayStamp === endStamp) {
        totals.today.count += 1;
        totals.today.minutes += minutes;
      }
      if (dayStamp >= weekStart) {
        totals.week.count += 1;
        totals.week.minutes += minutes;
      }
      if (dayStamp >= monthStart) {
        totals.month.count += 1;
        totals.month.minutes += minutes;
      }
    });

    return totals;
  }

  /**
   * Compares estimates with actual elapsed time for tasks explicitly marked
   * done in the rolling window. Focus blocks that were continued or returned
   * to the queue are deliberately excluded: an elapsed timer is not proof that
   * the task itself was completed.
   */
  function summarizeEstimateAccuracy(sessions, today, days) {
    const span = clampInt(days || 30, 1, 366);
    const end = parseDay(today || todayStr());
    const endStamp = end.getTime();
    const startStamp = new Date(end.getFullYear(), end.getMonth(), end.getDate() - span + 1).getTime();
    const completed = [];

    (sessions || []).forEach((session) => {
      if (!session || session.outcome !== "done") return;
      const when = new Date(session.time);
      if (isNaN(when.getTime())) return;
      const dayStamp = new Date(when.getFullYear(), when.getMonth(), when.getDate()).getTime();
      const estimated = Number(session.estimatedMinutes);
      const actual = Number(session.actualMinutes);
      if (dayStamp < startStamp || dayStamp > endStamp || estimated <= 0 || actual < 0) return;
      completed.push({
        estimated,
        actual,
        category: typeof session.category === "string" ? session.category.trim() : "",
      });
    });

    const totalEstimated = completed.reduce((sum, item) => sum + item.estimated, 0);
    const totalActual = completed.reduce((sum, item) => sum + item.actual, 0);
    const onTargetCount = completed.filter(
      (item) => Math.abs(item.actual - item.estimated) / item.estimated <= 0.2
    ).length;
    const variancePercent = totalEstimated
      ? Math.round(((totalActual - totalEstimated) / totalEstimated) * 100)
      : 0;

    const groups = new Map();
    completed.forEach((item) => {
      if (!item.category) return;
      const key = item.category.toLocaleLowerCase();
      const current = groups.get(key) || {
        category: item.category,
        count: 0,
        estimatedMinutes: 0,
        actualMinutes: 0,
      };
      current.count += 1;
      current.estimatedMinutes += item.estimated;
      current.actualMinutes += item.actual;
      groups.set(key, current);
    });

    const categories = Array.from(groups.values())
      .map((group) => Object.assign(group, {
        variancePercent: group.estimatedMinutes
          ? Math.round(((group.actualMinutes - group.estimatedMinutes) / group.estimatedMinutes) * 100)
          : 0,
      }))
      .sort((a, b) => b.count - a.count || b.variancePercent - a.variancePercent);
    const underestimated = categories
      .filter((group) => group.variancePercent > 0)
      .sort((a, b) => b.variancePercent - a.variancePercent)[0] || null;

    return {
      count: completed.length,
      totalEstimated: Math.round(totalEstimated),
      totalActual: Math.round(totalActual),
      variancePercent,
      onTargetCount,
      onTargetPercent: completed.length ? Math.round((onTargetCount / completed.length) * 100) : 0,
      categories,
      mostUnderestimatedCategory: underestimated,
    };
  }

  /** Renders a minute count as "45m" or "1h 20m". */
  function formatMinutes(minutes) {
    const total = Math.max(0, Math.round(Number(minutes) || 0));
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (!h) return `${m}m`;
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  const UNTITLED_TASK = "Untitled focus session";

  /**
   * Builds a deduped (case-insensitive), most-recent-first list of past task
   * names from to-dos and logged sessions, for autosuggest. Pure — sessions
   * and todos are only read, never mutated.
   */
  function buildTaskSuggestions(sessions, todos, limit) {
    limit = typeof limit === "number" ? limit : 20;
    const dated = [];
    (todos || []).forEach((t) => dated.push({ text: t.text, at: t.createdAt }));
    (sessions || []).forEach((s) => dated.push({ text: s.task, at: s.time }));
    dated.sort((a, b) => new Date(b.at) - new Date(a.at));

    const seen = new Set();
    const result = [];
    dated.forEach(({ text }) => {
      const trimmed = (text || "").trim();
      if (!trimmed || trimmed === UNTITLED_TASK) return;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      result.push(trimmed);
    });
    return result.slice(0, limit);
  }

  const DialLogic = {
    MODES,
    MODE_LABELS,
    MODE_SETTING_KEYS,
    ALARM_SOUNDS,
    ACCENT_REWARDS,
    DEFAULT_SETTINGS,
    BADGE_DEFS,
    MAX_LOGGED_SESSIONS,
    MAX_TODOS,
    todayStr,
    xpForLevel,
    applyXp,
    streakBonus,
    focusSessionXp,
    daysBetween,
    nextStreak,
    nextBreakMode,
    nextModeAfterWork,
    isAccentUnlocked,
    nextAccentReward,
    evaluateBadges,
    formatTime,
    capSessions,
    clampInt,
    clampMinutes,
    clampVolume,
    capTodos,
    buildTaskSuggestions,
    normalizeSettings,
    sessionsPerDay,
    summarizeSessions,
    summarizeEstimateAccuracy,
    formatMinutes,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = DialLogic;
  } else {
    root.DialLogic = DialLogic;
  }
})(typeof window !== "undefined" ? window : globalThis);
