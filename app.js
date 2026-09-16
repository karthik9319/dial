(() => {
  "use strict";

  /* ---------------- Constants ---------------- */
  const STORAGE_KEY = "dial:state:v1";

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

  const RING_RADIUS = 130;
  const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

  /* ---------------- Persistence ---------------- */
  function todayStr(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

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

  /* ---------------- App state ---------------- */
  let state = loadState();

  let mode = DURATIONS[state.lastMode] ? state.lastMode : "focus";
  let totalDuration = DURATIONS[mode];
  let remaining = totalDuration;
  let running = false;
  let endTime = null;
  let tickHandle = null;
  let sessionStart = null;

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
    logEmpty: document.getElementById("logEmpty"),
  };

  el.dialProgress.style.strokeDasharray = `${RING_CIRCUMFERENCE}`;

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

  /* ---------------- Level / XP math ---------------- */
  function xpForLevel(level) {
    return 100 + (level - 1) * 40;
  }

  function addXp(amount) {
    state.xp += amount;
    while (state.xp >= xpForLevel(state.level)) {
      state.xp -= xpForLevel(state.level);
      state.level += 1;
    }
  }

  /* ---------------- Streak ---------------- */
  function daysBetween(a, b) {
    const [ay, am, ad] = a.split("-").map(Number);
    const [by, bm, bd] = b.split("-").map(Number);
    const da = new Date(ay, am - 1, ad);
    const db = new Date(by, bm - 1, bd);
    return Math.round((db - da) / 86400000);
  }

  function registerStreak() {
    const now = todayStr();
    if (state.lastSessionDate === now) {
      /* already counted today, no change */
    } else if (state.lastSessionDate === null) {
      state.currentStreak = 1;
    } else {
      const gap = daysBetween(state.lastSessionDate, now);
      state.currentStreak = gap === 1 ? state.currentStreak + 1 : 1;
    }
    state.lastSessionDate = now;
    state.longestStreak = Math.max(state.longestStreak, state.currentStreak);
  }

  /* ---------------- Badges ---------------- */
  function evaluateBadges(ctx) {
    const b = state.badges;
    if (state.totalSessions >= 1) b.first_sprint = true;
    if (state.longestStreak >= 5) b.streak_5 = true;
    if (state.longestStreak >= 10) b.streak_10 = true;
    if (state.todayCount >= 6) b.six_in_day = true;
    if (state.level >= 5) b.level_5 = true;
    if (ctx && ctx.startHour < 7) b.before_7am = true;
    if (state.totalSessions >= 50) b.fifty_sessions = true;
  }

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
  }

  function renderLog() {
    if (!state.sessions.length) {
      el.sessionLog.innerHTML = "";
      const empty = document.createElement("p");
      empty.className = "log__empty";
      empty.id = "logEmpty";
      empty.textContent = "No sessions logged yet. Start your first focus session.";
      el.sessionLog.appendChild(empty);
      return;
    }
    el.sessionLog.innerHTML = "";
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
  function formatTime(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  }

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
  }

  function pause() {
    if (!running) return;
    running = false;
    remaining = (endTime - Date.now()) / 1000;
    clearTick();
    renderTimer();
    renderModeButtons();
  }

  function reset() {
    running = false;
    clearTick();
    remaining = totalDuration;
    endTime = null;
    sessionStart = null;
    renderTimer();
    renderModeButtons();
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

    const wasFocus = mode === "focus";
    const startedAt = sessionStart || new Date();

    if (wasFocus) {
      ensureTodayFresh();
      registerStreak();
      state.todayCount += 1;
      state.totalSessions += 1;

      const streakBonus = Math.min(state.currentStreak * 2, 20);
      const xpEarned = 20 + streakBonus;
      addXp(xpEarned);

      const taskName = el.taskInput.value.trim().slice(0, 60);
      addLogEntry(taskName, xpEarned);

      evaluateBadges({ startHour: startedAt.getHours() });

      el.taskInput.value = "";

      const nextMode = state.totalSessions % 4 === 0 ? "long" : "short";
      saveState(state);
      renderAll();
      setMode(nextMode, { force: true });
    } else {
      saveState(state);
      renderAll();
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
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && running && endTime) {
      tick();
    }
  });

  /* ---------------- Init ---------------- */
  ensureTodayFresh();
  saveState(state);
  renderAll();
})();
