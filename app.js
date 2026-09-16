(() => {
  "use strict";

  const {
    DURATIONS,
    MODE_LABELS,
    BADGE_DEFS,
    todayStr,
    xpForLevel,
    applyXp,
    focusSessionXp,
    nextStreak,
    nextBreakMode,
    evaluateBadges,
    formatTime,
    capSessions,
  } = window.DialLogic;

  /* ---------------- Constants ---------------- */
  const STORAGE_KEY = "dial:state:v1";
  const TIMER_KEY = "dial:timer:v1";

  const RING_RADIUS = 130;
  const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

  /* ---------------- Persistence: app state ---------------- */
  function defaultState() {
    return {
      xp: 0,
      level: 1,
      currentStreak: 0,
      longestStreak: 0,
      lastSessionDate: null,
      today: todayStr(),
      todayCount: 0,
      totalSessions: 0,
      badges: {},
      sessions: [],
      lastMode: "focus",
      theme: null,
    };
  }

  function loadState() {
    let stored = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) stored = JSON.parse(raw);
    } catch (e) {
      stored = null;
    }
    const state = Object.assign(defaultState(), stored || {});
    state.badges = Object.assign({}, stored && stored.badges);
    state.sessions = capSessions(Array.isArray(state.sessions) ? state.sessions : []);

    const now = todayStr();
    if (state.today !== now) {
      state.today = now;
      state.todayCount = 0;
    }
    return state;
  }

  function saveState(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      /* storage unavailable (private browsing / denied) — app still works, just won't persist */
    }
  }

  /* ---------------- Persistence: in-flight timer ---------------- */
  function loadTimerSnapshot() {
    try {
      const raw = localStorage.getItem(TIMER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveTimerSnapshot() {
    try {
      localStorage.setItem(
        TIMER_KEY,
        JSON.stringify({
          mode,
          endTime,
          remaining,
          running,
          sessionStart: sessionStart ? sessionStart.toISOString() : null,
          taskDraft: el.taskInput.value,
        })
      );
    } catch (e) {
      /* storage unavailable — in-flight timer just won't survive a reload */
    }
  }

  function clearTimerSnapshot() {
    try {
      localStorage.removeItem(TIMER_KEY);
    } catch (e) {
      /* ignore */
    }
  }

  /* ---------------- App state ---------------- */
  let state = loadState();

  let mode = DURATIONS[state.lastMode] ? state.lastMode : "focus";
  let totalDuration = DURATIONS[mode];
  let remaining = totalDuration;
  let running = false;
  let endTime = null;
  let tickHandle = null;
  let sessionStart = null;
  let pendingTaskDraft = "";

  /* Resume an in-flight timer left over from before a reload/close, if any. */
  (function restoreTimer() {
    const snap = loadTimerSnapshot();
    if (!snap || !DURATIONS[snap.mode]) return;

    mode = snap.mode;
    totalDuration = DURATIONS[mode];
    sessionStart = snap.sessionStart ? new Date(snap.sessionStart) : null;
    pendingTaskDraft = snap.taskDraft || "";

    if (snap.running && typeof snap.endTime === "number") {
      const liveRemaining = (snap.endTime - Date.now()) / 1000;
      if (liveRemaining > 0) {
        remaining = liveRemaining;
        endTime = snap.endTime;
        running = true;
      } else {
        /* Session finished while the app was closed — we can't verify it was
           actually watched through, so don't retroactively award XP or play
           a beep. Just present a fresh timer for the mode. */
        remaining = totalDuration;
        clearTimerSnapshot();
      }
    } else if (typeof snap.remaining === "number") {
      remaining = Math.min(Math.max(snap.remaining, 0), totalDuration);
    }
  })();

  /* ---------------- DOM refs ---------------- */
  const el = {
    themeToggle: document.getElementById("themeToggle"),
    modeButtons: Array.from(document.querySelectorAll(".mode-btn")),
    taskInput: document.getElementById("taskInput"),
    dialProgress: document.getElementById("dialProgress"),
    timeDisplay: document.getElementById("timeDisplay"),
    modeLabel: document.getElementById("modeLabel"),
    startPauseBtn: document.getElementById("startPauseBtn"),
    resetBtn: document.getElementById("resetBtn"),
    statStreak: document.getElementById("statStreak"),
    statToday: document.getElementById("statToday"),
    statLevel: document.getElementById("statLevel"),
    xpText: document.getElementById("xpText"),
    xpFill: document.getElementById("xpFill"),
    badgesRow: document.getElementById("badgesRow"),
    sessionLog: document.getElementById("sessionLog"),
    announcer: document.getElementById("announcer"),
  };

  el.dialProgress.style.strokeDasharray = `${RING_CIRCUMFERENCE}`;
  if (pendingTaskDraft) el.taskInput.value = pendingTaskDraft;

  if (running) {
    tickHandle = setInterval(tick, 250);
  }

  /* ---------------- Theme ---------------- */
  function applyTheme() {
    if (state.theme === "dark" || state.theme === "light") {
      document.documentElement.setAttribute("data-theme", state.theme);
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  }

  function systemPrefersDark() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  el.themeToggle.addEventListener("click", () => {
    const effectiveDark = state.theme ? state.theme === "dark" : systemPrefersDark();
    state.theme = effectiveDark ? "light" : "dark";
    applyTheme();
    saveState(state);
  });

  applyTheme();

  /* ---------------- Announcer (screen readers) ---------------- */
  function announce(message) {
    if (!el.announcer) return;
    el.announcer.textContent = "";
    /* Re-set on the next tick so repeated identical messages are still announced. */
    window.setTimeout(() => {
      el.announcer.textContent = message;
    }, 30);
  }

  /* ---------------- Audio (beep) ---------------- */
  let audioCtx = null;
  function playBeep() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const ctx = audioCtx;
      const now = ctx.currentTime;
      [880, 1108.73].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        const start = now + i * 0.16;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.22, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.28);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.3);
      });
    } catch (e) {
      /* Web Audio unavailable — fail silently */
    }
  }

  /* ---------------- Badges ---------------- */
  function renderBadges() {
    el.badgesRow.innerHTML = "";
    BADGE_DEFS.forEach((def) => {
      const earned = !!state.badges[def.id];
      const wrap = document.createElement("div");
      wrap.className = "badge" + (earned ? " is-earned" : "");
      wrap.title = def.label;
      const medal = document.createElement("div");
      medal.className = "badge__medal";
      medal.textContent = def.icon;
      const label = document.createElement("div");
      label.className = "badge__label";
      label.textContent = def.label;
      wrap.appendChild(medal);
      wrap.appendChild(label);
      el.badgesRow.appendChild(wrap);
    });
  }

  /* ---------------- Session log ---------------- */
  function addLogEntry(task, xpEarned) {
    state.sessions.unshift({
      task: task || "Untitled focus session",
      time: new Date().toISOString(),
      xp: xpEarned,
    });
    state.sessions = capSessions(state.sessions);
  }

  function renderLog() {
    el.sessionLog.innerHTML = "";
    if (!state.sessions.length) {
      const empty = document.createElement("p");
      empty.className = "log__empty";
      empty.id = "logEmpty";
      empty.textContent = "No sessions logged yet. Start your first focus session.";
      el.sessionLog.appendChild(empty);
      return;
    }
    state.sessions.slice(0, 100).forEach((entry) => {
      const row = document.createElement("div");
      row.className = "log-entry";

      const main = document.createElement("div");
      main.className = "log-entry__main";

      const task = document.createElement("div");
      task.className = "log-entry__task";
      task.textContent = entry.task;

      const time = document.createElement("div");
      time.className = "log-entry__time";
      const d = new Date(entry.time);
      time.textContent = d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });

      main.appendChild(task);
      main.appendChild(time);

      const xp = document.createElement("div");
      xp.className = "log-entry__xp";
      xp.textContent = `+${entry.xp} XP`;

      row.appendChild(main);
      row.appendChild(xp);
      el.sessionLog.appendChild(row);
    });
  }

  /* ---------------- Rendering ---------------- */
  function renderTimer() {
    el.timeDisplay.textContent = formatTime(remaining);
    el.modeLabel.textContent = MODE_LABELS[mode];
    const fraction = 1 - remaining / totalDuration;
    const offset = RING_CIRCUMFERENCE * (1 - Math.min(Math.max(fraction, 0), 1));
    el.dialProgress.style.strokeDashoffset = `${offset}`;
    el.startPauseBtn.textContent = running ? "Pause" : remaining < totalDuration ? "Resume" : "Start";
    document.title = `${formatTime(remaining)} · ${MODE_LABELS[mode]} — Dial`;
  }

  function renderModeButtons() {
    el.modeButtons.forEach((btn) => {
      const isActive = btn.dataset.mode === mode;
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
      btn.disabled = running;
    });
  }

  function renderStats() {
    el.statStreak.textContent = state.currentStreak;
    el.statToday.textContent = state.todayCount;
    el.statLevel.textContent = state.level;
    const needed = xpForLevel(state.level);
    el.xpText.textContent = `${state.xp} / ${needed}`;
    el.xpFill.style.width = `${Math.min(100, (state.xp / needed) * 100)}%`;
  }

  function renderAll() {
    renderTimer();
    renderModeButtons();
    renderStats();
    renderBadges();
    renderLog();
  }

  /* ---------------- Timer engine ---------------- */
  function setMode(newMode, opts = {}) {
    if (running && !opts.force) return;
    mode = newMode;
    state.lastMode = newMode;
    totalDuration = DURATIONS[mode];
    remaining = totalDuration;
    running = false;
    endTime = null;
    sessionStart = null;
    clearTick();
    saveState(state);
    clearTimerSnapshot();
    renderAll();
  }

  function clearTick() {
    if (tickHandle) {
      clearInterval(tickHandle);
      tickHandle = null;
    }
  }

  function tick() {
    remaining = (endTime - Date.now()) / 1000;
    if (remaining <= 0) {
      remaining = 0;
      renderTimer();
      completeSession();
      return;
    }
    renderTimer();
  }

  function start() {
    if (running) return;
    if (remaining <= 0) remaining = totalDuration;
    running = true;
    endTime = Date.now() + remaining * 1000;
    if (mode === "focus" && !sessionStart) sessionStart = new Date();
    clearTick();
    tickHandle = setInterval(tick, 250);
    renderTimer();
    renderModeButtons();
    saveTimerSnapshot();
  }

  function pause() {
    if (!running) return;
    running = false;
    remaining = (endTime - Date.now()) / 1000;
    clearTick();
    renderTimer();
    renderModeButtons();
    saveTimerSnapshot();
  }

  function reset() {
    running = false;
    clearTick();
    remaining = totalDuration;
    endTime = null;
    sessionStart = null;
    renderTimer();
    renderModeButtons();
    clearTimerSnapshot();
  }

  function ensureTodayFresh() {
    const now = todayStr();
    if (state.today !== now) {
      state.today = now;
      state.todayCount = 0;
    }
  }

  function completeSession() {
    running = false;
    clearTick();
    playBeep();
    clearTimerSnapshot();

    const wasFocus = mode === "focus";
    const startedAt = sessionStart || new Date();

    if (wasFocus) {
      ensureTodayFresh();
      state.currentStreak = nextStreak(state.lastSessionDate, state.currentStreak, todayStr());
      state.lastSessionDate = todayStr();
      state.longestStreak = Math.max(state.longestStreak, state.currentStreak);
      state.todayCount += 1;
      state.totalSessions += 1;

      const xpEarned = focusSessionXp(state.currentStreak);
      const applied = applyXp(state.xp, state.level, xpEarned);
      state.xp = applied.xp;
      state.level = applied.level;

      const taskName = el.taskInput.value.trim().slice(0, 60);
      addLogEntry(taskName, xpEarned);

      state.badges = evaluateBadges(state.badges, {
        totalSessions: state.totalSessions,
        longestStreak: state.longestStreak,
        todayCount: state.todayCount,
        level: state.level,
        startHour: startedAt.getHours(),
      });

      el.taskInput.value = "";

      const nextMode = nextBreakMode(state.totalSessions);
      saveState(state);
      renderAll();
      announce(`Focus session complete. ${xpEarned} XP earned. ${MODE_LABELS[nextMode]} starting.`);
      setMode(nextMode, { force: true });
    } else {
      saveState(state);
      renderAll();
      announce(`${MODE_LABELS[mode]} complete. Back to Focus.`);
      setMode("focus", { force: true });
    }
  }

  /* ---------------- Event wiring ---------------- */
  el.modeButtons.forEach((btn) => {
    btn.addEventListener("click", () => setMode(btn.dataset.mode));
  });

  el.startPauseBtn.addEventListener("click", () => {
    if (running) pause();
    else start();
  });

  el.resetBtn.addEventListener("click", reset);

  el.taskInput.addEventListener("input", () => {
    if (el.taskInput.value.length > 60) {
      el.taskInput.value = el.taskInput.value.slice(0, 60);
    }
    if (remaining !== totalDuration || running) saveTimerSnapshot();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && running && endTime) {
      tick();
    }
  });

  window.addEventListener("beforeunload", () => {
    if (running || remaining !== totalDuration) saveTimerSnapshot();
  });

  /* Keep the persisted timer snapshot fresh while running, in case the tab
     is closed without a clean beforeunload (some mobile browsers). */
  setInterval(() => {
    if (running) saveTimerSnapshot();
  }, 5000);

  /* ---------------- Init ---------------- */
  ensureTodayFresh();
  saveState(state);
  renderAll();
})();
