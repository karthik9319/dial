const test = require("node:test");
const assert = require("node:assert/strict");
const {
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
  clampMinutes,
  capTodos,
  buildTaskSuggestions,
  MAX_LOGGED_SESSIONS,
  MAX_TODOS,
} = require("../logic.js");

/* ---------------- XP / levels ---------------- */

test("xpForLevel follows 100 + (N-1)*40", () => {
  assert.equal(xpForLevel(1), 100);
  assert.equal(xpForLevel(2), 140);
  assert.equal(xpForLevel(5), 260);
});

test("applyXp accumulates without leveling up when under threshold", () => {
  assert.deepEqual(applyXp(0, 1, 50), { xp: 50, level: 1 });
});

test("applyXp levels up and carries overflow XP forward", () => {
  // level 1 needs 100; awarding 130 should land at level 2 with 30 xp left over
  assert.deepEqual(applyXp(0, 1, 130), { xp: 30, level: 2 });
});

test("applyXp handles multiple level-ups from a single award", () => {
  // level 1 needs 100, level 2 needs 140 -> 250 xp should clear both
  assert.deepEqual(applyXp(0, 1, 250), { xp: 10, level: 3 });
});

test("streakBonus is 2xp per streak day capped at 20", () => {
  assert.equal(streakBonus(1), 2);
  assert.equal(streakBonus(10), 20);
  assert.equal(streakBonus(11), 20);
  assert.equal(streakBonus(50), 20);
});

test("focusSessionXp is 20 base plus the capped streak bonus", () => {
  assert.equal(focusSessionXp(1), 22);
  assert.equal(focusSessionXp(10), 40);
  assert.equal(focusSessionXp(100), 40);
});

/* ---------------- Streaks ---------------- */

test("daysBetween counts whole calendar days", () => {
  assert.equal(daysBetween("2026-09-15", "2026-09-16"), 1);
  assert.equal(daysBetween("2026-09-10", "2026-09-16"), 6);
  assert.equal(daysBetween("2026-09-16", "2026-09-16"), 0);
});

test("nextStreak starts at 1 for the very first session", () => {
  assert.equal(nextStreak(null, 0, "2026-09-16"), 1);
});

test("nextStreak is unchanged for a second session on the same day", () => {
  assert.equal(nextStreak("2026-09-16", 3, "2026-09-16"), 3);
});

test("nextStreak increments on the very next consecutive day", () => {
  assert.equal(nextStreak("2026-09-15", 3, "2026-09-16"), 4);
});

test("nextStreak resets to 1 after a missed day", () => {
  assert.equal(nextStreak("2026-09-10", 7, "2026-09-16"), 1);
});

/* ---------------- Break cadence ---------------- */

test("nextBreakMode is short except every 4th completed focus session", () => {
  assert.equal(nextBreakMode(1), "short");
  assert.equal(nextBreakMode(2), "short");
  assert.equal(nextBreakMode(3), "short");
  assert.equal(nextBreakMode(4), "long");
  assert.equal(nextBreakMode(8), "long");
  assert.equal(nextBreakMode(9), "short");
});

/* ---------------- Badges ---------------- */

test("first_sprint unlocks on the first completed focus session", () => {
  const badges = evaluateBadges({}, { totalSessions: 1, longestStreak: 1, todayCount: 1, level: 1 });
  assert.equal(badges.first_sprint, true);
});

test("streak_5 and streak_10 unlock at the right longest-streak thresholds", () => {
  const at4 = evaluateBadges({}, { totalSessions: 4, longestStreak: 4, todayCount: 1, level: 1 });
  assert.equal(at4.streak_5, undefined);
  assert.equal(at4.streak_10, undefined);

  const at5 = evaluateBadges({}, { totalSessions: 5, longestStreak: 5, todayCount: 1, level: 1 });
  assert.equal(at5.streak_5, true);
  assert.equal(at5.streak_10, undefined);

  const at10 = evaluateBadges({}, { totalSessions: 10, longestStreak: 10, todayCount: 1, level: 1 });
  assert.equal(at10.streak_5, true);
  assert.equal(at10.streak_10, true);
});

test("six_in_day unlocks once today's count reaches 6", () => {
  const under = evaluateBadges({}, { totalSessions: 5, longestStreak: 1, todayCount: 5, level: 1 });
  assert.equal(under.six_in_day, undefined);
  const at = evaluateBadges({}, { totalSessions: 6, longestStreak: 1, todayCount: 6, level: 1 });
  assert.equal(at.six_in_day, true);
});

test("level_5 unlocks once level reaches 5", () => {
  const under = evaluateBadges({}, { totalSessions: 1, longestStreak: 1, todayCount: 1, level: 4 });
  assert.equal(under.level_5, undefined);
  const at = evaluateBadges({}, { totalSessions: 1, longestStreak: 1, todayCount: 1, level: 5 });
  assert.equal(at.level_5, true);
});

