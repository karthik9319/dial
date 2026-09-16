/*
 * Pure scoring/streak/badge logic for Dial, kept dependency-free so it can be
 * loaded both as a plain browser <script> (window.DialLogic) and required
 * from Node test files (module.exports) without a build step.
 */
(function (root) {
  "use strict";

  const DURATIONS = {
    focus: 25 * 60,
    short: 5 * 60,
    long: 15 * 60,
  };

  const MODE_LABELS = {
    focus: "Focus",
    short: "Short Break",
    long: "Long Break",
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

  const MAX_LOGGED_SESSIONS = 200;

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

  const DialLogic = {
    DURATIONS,
    MODE_LABELS,
    BADGE_DEFS,
    MAX_LOGGED_SESSIONS,
    todayStr,
    xpForLevel,
    applyXp,
    streakBonus,
    focusSessionXp,
    daysBetween,
    nextStreak,
    nextBreakMode,
    evaluateBadges,
    formatTime,
    capSessions,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = DialLogic;
  } else {
    root.DialLogic = DialLogic;
  }
})(typeof window !== "undefined" ? window : globalThis);
