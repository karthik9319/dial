(() => {
  "use strict";

  const {
    MODES,
    MODE_LABELS,
    MODE_SETTING_KEYS,
    DEFAULT_SETTINGS,
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
    clampInt,
    clampMinutes,
    clampVolume,
    capTodos,
    buildTaskSuggestions,
    normalizeSettings,
    sessionsPerDay,
    summarizeSessions,
    formatMinutes,
  } = window.DialLogic;

  const CUSTOM_MIN_MINUTES = 1;
  const CUSTOM_MAX_MINUTES = 120;
  const DEFAULT_CUSTOM_MINUTES = 10;
  const CHART_DAYS = 7;

  /** Allowed range per numeric setting, mirroring normalizeSettings in logic.js. */
  const SETTING_RANGES = {
    focusMinutes: [1, 120],
    shortMinutes: [1, 60],
    longMinutes: [1, 60],
    dailyGoal: [1, 24],
  };

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
      todos: [],
      customMinutes: DEFAULT_CUSTOM_MINUTES,
      settings: Object.assign({}, DEFAULT_SETTINGS),
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
    /* Finished tasks used to linger in the list with a `done` flag; they now
       leave it outright, so drop any left over from that older format. */
    const todos = (Array.isArray(state.todos) ? state.todos : []).filter((t) => t && !t.done);
    state.todos = capTodos(todos);
    state.customMinutes = clampMinutes(state.customMinutes, CUSTOM_MIN_MINUTES, CUSTOM_MAX_MINUTES);
    state.settings = normalizeSettings(state.settings);

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
          activeTodoId,
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

  function isValidMode(m) {
    return MODES.indexOf(m) >= 0;
  }

  function durationFor(m) {
    if (m === "custom") return state.customMinutes * 60;
    return state.settings[MODE_SETTING_KEYS[m]] * 60;
  }

  let mode = isValidMode(state.lastMode) ? state.lastMode : "focus";
  let totalDuration = durationFor(mode);
  let remaining = totalDuration;
  let running = false;
  let endTime = null;
  let tickHandle = null;
  let sessionStart = null;
  let pendingTaskDraft = "";
  let activeTodoId = null;
  let editingTodoId = null;

  /* Resume an in-flight timer left over from before a reload/close, if any. */
  (function restoreTimer() {
    const snap = loadTimerSnapshot();
    if (!snap || !isValidMode(snap.mode)) return;

    mode = snap.mode;
    totalDuration = durationFor(mode);
    sessionStart = snap.sessionStart ? new Date(snap.sessionStart) : null;
    pendingTaskDraft = snap.taskDraft || "";
    activeTodoId = snap.activeTodoId || null;

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
    customDuration: document.getElementById("customDuration"),
    customMinutesInput: document.getElementById("customMinutesInput"),
    customMinusBtn: document.getElementById("customMinusBtn"),
    customPlusBtn: document.getElementById("customPlusBtn"),
    todoForm: document.getElementById("todoForm"),
    todoInput: document.getElementById("todoInput"),
    todoMinutesInput: document.getElementById("todoMinutesInput"),
    todoList: document.getElementById("todoList"),
    taskSuggestions: document.getElementById("taskSuggestions"),
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
    figTodayCount: document.getElementById("figTodayCount"),
    figTodayMinutes: document.getElementById("figTodayMinutes"),
    figWeekCount: document.getElementById("figWeekCount"),
    figWeekMinutes: document.getElementById("figWeekMinutes"),
    figMonthCount: document.getElementById("figMonthCount"),
    figMonthMinutes: document.getElementById("figMonthMinutes"),
    statsChart: document.getElementById("statsChart"),
    setFocus: document.getElementById("setFocus"),
    setShort: document.getElementById("setShort"),
    setLong: document.getElementById("setLong"),
    setGoal: document.getElementById("setGoal"),
    setAlarm: document.getElementById("setAlarm"),
    setVolume: document.getElementById("setVolume"),
    setAutoStart: document.getElementById("setAutoStart"),
    setNotify: document.getElementById("setNotify"),
    stepButtons: Array.from(document.querySelectorAll("[data-step]")),
    tabs: Array.from(document.querySelectorAll(".tab")),
    panes: Array.from(document.querySelectorAll(".pane")),
    settingsSheet: document.getElementById("settingsSheet"),
    openSettings: document.getElementById("openSettings"),
    closeSettings: document.getElementById("closeSettings"),
  };

  /** Maps a numeric setting key to its input element. */
  const SETTING_INPUTS = {
    focusMinutes: el.setFocus,
    shortMinutes: el.setShort,
    longMinutes: el.setLong,
    dailyGoal: el.setGoal,
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

  /* ---------------- Audio (alarm) ----------------
     Each alarm is a short list of synthesised tones, so no audio files ship
     with the app. Peak gain is per-tone and scaled by the volume setting. */
  const ALARM_TONES = {
    chime: [
      { freq: 880, type: "sine", at: 0, hold: 0.28, peak: 0.22 },
      { freq: 1108.73, type: "sine", at: 0.16, hold: 0.28, peak: 0.22 },
    ],
    bell: [
      { freq: 1318.51, type: "sine", at: 0, hold: 0.9, peak: 0.2 },
      { freq: 2637.02, type: "sine", at: 0, hold: 0.5, peak: 0.06 },
    ],
    pulse: [
      { freq: 660, type: "triangle", at: 0, hold: 0.1, peak: 0.24 },
      { freq: 660, type: "triangle", at: 0.16, hold: 0.1, peak: 0.24 },
      { freq: 660, type: "triangle", at: 0.32, hold: 0.14, peak: 0.24 },
    ],
  };

  let audioCtx = null;

  function playAlarm(soundName) {
    const tones = ALARM_TONES[soundName || state.settings.alarmSound];
    const volume = state.settings.alarmVolume;
    if (!tones || volume <= 0) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const ctx = audioCtx;
      if (ctx.state === "suspended") ctx.resume();
      const now = ctx.currentTime;
      tones.forEach((tone) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = tone.type;
        osc.frequency.value = tone.freq;
        const start = now + tone.at;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(tone.peak * volume, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + tone.hold);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + tone.hold + 0.02);
      });
    } catch (e) {
      /* Web Audio unavailable — fail silently */
    }
  }

  /* ---------------- Desktop shell (Electron) ----------------
     The bridge only exists inside the Electron wrapper; opened as a plain web
     page every call here is a no-op and the app behaves as it always has. */
  const shell = window.dialBridge || null;

  /* In the Electron wrapper the window itself is the frame, so the console
     drops its card treatment and fills the window edge to edge. Opened as a
     plain web page it stays a centred card on the background. */
  if (shell) document.documentElement.classList.add("is-desktop");

  function notifySessionEnd(title, body) {
    if (!state.settings.notify) return;
    if (shell && shell.notify) {
      shell.notify({ title, body });
      return;
    }
    try {
      if (window.Notification && Notification.permission === "granted") {
        new Notification(title, { body });
      }
    } catch (e) {
      /* notifications unavailable — the alarm sound still fires */
    }
  }

  /* Browsers need an explicit opt-in; Electron grants notifications outright. */
  function requestNotificationPermission() {
    if (shell || !state.settings.notify) return;
    try {
      if (window.Notification && Notification.permission === "default") {
        Notification.requestPermission();
      }
    } catch (e) {
      /* ignore */
    }
  }

  let lastPushedTitle = null;
  function pushTimerToShell() {
    if (!shell || !shell.updateTimer) return;
    const display = running || remaining < totalDuration ? formatTime(remaining) : "";
    /* The tray only re-renders once a second, so skip identical pushes. */
    const signature = `${display}|${running}|${mode}`;
    if (signature === lastPushedTitle) return;
    lastPushedTitle = signature;
    shell.updateTimer({ display, running, label: MODE_LABELS[mode] });
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

  /* ---------------- To-do list ---------------- */
  function makeTodoId() {
    return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function addTodo(text, minutes) {
    const trimmed = (text || "").trim().slice(0, 60);
    if (!trimmed) return;
    state.todos.unshift({
      id: makeTodoId(),
      text: trimmed,
      minutes: clampMinutes(minutes, CUSTOM_MIN_MINUTES, CUSTOM_MAX_MINUTES),
      createdAt: new Date().toISOString(),
    });
    state.todos = capTodos(state.todos);
    saveState(state);
    renderTodos();
  }

  /* Finishing a task takes it off the list — the Session Log keeps the record. */
  function removeTodo(id) {
    state.todos = state.todos.filter((t) => t.id !== id);
    if (activeTodoId === id) activeTodoId = null;
    if (editingTodoId === id) editingTodoId = null;
    saveState(state);
    renderTodos();
  }

  function startEditTodo(id) {
    editingTodoId = id;
    renderTodos();
  }

  function cancelEditTodo() {
    editingTodoId = null;
    renderTodos();
  }

  function updateTodo(id, text, minutes) {
    const todo = state.todos.find((t) => t.id === id);
    if (!todo) return;
    const trimmed = (text || "").trim().slice(0, 60);
    if (trimmed) todo.text = trimmed;
    todo.minutes = clampMinutes(minutes, CUSTOM_MIN_MINUTES, CUSTOM_MAX_MINUTES);
    editingTodoId = null;
    saveState(state);
    renderTodos();
  }

  function startTodo(id) {
    if (running) return;
    const todo = state.todos.find((t) => t.id === id);
    if (!todo) return;
    state.customMinutes = todo.minutes;
    saveState(state);
    setMode("custom", { keepActiveTodo: true });
    activeTodoId = todo.id;
    el.taskInput.value = todo.text;
    saveTimerSnapshot();
    start();
  }

  /**
   * Credits time actually spent to the active to-do and detaches it. Called
   * whenever a to-do-linked session ends — finished, reset, or abandoned by
   * switching modes — so "spent" reflects real effort, not just completions.
   */
  function releaseActiveTodo(elapsedSeconds) {
    if (!activeTodoId) return;
    const todo = state.todos.find((t) => t.id === activeTodoId);
    if (todo && elapsedSeconds > 0) {
      todo.actualSeconds = (todo.actualSeconds || 0) + Math.round(elapsedSeconds);
    }
    activeTodoId = null;
  }

  function elapsedSeconds() {
    return Math.max(0, totalDuration - Math.max(0, remaining));
  }

  function renderTodos() {
    el.todoList.innerHTML = "";

    if (!state.todos.length) {
      const empty = document.createElement("p");
      empty.className = "todo-empty";
      empty.textContent = "No tasks yet. Add one above.";
      el.todoList.appendChild(empty);
      return;
    }

    state.todos.forEach((todo) => {
      if (todo.id === editingTodoId) {
        el.todoList.appendChild(renderTodoEditRow(todo));
        return;
      }

      const row = document.createElement("div");
      row.className = "todo-item";

      const check = document.createElement("button");
      check.type = "button";
      check.className = "todo-item__check";
      check.setAttribute("aria-label", `Mark "${todo.text}" done`);
      check.addEventListener("click", () => removeTodo(todo.id));

      const main = document.createElement("div");
      main.className = "todo-item__main";
      const text = document.createElement("div");
      text.className = "todo-item__text";
      text.textContent = todo.text;

      const spentMinutes = Math.round((todo.actualSeconds || 0) / 60);
      const minutes = document.createElement("div");
      minutes.className = "todo-item__minutes";
      if (todo.actualSeconds) {
        minutes.textContent = `est ${todo.minutes}m · spent ${formatMinutes(spentMinutes)}`;
        if (spentMinutes > todo.minutes) minutes.classList.add("is-over");
      } else {
        minutes.textContent = `est ${todo.minutes}m`;
      }

      main.appendChild(text);
      main.appendChild(minutes);

      const play = document.createElement("button");
      play.type = "button";
      play.className = "todo-item__play";
      play.setAttribute("aria-label", `Start a ${todo.minutes} minute timer for ${todo.text}`);
      play.textContent = "▶";
      play.disabled = running;
      play.addEventListener("click", () => startTodo(todo.id));

      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "todo-item__edit";
      edit.setAttribute("aria-label", `Edit "${todo.text}"`);
      edit.textContent = "✎";
      edit.disabled = running && activeTodoId === todo.id;
      edit.addEventListener("click", () => startEditTodo(todo.id));

      const del = document.createElement("button");
      del.type = "button";
      del.className = "todo-item__delete";
      del.setAttribute("aria-label", `Delete "${todo.text}"`);
      del.textContent = "✕";
      del.disabled = running && activeTodoId === todo.id;
      del.addEventListener("click", () => removeTodo(todo.id));

      row.appendChild(check);
      row.appendChild(main);
      row.appendChild(play);
      row.appendChild(edit);
      row.appendChild(del);
      el.todoList.appendChild(row);
    });
  }

  /** Builds the inline edit row for a to-do: text + minutes inputs with save/cancel. */
  function renderTodoEditRow(todo) {
    const row = document.createElement("form");
    row.className = "todo-item todo-item--editing";

    const text = document.createElement("input");
    text.type = "text";
    text.className = "todo-item__edit-text";
    text.maxLength = 60;
    text.value = todo.text;
    text.setAttribute("aria-label", "Task name");

    const minutes = document.createElement("input");
    minutes.type = "number";
    minutes.className = "todo-item__edit-minutes";
    minutes.min = String(CUSTOM_MIN_MINUTES);
    minutes.max = String(CUSTOM_MAX_MINUTES);
    minutes.value = String(todo.minutes);
    minutes.setAttribute("aria-label", "Minutes");

    const save = document.createElement("button");
    save.type = "submit";
    save.className = "todo-item__save";
    save.setAttribute("aria-label", "Save task");
    save.textContent = "✓";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "todo-item__cancel";
    cancel.setAttribute("aria-label", "Cancel editing");
    cancel.textContent = "✕";
    cancel.addEventListener("click", cancelEditTodo);

    row.addEventListener("submit", (e) => {
      e.preventDefault();
      updateTodo(todo.id, text.value, minutes.value);
    });
    row.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelEditTodo();
      }
    });

    row.appendChild(text);
    row.appendChild(minutes);
    row.appendChild(save);
    row.appendChild(cancel);

    queueMicrotask(() => {
      text.focus();
      text.select();
    });

    return row;
  }

  /* ---------------- Task autosuggest ---------------- */
  function renderSuggestions() {
    const names = buildTaskSuggestions(state.sessions, state.todos, 20);
    el.taskSuggestions.innerHTML = "";
    names.forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      el.taskSuggestions.appendChild(opt);
    });
  }

  /* ---------------- Session log ---------------- */
  function addLogEntry(task, xpEarned, minutes, sessionMode) {
    state.sessions.unshift({
      task: task || "Untitled focus session",
      time: new Date().toISOString(),
      xp: xpEarned,
      minutes,
      mode: sessionMode,
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

  /* ---------------- Tabs & settings sheet ---------------- */
  function selectTab(paneId) {
    el.tabs.forEach((tab) => tab.setAttribute("aria-selected", String(tab.dataset.pane === paneId)));
    el.panes.forEach((pane) => {
      pane.hidden = pane.id !== paneId;
    });
  }

  function setSettingsOpen(open) {
    el.settingsSheet.hidden = !open;
    (open ? el.closeSettings : el.openSettings).focus();
  }

  /* ---------------- Stats ---------------- */
  const DAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];

  function renderStatsPanel() {
    const totals = summarizeSessions(state.sessions, todayStr());
    el.figTodayCount.textContent = totals.today.count;
    el.figTodayMinutes.textContent = formatMinutes(totals.today.minutes);
    el.figWeekCount.textContent = totals.week.count;
    el.figWeekMinutes.textContent = formatMinutes(totals.week.minutes);
    el.figMonthCount.textContent = totals.month.count;
    el.figMonthMinutes.textContent = formatMinutes(totals.month.minutes);

    const days = sessionsPerDay(state.sessions, CHART_DAYS, todayStr());
    const goal = state.settings.dailyGoal;
    /* Scale to whichever is taller so the goal line always stays on the chart. */
    const ceiling = Math.max(goal, ...days.map((d) => d.count), 1);

    el.statsChart.innerHTML = "";

    /* Bars and the goal line share one plot box so their percentages line up. */
    const plot = document.createElement("div");
    plot.className = "chart__plot";

    const goalLine = document.createElement("div");
    goalLine.className = "chart__goal";
    goalLine.style.bottom = `${(goal / ceiling) * 100}%`;
    plot.appendChild(goalLine);

    const labels = document.createElement("div");
    labels.className = "chart__labels";

    days.forEach((day) => {
      const col = document.createElement("div");
      col.className = "chart__col";
      col.title = `${day.date}: ${day.count} session${day.count === 1 ? "" : "s"}${day.minutes ? ` · ${formatMinutes(day.minutes)}` : ""}`;

      const bar = document.createElement("div");
      bar.className = "chart__bar" + (day.count >= goal ? " is-goal-met" : "");
      bar.style.height = `${(day.count / ceiling) * 100}%`;
      col.appendChild(bar);
      plot.appendChild(col);

      const label = document.createElement("span");
      label.className = "chart__label";
      label.textContent = DAY_INITIALS[new Date(day.date + "T00:00:00").getDay()];
      labels.appendChild(label);
    });

    el.statsChart.appendChild(plot);
    el.statsChart.appendChild(labels);
  }

  /* ---------------- Settings ---------------- */
  function renderSettings() {
    Object.keys(SETTING_INPUTS).forEach((key) => {
      SETTING_INPUTS[key].value = state.settings[key];
    });
    el.setAlarm.value = state.settings.alarmSound;
    el.setVolume.value = Math.round(state.settings.alarmVolume * 100);
    el.setVolume.disabled = state.settings.alarmSound === "none";
    el.setAutoStart.checked = state.settings.autoStart;
    el.setNotify.checked = state.settings.notify;
  }

  function updateSetting(key, value) {
    state.settings = normalizeSettings(Object.assign({}, state.settings, { [key]: value }));
    saveState(state);

    /* A duration change only takes effect on an idle timer of that mode —
       never yank time out from under a running session. */
    if (!running && MODE_SETTING_KEYS[mode] === key) {
      totalDuration = durationFor(mode);
      remaining = totalDuration;
      renderTimer();
    }

    renderSettings();
    renderStats();
    renderStatsPanel();
  }

  function stepSetting(key, delta) {
    const [min, max] = SETTING_RANGES[key];
    updateSetting(key, clampInt(state.settings[key] + delta, min, max));
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
    pushTimerToShell();
  }

  function renderModeButtons() {
    el.modeButtons.forEach((btn) => {
      const isActive = btn.dataset.mode === mode;
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
      btn.disabled = running;
    });
    el.customDuration.hidden = mode !== "custom";
    el.customMinutesInput.value = state.customMinutes;
    el.customMinutesInput.disabled = running;
    el.customMinusBtn.disabled = running;
    el.customPlusBtn.disabled = running;
  }

  function renderStats() {
    el.statStreak.textContent = state.currentStreak;
    el.statToday.textContent = `${state.todayCount}/${state.settings.dailyGoal}`;
    el.statToday.classList.toggle("is-goal-met", state.todayCount >= state.settings.dailyGoal);
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
    renderTodos();
    renderSuggestions();
    renderStatsPanel();
    renderSettings();
  }

  /* ---------------- Timer engine ---------------- */
  function setMode(newMode, opts = {}) {
    if (running && !opts.force) return;
    if (!opts.keepActiveTodo) releaseActiveTodo(elapsedSeconds());
    mode = newMode;
    state.lastMode = newMode;
    totalDuration = durationFor(mode);
    remaining = totalDuration;
    running = false;
    endTime = null;
    sessionStart = null;
    clearTick();
    saveState(state);
    clearTimerSnapshot();
    renderAll();
  }

  function setCustomMinutes(newMinutes) {
    if (running) return;
    state.customMinutes = clampMinutes(newMinutes, CUSTOM_MIN_MINUTES, CUSTOM_MAX_MINUTES);
    saveState(state);
    if (mode === "custom") {
      totalDuration = durationFor("custom");
      remaining = totalDuration;
      renderTimer();
    }
    el.customMinutesInput.value = state.customMinutes;
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
    requestNotificationPermission();
    if (remaining <= 0) remaining = totalDuration;
    running = true;
    endTime = Date.now() + remaining * 1000;
    if (!sessionStart) sessionStart = new Date();
    clearTick();
    tickHandle = setInterval(tick, 250);
    renderTimer();
    renderModeButtons();
    renderTodos();
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
    releaseActiveTodo(elapsedSeconds());
    remaining = totalDuration;
    endTime = null;
    sessionStart = null;
    saveState(state);
    clearTimerSnapshot();
    renderTimer();
    renderModeButtons();
    renderTodos();
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
    playAlarm();
    clearTimerSnapshot();

    const wasWork = mode === "focus" || mode === "custom";
    const startedAt = sessionStart || new Date();
    const finishedTodoId = activeTodoId;
    const sessionMinutes = Math.round(totalDuration / 60);
    releaseActiveTodo(totalDuration);

    if (wasWork) {
      ensureTodayFresh();
      if (mode === "focus") {
        state.currentStreak = nextStreak(state.lastSessionDate, state.currentStreak, todayStr());
        state.lastSessionDate = todayStr();
        state.longestStreak = Math.max(state.longestStreak, state.currentStreak);
      }
      state.todayCount += 1;
      state.totalSessions += 1;

      const xpEarned = focusSessionXp(state.currentStreak);
      const applied = applyXp(state.xp, state.level, xpEarned);
      state.xp = applied.xp;
      state.level = applied.level;

      let taskName = null;
      if (finishedTodoId) {
        const todo = state.todos.find((t) => t.id === finishedTodoId);
        if (todo) {
          taskName = todo.text;
          state.todos = state.todos.filter((t) => t.id !== finishedTodoId);
        }
      }
      if (!taskName) taskName = el.taskInput.value.trim().slice(0, 60);
      addLogEntry(taskName, xpEarned, sessionMinutes, mode);

      state.badges = evaluateBadges(state.badges, {
        totalSessions: state.totalSessions,
        longestStreak: state.longestStreak,
        todayCount: state.todayCount,
        level: state.level,
        startHour: startedAt.getHours(),
      });

      el.taskInput.value = "";

      const nextMode = nextBreakMode(state.totalSessions);
      const label = finishedTodoId ? "Task" : "Focus session";
      saveState(state);
      renderAll();
      announce(`${label} complete. ${xpEarned} XP earned. ${MODE_LABELS[nextMode]} starting.`);
      notifySessionEnd(
        `${label} complete · +${xpEarned} XP`,
        `${taskName || "Focus"} — ${MODE_LABELS[nextMode].toLowerCase()} up next.`
      );
      setMode(nextMode, { force: true });
      autoStartNext();
    } else {
      const finishedLabel = MODE_LABELS[mode];
      saveState(state);
      renderAll();
      announce(`${finishedLabel} complete. Back to Focus.`);
      notifySessionEnd(`${finishedLabel} over`, "Back to focus.");
      setMode("focus", { force: true });
      autoStartNext();
    }
  }

  function autoStartNext() {
    if (state.settings.autoStart) start();
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

  el.customMinutesInput.addEventListener("change", () => setCustomMinutes(el.customMinutesInput.value));
  el.customMinusBtn.addEventListener("click", () => setCustomMinutes(state.customMinutes - 1));
  el.customPlusBtn.addEventListener("click", () => setCustomMinutes(state.customMinutes + 1));

  el.todoForm.addEventListener("submit", (e) => {
    e.preventDefault();
    addTodo(el.todoInput.value, el.todoMinutesInput.value);
    el.todoInput.value = "";
    el.todoInput.focus();
  });

  el.tabs.forEach((tab) => {
    tab.addEventListener("click", () => selectTab(tab.dataset.pane));
  });

  el.openSettings.addEventListener("click", () => setSettingsOpen(true));
  el.closeSettings.addEventListener("click", () => setSettingsOpen(false));

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !el.settingsSheet.hidden) setSettingsOpen(false);
  });

  el.stepButtons.forEach((btn) => {
    const [key, delta] = btn.dataset.step.split(":");
    btn.addEventListener("click", () => stepSetting(key, Number(delta)));
  });

  Object.keys(SETTING_INPUTS).forEach((key) => {
    SETTING_INPUTS[key].addEventListener("change", () => updateSetting(key, SETTING_INPUTS[key].value));
  });

  el.setAlarm.addEventListener("change", () => {
    updateSetting("alarmSound", el.setAlarm.value);
    playAlarm();
  });

  el.setVolume.addEventListener("change", () => {
    updateSetting("alarmVolume", clampVolume(Number(el.setVolume.value) / 100));
    playAlarm();
  });

  el.setAutoStart.addEventListener("change", () => updateSetting("autoStart", el.setAutoStart.checked));

  el.setNotify.addEventListener("change", () => {
    updateSetting("notify", el.setNotify.checked);
    requestNotificationPermission();
  });

  if (shell && shell.onCommand) {
    shell.onCommand((action) => {
      if (action === "toggle") running ? pause() : start();
      else if (action === "reset") reset();
    });
  }

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