test("before_7am only unlocks when startHour is before 7", () => {
  const late = evaluateBadges({}, { totalSessions: 1, longestStreak: 1, todayCount: 1, level: 1, startHour: 7 });
  assert.equal(late.before_7am, undefined);
  const early = evaluateBadges({}, { totalSessions: 1, longestStreak: 1, todayCount: 1, level: 1, startHour: 6 });
  assert.equal(early.before_7am, true);
});

test("fifty_sessions unlocks at 50 lifetime completed focus sessions", () => {
  const under = evaluateBadges({}, { totalSessions: 49, longestStreak: 1, todayCount: 1, level: 1 });
  assert.equal(under.fifty_sessions, undefined);
  const at = evaluateBadges({}, { totalSessions: 50, longestStreak: 1, todayCount: 1, level: 1 });
  assert.equal(at.fifty_sessions, true);
});

test("evaluateBadges never unsets a previously earned badge", () => {
  const already = { streak_10: true };
  const result = evaluateBadges(already, { totalSessions: 1, longestStreak: 1, todayCount: 1, level: 1 });
  assert.equal(result.streak_10, true);
});

/* ---------------- Formatting / retention ---------------- */

test("formatTime renders mm:ss and rounds up sub-second remainders", () => {
  assert.equal(formatTime(0), "00:00");
  assert.equal(formatTime(59), "00:59");
  assert.equal(formatTime(60), "01:00");
  assert.equal(formatTime(1500), "25:00");
  assert.equal(formatTime(0.4), "00:01");
});

test("capSessions trims the log to the retention cap, keeping the newest entries", () => {
  const sessions = Array.from({ length: MAX_LOGGED_SESSIONS + 10 }, (_, i) => ({ task: `t${i}` }));
  const capped = capSessions(sessions);
  assert.equal(capped.length, MAX_LOGGED_SESSIONS);
  assert.equal(capped[0].task, "t0");
});

test("capSessions leaves a short log untouched", () => {
  const sessions = [{ task: "a" }, { task: "b" }];
  assert.equal(capSessions(sessions).length, 2);
});

/* ---------- Custom duration / to-do list ---------- */

test("clampMinutes rounds to the nearest whole minute", () => {
  assert.equal(clampMinutes(9.6, 1, 120), 10);
  assert.equal(clampMinutes(9.4, 1, 120), 9);
});

test("clampMinutes clamps to the [min, max] range", () => {
  assert.equal(clampMinutes(0, 1, 120), 1);
  assert.equal(clampMinutes(-5, 1, 120), 1);
  assert.equal(clampMinutes(500, 1, 120), 120);
});

test("clampMinutes falls back to min for non-numeric input", () => {
  assert.equal(clampMinutes("", 1, 120), 1);
  assert.equal(clampMinutes("abc", 1, 120), 1);
  assert.equal(clampMinutes(undefined, 1, 120), 1);
  assert.equal(clampMinutes(NaN, 5, 120), 5);
});

test("clampMinutes defaults to a 1-120 range when bounds are omitted", () => {
  assert.equal(clampMinutes(0), 1);
  assert.equal(clampMinutes(999), 120);
});

test("capTodos trims the list to the retention cap, keeping the newest entries", () => {
  const todos = Array.from({ length: MAX_TODOS + 10 }, (_, i) => ({ text: `t${i}` }));
  const capped = capTodos(todos);
  assert.equal(capped.length, MAX_TODOS);
  assert.equal(capped[0].text, "t0");
});

test("capTodos leaves a short list untouched", () => {
  const todos = [{ text: "a" }, { text: "b" }];
  assert.equal(capTodos(todos).length, 2);
});

/* ---------- Task autosuggest ---------- */

test("buildTaskSuggestions orders by most recent first, across todos and sessions", () => {
  const sessions = [{ task: "Old report", time: "2026-09-10T09:00:00Z" }];
  const todos = [{ text: "Book tickets", createdAt: "2026-09-16T09:00:00Z" }];
  const result = buildTaskSuggestions(sessions, todos);
  assert.deepEqual(result, ["Book tickets", "Old report"]);
});

test("buildTaskSuggestions dedupes case-insensitively, keeping the most recent casing", () => {
  const sessions = [
    { task: "book tickets", time: "2026-09-10T09:00:00Z" },
    { task: "Book Tickets", time: "2026-09-16T09:00:00Z" },
  ];
  const result = buildTaskSuggestions(sessions, []);
  assert.deepEqual(result, ["Book Tickets"]);
});

test("buildTaskSuggestions excludes blank and untitled placeholder entries", () => {
  const sessions = [
    { task: "", time: "2026-09-16T09:00:00Z" },
    { task: "Untitled focus session", time: "2026-09-15T09:00:00Z" },
    { task: "Real task", time: "2026-09-14T09:00:00Z" },
  ];
  const result = buildTaskSuggestions(sessions, []);
  assert.deepEqual(result, ["Real task"]);
});

test("buildTaskSuggestions caps the result to the given limit", () => {
  const sessions = Array.from({ length: 30 }, (_, i) => ({
    task: `Task ${i}`,
    time: new Date(2026, 0, i + 1).toISOString(),
  }));
  const result = buildTaskSuggestions(sessions, [], 5);
  assert.equal(result.length, 5);
  assert.equal(result[0], "Task 29");
});
