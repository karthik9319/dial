(() => {
  "use strict";

  const {
    MODES,
    MODE_LABELS,
    MODE_SETTING_KEYS,
    DEFAULT_SETTINGS,
    BADGE_DEFS,
    ACCENT_REWARDS,
    DIAL_FACE_REWARDS,
    WORKSHOP_REWARDS,
    todayStr,
    xpForLevel,
    applyXp,
    focusSessionXp,
    nextStreak,
    nextModeAfterWork,
    isAccentUnlocked,
    tokensEarnedBetween,
    nextProgressReward,
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
      focusSessions: 0,
      focusTokens: 0,
      ownedRewards: [],
      rewardTrackVersion: 1,
      badges: {},
      sessions: [],
      todos: [],
      customMinutes: DEFAULT_CUSTOM_MINUTES,
      settings: Object.assign({}, DEFAULT_SETTINGS),
      lastMode: "focus",
      theme: null,
    };
  }

  function normalizeState(stored) {
    const state = Object.assign(defaultState(), stored || {});
    state.badges = Object.assign({}, stored && stored.badges);
    state.sessions = capSessions(
      (Array.isArray(state.sessions) ? state.sessions : []).filter(
        (session) => session && typeof session === "object" && !Array.isArray(session)
      )
    );
    if (!stored || !Number.isFinite(Number(stored.focusSessions))) {
      /* Older versions tracked all work together. Rebuild the focus-only
         cadence so custom errands cannot trigger long breaks. */
      state.focusSessions = state.sessions.filter((session) => session.mode === "focus").length;
    } else {
      state.focusSessions = Math.max(0, Math.round(Number(stored.focusSessions)));
    }
    /* Finished tasks used to linger in the list with a `done` flag; they now
       leave it outright, so drop any left over from that older format. */
    const todos = (Array.isArray(state.todos) ? state.todos : []).filter((t) => t && !t.done);
    state.todos = capTodos(todos).map((todo) => ({
      id: todo.id || makeId(),
      text: String(todo.text || "Untitled task").trim().slice(0, 60) || "Untitled task",
      category: typeof todo.category === "string" ? todo.category.trim().slice(0, 30) : "",
      minutes: clampMinutes(todo.minutes, CUSTOM_MIN_MINUTES, CUSTOM_MAX_MINUTES),
      actualSeconds: Math.max(0, Number(todo.actualSeconds) || 0),
      createdAt: todo.createdAt || new Date().toISOString(),
    }));
    state.customMinutes = clampMinutes(state.customMinutes, CUSTOM_MIN_MINUTES, CUSTOM_MAX_MINUTES);
    state.settings = normalizeSettings(state.settings);
    state.xp = Math.max(0, Math.round(Number(state.xp) || 0));
    state.level = Math.max(1, Math.round(Number(state.level) || 1));
    const validRewardIds = new Set(WORKSHOP_REWARDS.map((reward) => reward.id));
    state.ownedRewards = Array.from(new Set(Array.isArray(state.ownedRewards) ? state.ownedRewards : []))
      .filter((id) => validRewardIds.has(id));
    state.focusTokens = stored && stored.rewardTrackVersion === 1
      ? Math.max(0, Math.round(Number(state.focusTokens) || 0))
      : Math.max(0, state.level - 10);
    state.rewardTrackVersion = 1;
    if (state.level >= 5) state.badges.level_5 = true;
    if (state.level >= 10) state.badges.level_10 = true;
    const ownsValue = (kind, value) => WORKSHOP_REWARDS.some(
      (reward) => reward.kind === kind && reward.value === value && state.ownedRewards.includes(reward.id)
    );
    if (state.settings.dialFace === "chronograph" && state.level < 10) state.settings.dialFace = "classic";
    if (state.settings.dialFace === "precision" && !ownsValue("dialFace", "precision")) state.settings.dialFace = "classic";
    if (state.settings.backdrop !== "standard" && !ownsValue("backdrop", state.settings.backdrop)) state.settings.backdrop = "standard";
    if (state.settings.alarmSound === "gong" && !ownsValue("alarmSound", "gong")) state.settings.alarmSound = "chime";
    state.currentStreak = Math.max(0, Math.round(Number(state.currentStreak) || 0));
    state.longestStreak = Math.max(0, Math.round(Number(state.longestStreak) || 0));
    state.todayCount = Math.max(0, Math.round(Number(state.todayCount) || 0));
    state.totalSessions = Math.max(0, Math.round(Number(state.totalSessions) || 0));

    const now = todayStr();
    if (state.today !== now) {
      state.today = now;
      state.todayCount = 0;
    }
    return state;
  }

  function loadState() {
    let stored = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) stored = JSON.parse(raw);
    } catch (e) {
      stored = null;
    }
    return normalizeState(stored);
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
          categoryDraft: el.taskCategoryInput.value,
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
  let pendingCategoryDraft = "";
  let activeTodoId = null;
  let editingTodoId = null;
  let pendingCompletion = null;

  /* Resume an in-flight timer left over from before a reload/close, if any. */
  (function restoreTimer() {
    const snap = loadTimerSnapshot();
    if (!snap || !isValidMode(snap.mode)) return;

    mode = snap.mode;
    totalDuration = durationFor(mode);
    sessionStart = snap.sessionStart ? new Date(snap.sessionStart) : null;
    pendingTaskDraft = snap.taskDraft || "";
    pendingCategoryDraft = snap.categoryDraft || "";
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
    screenContext: document.getElementById("screenContext"),
    themeToggle: document.getElementById("themeToggle"),
    modeButtons: Array.from(document.querySelectorAll(".mode-btn")),
    taskInput: document.getElementById("taskInput"),
    taskCategoryInput: document.getElementById("taskCategoryInput"),
    customDuration: document.getElementById("customDuration"),
    customMinutesInput: document.getElementById("customMinutesInput"),
    customMinusBtn: document.getElementById("customMinusBtn"),
    customPlusBtn: document.getElementById("customPlusBtn"),
    todoForm: document.getElementById("todoForm"),
    todoInput: document.getElementById("todoInput"),
    todoMinutesInput: document.getElementById("todoMinutesInput"),
    todoCategoryInput: document.getElementById("todoCategoryInput"),
    todoList: document.getElementById("todoList"),
    onboarding: document.getElementById("onboarding"),
    onboardingCta: document.getElementById("onboardingCta"),
    queueCount: document.getElementById("queueCount"),
    taskSuggestions: document.getElementById("taskSuggestions"),
    categorySuggestions: document.getElementById("categorySuggestions"),
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
    xpReward: document.getElementById("xpReward"),
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
    estimateEmpty: document.getElementById("estimateEmpty"),
    estimateContent: document.getElementById("estimateContent"),
    estimateVariance: document.getElementById("estimateVariance"),
    estimateOnTarget: document.getElementById("estimateOnTarget"),
    estimateTasks: document.getElementById("estimateTasks"),
    estimateInsight: document.getElementById("estimateInsight"),
    categoryBreakdown: document.getElementById("categoryBreakdown"),
    collectionLevel: document.getElementById("collectionLevel"),
    collectionXpText: document.getElementById("collectionXpText"),
    collectionXpFill: document.getElementById("collectionXpFill"),
    collectionNextReward: document.getElementById("collectionNextReward"),
    openCollection: document.getElementById("openCollection"),
    focusNextTask: document.getElementById("focusNextTask"),
    focusNextMeta: document.getElementById("focusNextMeta"),
    focusNextStart: document.getElementById("focusNextStart"),
    setFocus: document.getElementById("setFocus"),
    setShort: document.getElementById("setShort"),
    setLong: document.getElementById("setLong"),
    setGoal: document.getElementById("setGoal"),
    setAlarm: document.getElementById("setAlarm"),
    setAccent: document.getElementById("setAccent"),
    setDialFace: document.getElementById("setDialFace"),
    setBackdrop: document.getElementById("setBackdrop"),
    setVolume: document.getElementById("setVolume"),
    setAutoStart: document.getElementById("setAutoStart"),
    setNotify: document.getElementById("setNotify"),
    setFocusGuard: document.getElementById("setFocusGuard"),
    setBlockedApps: document.getElementById("setBlockedApps"),
    focusGuardRow: document.getElementById("focusGuardRow"),
    focusGuardHelp: document.getElementById("focusGuardHelp"),
    workshopBalance: document.getElementById("workshopBalance"),
    workshopHelp: document.getElementById("workshopHelp"),
    workshopList: document.getElementById("workshopList"),
    exportBackup: document.getElementById("exportBackup"),
    exportCsv: document.getElementById("exportCsv"),
    importBackup: document.getElementById("importBackup"),
    importBackupFile: document.getElementById("importBackupFile"),
    stepButtons: Array.from(document.querySelectorAll("[data-step]")),
    tabs: Array.from(document.querySelectorAll(".tab")),
    panes: Array.from(document.querySelectorAll(".pane")),
    settingsSheet: document.getElementById("settingsSheet"),
    openSettings: document.getElementById("openSettings"),
    closeSettings: document.getElementById("closeSettings"),
    rewardToast: document.getElementById("rewardToast"),
    rewardToastText: document.getElementById("rewardToastText"),
    completionSheet: document.getElementById("completionSheet"),
    completionTask: document.getElementById("completionTask"),
    completionTiming: document.getElementById("completionTiming"),
    completionCategory: document.getElementById("completionCategory"),
    completionNote: document.getElementById("completionNote"),
    completionDone: document.getElementById("completionDone"),
    completionContinue: document.getElementById("completionContinue"),
    completionAnother: document.getElementById("completionAnother"),
    completionQueue: document.getElementById("completionQueue"),
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
  if (pendingCategoryDraft) el.taskCategoryInput.value = pendingCategoryDraft;

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

  function applyAccent() {
    const accent = isAccentUnlocked(state.settings.accent, state.level) ? state.settings.accent : "brass";
    if (accent !== state.settings.accent) state.settings.accent = accent;
    document.documentElement.setAttribute("data-accent", accent);
  }

  function ownsReward(id) {
    return state.ownedRewards.includes(id);
  }

  function ownsCosmetic(kind, value) {
    const reward = WORKSHOP_REWARDS.find((item) => item.kind === kind && item.value === value);
    return !!reward && ownsReward(reward.id);
  }

  function applyCosmetics() {
    applyAccent();
    let dialFace = state.settings.dialFace;
    if (dialFace === "chronograph" && state.level < 10) dialFace = "classic";
    if (dialFace === "precision" && !ownsCosmetic("dialFace", "precision")) dialFace = "classic";
    let backdrop = state.settings.backdrop;
    if (backdrop !== "standard" && !ownsCosmetic("backdrop", backdrop)) backdrop = "standard";
    state.settings.dialFace = dialFace;
    state.settings.backdrop = backdrop;
    document.documentElement.setAttribute("data-dial-face", dialFace);
    document.documentElement.setAttribute("data-backdrop", backdrop);
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
  applyCosmetics();

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
    gong: [
      { freq: 196, type: "sine", at: 0, hold: 1.4, peak: 0.24 },
      { freq: 294, type: "sine", at: 0.02, hold: 1.1, peak: 0.09 },
      { freq: 392, type: "sine", at: 0.04, hold: 0.8, peak: 0.04 },
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

  let lastGuardSignature = null;
  function updateFocusGuard() {
    if (!shell || shell.platform !== "darwin" || !shell.configureGuard) return;
    const active = state.settings.focusGuard && running && (mode === "focus" || mode === "custom");
    const apps = state.settings.blockedApps
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)
      .slice(0, 20);
    const signature = `${active}|${apps.join("|")}`;
    if (signature === lastGuardSignature) return;
    lastGuardSignature = signature;
    shell.configureGuard({ active, apps });
  }

  if (shell && shell.onGuardBlocked) {
    shell.onGuardBlocked((payload) => {
      const appName = payload && payload.app ? payload.app : "That app";
      showStatusToast(`${appName} was hidden by Focus Guard`);
      announce(`${appName} was hidden by Focus Guard.`);
    });
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
  function makeId() {
    return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function cleanCategory(category) {
    return String(category || "").trim().slice(0, 30);
  }

  function addTodo(text, minutes, category, actualSeconds) {
    const trimmed = (text || "").trim().slice(0, 60);
    if (!trimmed) return null;
    const todo = {
      id: makeId(),
      text: trimmed,
      category: cleanCategory(category),
      minutes: clampMinutes(minutes, CUSTOM_MIN_MINUTES, CUSTOM_MAX_MINUTES),
      actualSeconds: Math.max(0, Number(actualSeconds) || 0),
      createdAt: new Date().toISOString(),
    };
    state.todos.unshift(todo);
    state.todos = capTodos(state.todos);
    saveState(state);
    renderTodos();
    renderSuggestions();
    return todo;
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

  function updateTodo(id, text, minutes, category) {
    const todo = state.todos.find((t) => t.id === id);
    if (!todo) return;
    const trimmed = (text || "").trim().slice(0, 60);
    if (trimmed) todo.text = trimmed;
    todo.category = cleanCategory(category);
    todo.minutes = clampMinutes(minutes, CUSTOM_MIN_MINUTES, CUSTOM_MAX_MINUTES);
    editingTodoId = null;
    saveState(state);
    renderTodos();
  }

  function startTodo(id) {
    if (running) return;
    const todo = state.todos.find((t) => t.id === id);
    if (!todo) return;
    if (activeTodoId) releaseActiveTodo(elapsedSeconds());
    state.customMinutes = todo.minutes;
    saveState(state);
    setMode("custom", { keepActiveTodo: true });
    activeTodoId = todo.id;
    el.taskInput.value = todo.text;
    el.taskCategoryInput.value = todo.category || "";
    saveTimerSnapshot();
    selectTab("paneFocus");
    start();
  }

  /**
   * Credits time actually spent to the active to-do and optionally detaches
   * it. A reset keeps the same task attached; switching modes abandons the
   * active assignment but preserves the effort already spent.
   */
  function releaseActiveTodo(elapsedSeconds, detach = true) {
    if (!activeTodoId) return;
    const todo = state.todos.find((t) => t.id === activeTodoId);
    if (todo && elapsedSeconds > 0) {
      todo.actualSeconds = (todo.actualSeconds || 0) + Math.round(elapsedSeconds);
    }
    if (detach) activeTodoId = null;
  }

  function elapsedSeconds() {
    return Math.max(0, totalDuration - Math.max(0, remaining));
  }

  function renderTodos() {
    el.todoList.innerHTML = "";
    const isFirstRun = !state.todos.length && !state.sessions.length;
    el.onboarding.hidden = !isFirstRun;
    el.queueCount.textContent = `${state.todos.length} queued`;
    renderFocusNext();

    if (!state.todos.length) {
      if (isFirstRun) return;
      const empty = document.createElement("p");
      empty.className = "todo-empty";
      empty.textContent = "Your queue is clear. Add what you want to focus on next.";
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
      check.disabled = running && activeTodoId === todo.id;
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
        minutes.textContent = `${todo.category ? `${todo.category} · ` : ""}est ${todo.minutes}m · spent ${formatMinutes(spentMinutes)}`;
        if (spentMinutes > todo.minutes) minutes.classList.add("is-over");
      } else {
        minutes.textContent = `${todo.category ? `${todo.category} · ` : ""}est ${todo.minutes}m`;
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

  function renderFocusNext() {
    const todo = state.todos.find((item) => item.id !== activeTodoId);
    if (!todo) {
      el.focusNextTask.textContent = "Your queue is clear";
      el.focusNextMeta.textContent = "Plan your next focus block";
      el.focusNextStart.textContent = "+";
      el.focusNextStart.setAttribute("aria-label", "Open Plan to add a task");
      el.focusNextStart.disabled = false;
      return;
    }
    el.focusNextTask.textContent = todo.text;
    el.focusNextMeta.textContent = `${todo.category ? `${todo.category} · ` : ""}${todo.minutes} min estimate`;
    el.focusNextStart.textContent = "▶";
    el.focusNextStart.setAttribute("aria-label", `Start ${todo.text}`);
    el.focusNextStart.disabled = running;
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

    const category = document.createElement("input");
    category.type = "text";
    category.className = "todo-item__edit-category";
    category.maxLength = 30;
    category.value = todo.category || "";
    category.setAttribute("aria-label", "Category");
    category.setAttribute("placeholder", "Category");
    category.setAttribute("list", "categorySuggestions");

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
      updateTodo(todo.id, text.value, minutes.value, category.value);
    });
    row.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelEditTodo();
      }
    });

    row.appendChild(text);
    row.appendChild(category);
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

    const categories = [];
    const seenCategories = new Set();
    [...state.todos, ...state.sessions].forEach((item) => {
      const category = cleanCategory(item.category);
      const key = category.toLocaleLowerCase();
      if (!category || seenCategories.has(key)) return;
      seenCategories.add(key);
      categories.push(category);
    });
    el.categorySuggestions.innerHTML = "";
    categories.slice(0, 20).forEach((category) => {
      const opt = document.createElement("option");
      opt.value = category;
      el.categorySuggestions.appendChild(opt);
    });
  }

  /* ---------------- Session log ---------------- */
  function addLogEntry(task, xpEarned, minutes, sessionMode, category) {
    const entry = {
      id: makeId(),
      task: task || "Untitled focus session",
      time: new Date().toISOString(),
      xp: xpEarned,
      minutes,
      mode: sessionMode,
      category: cleanCategory(category),
      outcome: "block",
    };
    state.sessions.unshift(entry);
    state.sessions = capSessions(state.sessions);
    return entry;
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
      const when = d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      const details = [];
      if (entry.category) details.push(entry.category);
      if (entry.outcome === "done" && Number.isFinite(Number(entry.actualMinutes))) {
        details.push(`est ${formatMinutes(entry.estimatedMinutes)} / actual ${formatMinutes(entry.actualMinutes)}`);
      } else if (entry.outcome === "queued") {
        details.push("returned to queue");
      } else if (entry.outcome === "continued") {
        details.push("continued");
      }
      time.textContent = details.length ? `${when} · ${details.join(" · ")}` : when;

      main.appendChild(task);
      main.appendChild(time);
      if (entry.note) {
        const note = document.createElement("div");
        note.className = "log-entry__note";
        note.textContent = entry.note;
        main.appendChild(note);
      }

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
    const contexts = {
      paneFocus: "Focus with intention",
      panePlan: "Shape the next block",
      paneInsights: "Learn from your patterns",
      paneCollection: "Rewards earned through focus",
    };
    el.screenContext.textContent = contexts[paneId] || contexts.paneFocus;
    document.querySelector(".app-panes").scrollTop = 0;
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

    const accuracy = summarizeEstimateAccuracy(state.sessions, todayStr(), 30);
    el.estimateEmpty.hidden = accuracy.count > 0;
    el.estimateContent.hidden = accuracy.count === 0;
    if (accuracy.count) {
      const sign = accuracy.variancePercent > 0 ? "+" : "";
      el.estimateVariance.textContent = `${sign}${accuracy.variancePercent}%`;
      el.estimateOnTarget.textContent = `${accuracy.onTargetPercent}%`;
      el.estimateTasks.textContent = String(accuracy.count);
      if (accuracy.mostUnderestimatedCategory) {
        const group = accuracy.mostUnderestimatedCategory;
        el.estimateInsight.textContent = `${group.category} runs about ${group.variancePercent}% over your estimates. Try adding that buffer next time.`;
      } else if (accuracy.variancePercent > 10) {
        el.estimateInsight.textContent = `Tasks are taking about ${accuracy.variancePercent}% longer than estimated. Try adding that buffer next time.`;
      } else if (accuracy.variancePercent < -10) {
        el.estimateInsight.textContent = `You are finishing about ${Math.abs(accuracy.variancePercent)}% faster than estimated. Your next estimates can be tighter.`;
      } else {
        el.estimateInsight.textContent = "Your estimates are tracking closely with actual time. Keep marking tasks done to improve the signal.";
      }
    }
    renderCategoryBreakdown();
  }

  function renderCategoryBreakdown() {
    el.categoryBreakdown.innerHTML = "";
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 29);
    cutoff.setHours(0, 0, 0, 0);
    const groups = new Map();
    state.sessions.forEach((session) => {
      const timestamp = new Date(session.time);
      if (!Number.isFinite(timestamp.getTime()) || timestamp < cutoff) return;
      const category = cleanCategory(session.category) || "Uncategorized";
      const current = groups.get(category) || { minutes: 0, sessions: 0 };
      current.minutes += Math.max(0, Number(session.minutes) || 0);
      current.sessions += 1;
      groups.set(category, current);
    });
    const ranked = Array.from(groups, ([category, values]) => ({ category, ...values }))
      .sort((a, b) => b.minutes - a.minutes || b.sessions - a.sessions)
      .slice(0, 5);
    if (!ranked.length) {
      const empty = document.createElement("p");
      empty.className = "category-breakdown__empty";
      empty.textContent = "Add categories to focus sessions to see where your time goes.";
      el.categoryBreakdown.appendChild(empty);
      return;
    }
    const maxMinutes = Math.max(...ranked.map((group) => group.minutes), 1);
    ranked.forEach((group) => {
      const row = document.createElement("div");
      row.className = "category-breakdown__row";
      const head = document.createElement("div");
      head.className = "category-breakdown__head";
      const name = document.createElement("span");
      name.textContent = group.category;
      const value = document.createElement("span");
      value.textContent = `${formatMinutes(group.minutes)} · ${group.sessions}`;
      head.appendChild(name);
      head.appendChild(value);
      const track = document.createElement("div");
      track.className = "category-breakdown__track";
      const fill = document.createElement("div");
      fill.className = "category-breakdown__fill";
      fill.style.width = `${Math.max(5, (group.minutes / maxMinutes) * 100)}%`;
      track.appendChild(fill);
      row.appendChild(head);
      row.appendChild(track);
      el.categoryBreakdown.appendChild(row);
    });
  }

  /* ---------------- Settings ---------------- */
  function purchaseWorkshopReward(id) {
    const reward = WORKSHOP_REWARDS.find((item) => item.id === id);
    if (!reward || state.level < 10 || ownsReward(id) || state.focusTokens < reward.cost) return;
    state.focusTokens -= reward.cost;
    state.ownedRewards.push(id);
    state.settings[reward.kind] = reward.value;
    saveState(state);
    applyCosmetics();
    renderSettings();
    renderStats();
    if (reward.kind === "alarmSound") playAlarm(reward.value);
    showStatusToast(`${reward.label} added to your collection`);
    announce(`${reward.label} purchased for ${reward.cost} Focus Token${reward.cost === 1 ? "" : "s"}.`);
  }

  function renderWorkshop() {
    el.workshopBalance.textContent = String(state.focusTokens);
    el.workshopHelp.textContent = state.level < 10
      ? "Unlocks at Level 10. Level 11 awards your first Focus Token."
      : state.focusTokens
        ? "Spend tokens on cosmetics. Core focus features always stay unlocked."
        : `Level ${state.level + 1} awards your next Focus Token.`;
    el.workshopList.innerHTML = "";

    WORKSHOP_REWARDS.forEach((reward) => {
      const owned = ownsReward(reward.id);
      const locked = state.level < 10;
      const row = document.createElement("div");
      row.className = `workshop-item workshop-item--${reward.kind}` + (owned ? " is-owned" : "");

      const copy = document.createElement("div");
      copy.className = "workshop-item__copy";
      const name = document.createElement("div");
      name.className = "workshop-item__name";
      name.textContent = reward.label;
      const description = document.createElement("div");
      description.className = "workshop-item__description";
      description.textContent = reward.description;
      copy.appendChild(name);
      copy.appendChild(description);

      const button = document.createElement("button");
      button.type = "button";
      button.className = "workshop-item__buy";
      button.disabled = locked || owned || state.focusTokens < reward.cost;
      button.textContent = owned ? "Owned" : locked ? "Level 10" : `${reward.cost} ◆`;
      button.setAttribute("aria-label", owned
        ? `${reward.label} owned`
        : `Buy ${reward.label} for ${reward.cost} Focus Token${reward.cost === 1 ? "" : "s"}`);
      button.addEventListener("click", () => purchaseWorkshopReward(reward.id));

      row.appendChild(copy);
      row.appendChild(button);
      el.workshopList.appendChild(row);
    });
  }

  function renderSettings() {
    Object.keys(SETTING_INPUTS).forEach((key) => {
      SETTING_INPUTS[key].value = state.settings[key];
    });
    const gongOption = el.setAlarm.querySelector('option[value="gong"]');
    if (gongOption) gongOption.disabled = !ownsCosmetic("alarmSound", "gong");
    el.setAlarm.value = state.settings.alarmSound;
    el.setAccent.innerHTML = "";
    ACCENT_REWARDS.forEach((reward) => {
      const option = document.createElement("option");
      const unlocked = isAccentUnlocked(reward.id, state.level);
      option.value = reward.id;
      option.disabled = !unlocked;
      option.textContent = unlocked ? reward.label : `${reward.label} · Level ${reward.level}`;
      el.setAccent.appendChild(option);
    });
    el.setAccent.value = state.settings.accent;

    el.setDialFace.innerHTML = "";
    DIAL_FACE_REWARDS.forEach((reward) => {
      const option = document.createElement("option");
      const unlocked = state.level >= reward.level;
      option.value = reward.id;
      option.disabled = !unlocked;
      option.textContent = unlocked ? reward.label : `${reward.label} · Level ${reward.level}`;
      el.setDialFace.appendChild(option);
    });
    const precisionOption = document.createElement("option");
    precisionOption.value = "precision";
    precisionOption.disabled = !ownsCosmetic("dialFace", "precision");
    precisionOption.textContent = precisionOption.disabled ? "Precision · Workshop" : "Precision";
    el.setDialFace.appendChild(precisionOption);
    el.setDialFace.value = state.settings.dialFace;

    el.setBackdrop.innerHTML = "";
    [{ value: "standard", label: "Standard" }, ...WORKSHOP_REWARDS
      .filter((reward) => reward.kind === "backdrop")
      .map((reward) => ({ value: reward.value, label: reward.label, reward }))]
      .forEach((item) => {
        const option = document.createElement("option");
        const unlocked = !item.reward || ownsReward(item.reward.id);
        option.value = item.value;
        option.disabled = !unlocked;
        option.textContent = unlocked ? item.label : `${item.label} · Workshop`;
        el.setBackdrop.appendChild(option);
      });
    el.setBackdrop.value = state.settings.backdrop;
    el.setVolume.value = Math.round(state.settings.alarmVolume * 100);
    el.setVolume.disabled = state.settings.alarmSound === "none";
    el.setAutoStart.checked = state.settings.autoStart;
    el.setNotify.checked = state.settings.notify;
    el.setFocusGuard.checked = state.settings.focusGuard;
    el.setBlockedApps.value = state.settings.blockedApps;
    const guardAvailable = !!(shell && shell.platform === "darwin" && shell.configureGuard);
    el.setFocusGuard.disabled = !guardAvailable;
    el.setBlockedApps.disabled = !guardAvailable || !state.settings.focusGuard;
    el.focusGuardRow.classList.toggle("is-unavailable", !guardAvailable);
    el.setBlockedApps.closest(".setting-field").classList.toggle("is-unavailable", !guardAvailable);
    el.focusGuardHelp.textContent = guardAvailable
      ? "Hide selected macOS apps while a focus timer runs."
      : "Available in the macOS desktop app; browser pages cannot control other apps.";
    renderWorkshop();
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
    if (key === "accent" || key === "dialFace" || key === "backdrop") applyCosmetics();
    if (key === "focusGuard" || key === "blockedApps") updateFocusGuard();
    renderStats();
    renderStatsPanel();
  }

  function stepSetting(key, delta) {
    const [min, max] = SETTING_RANGES[key];
    updateSetting(key, clampInt(state.settings[key] + delta, min, max));
  }

  /* ---------------- Portable data ---------------- */
  function downloadFile(filename, contents, mimeType) {
    const blob = new Blob([contents], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportBackup() {
    const payload = {
      format: "dial-backup",
      version: 2,
      exportedAt: new Date().toISOString(),
      state,
    };
    downloadFile(`dial-backup-${todayStr()}.json`, JSON.stringify(payload, null, 2), "application/json");
    showStatusToast("Backup downloaded");
  }

  function csvCell(value) {
    const text = value === null || value === undefined ? "" : String(value);
    /* Prevent user-entered task names/notes from becoming spreadsheet formulas. */
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  }

  function exportSessionsCsv() {
    const columns = [
      "time", "task", "category", "block_minutes", "outcome",
      "estimated_minutes", "actual_minutes", "xp", "note",
    ];
    const rows = state.sessions.map((session) => [
      session.time,
      session.task,
      session.category,
      session.minutes,
      session.outcome,
      session.estimatedMinutes,
      session.actualMinutes,
      session.xp,
      session.note,
    ].map(csvCell).join(","));
    const csv = [columns.join(","), ...rows].join("\n");
    downloadFile(`dial-sessions-${todayStr()}.csv`, csv, "text/csv;charset=utf-8");
    showStatusToast("Sessions CSV downloaded");
  }

  async function restoreBackup(file) {
    try {
      if (!file || file.size > 5 * 1024 * 1024) throw new Error("Choose a Dial JSON backup under 5 MB.");
      const parsed = JSON.parse(await file.text());
      const restored = parsed && parsed.format === "dial-backup" ? parsed.state : parsed;
      if (!restored || typeof restored !== "object" || Array.isArray(restored)) {
        throw new Error("This file does not contain a Dial backup.");
      }
      if (!window.confirm("Restore this backup? Your current Dial data will be replaced.")) return;

      running = false;
      clearTick();
      clearTimerSnapshot();
      pendingCompletion = null;
      activeTodoId = null;
      editingTodoId = null;
      state = normalizeState(restored);
      mode = isValidMode(state.lastMode) ? state.lastMode : "focus";
      totalDuration = durationFor(mode);
      remaining = totalDuration;
      endTime = null;
      sessionStart = null;
      el.taskInput.value = "";
      el.taskCategoryInput.value = "";
      el.completionSheet.hidden = true;
      saveState(state);
      applyTheme();
      applyCosmetics();
      renderAll();
      updateFocusGuard();
      showStatusToast("Backup restored");
      announce("Dial backup restored.");
    } catch (error) {
      showStatusToast(error && error.message ? error.message : "Could not restore that backup");
    } finally {
      el.importBackupFile.value = "";
    }
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
    const nextReward = nextProgressReward(state.level);
    const tokenBalance = state.level >= 10
      ? `${state.focusTokens} Focus Token${state.focusTokens === 1 ? "" : "s"} · `
      : "";
    const rewardVerb = nextReward.kind === "token" ? "awards" : "unlocks";
    el.xpReward.textContent = `${tokenBalance}Level ${nextReward.level} ${rewardVerb} ${nextReward.label}`;
    el.collectionLevel.textContent = String(state.level);
    el.collectionXpText.textContent = `${state.xp} / ${needed} XP`;
    el.collectionXpFill.style.width = `${Math.min(100, (state.xp / needed) * 100)}%`;
    el.collectionNextReward.textContent = `Next: Level ${nextReward.level} ${rewardVerb} ${nextReward.label}`;
  }

  let rewardToastHandle = null;
  function showStatusToast(message) {
    if (!message) return;
    el.rewardToastText.textContent = message;
    el.rewardToast.hidden = false;
    if (rewardToastHandle) clearTimeout(rewardToastHandle);
    rewardToastHandle = window.setTimeout(() => {
      el.rewardToast.hidden = true;
      rewardToastHandle = null;
    }, 4500);
  }

  function showRewardToast(reward) {
    if (!reward) return;
    showStatusToast(reward.message || `Level ${reward.level} reached · ${reward.label} unlocked`);
  }

  function levelRewardEarned(previousLevel, currentLevel, tokensEarned) {
    if (currentLevel <= previousLevel) return null;
    if (previousLevel < 10 && currentLevel >= 10) {
      return { level: 10, message: "Level 10 reached · Chronograph dial and badge unlocked" };
    }
    const accent = [...ACCENT_REWARDS]
      .reverse()
      .find((reward) => reward.level > previousLevel && reward.level <= currentLevel);
    if (accent) return { level: accent.level, message: `Level ${accent.level} reached · ${accent.label} finish unlocked` };
    if (tokensEarned) {
      return {
        level: currentLevel,
        message: `Level ${currentLevel} reached · +${tokensEarned} Focus Token${tokensEarned === 1 ? "" : "s"}`,
      };
    }
    return { level: currentLevel, message: `Level ${currentLevel} reached` };
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

  /* ---------------- End-of-block review ---------------- */
  function getSession(id) {
    return state.sessions.find((session) => session.id === id) || null;
  }

  function openCompletionReview(review) {
    pendingCompletion = review;
    el.completionTask.textContent = review.task;
    el.completionTiming.textContent = `Estimated ${formatMinutes(review.estimatedMinutes)} · ${formatMinutes(review.blockMinutes)} focus block logged`;
    el.completionCategory.value = review.category || "";
    el.completionNote.value = "";
    el.completionSheet.hidden = false;
    queueMicrotask(() => el.completionDone.focus());
  }

  function saveCompletionMeta(outcome) {
    if (!pendingCompletion) return null;
    const entry = getSession(pendingCompletion.sessionId);
    const category = cleanCategory(el.completionCategory.value);
    const note = el.completionNote.value.trim().slice(0, 240);
    if (entry) {
      entry.outcome = outcome;
      entry.category = category;
      entry.note = note;
    }
    const todo = pendingCompletion.todoId
      ? state.todos.find((item) => item.id === pendingCompletion.todoId)
      : null;
    if (todo) todo.category = category;
    return { entry, todo, category };
  }

  function ensureCompletionTodo(meta) {
    if (meta.todo) return meta.todo;
    const todo = addTodo(
      pendingCompletion.task,
      pendingCompletion.estimatedMinutes,
      meta.category,
      pendingCompletion.blockSeconds
    );
    pendingCompletion.todoId = todo && todo.id;
    return todo;
  }

  function closeCompletionReview() {
    el.completionSheet.hidden = true;
    el.completionNote.value = "";
  }

  function finishTaskFromReview() {
    if (!pendingCompletion) return;
    const review = pendingCompletion;
    const meta = saveCompletionMeta("done");
    const actualSeconds = meta.todo
      ? Number(meta.todo.actualSeconds) || review.blockSeconds
      : review.blockSeconds;
    if (meta.entry) {
      meta.entry.estimatedMinutes = meta.todo ? meta.todo.minutes : review.estimatedMinutes;
      meta.entry.actualMinutes = Math.round((actualSeconds / 60) * 10) / 10;
    }
    if (meta.todo) state.todos = state.todos.filter((item) => item.id !== meta.todo.id);
    activeTodoId = null;
    el.taskInput.value = "";
    el.taskCategoryInput.value = "";
    closeCompletionReview();
    pendingCompletion = null;
    saveState(state);
    setMode(review.nextMode, { force: true });
    showRewardToast(review.unlockedReward);
    announce(`Task marked done. ${MODE_LABELS[review.nextMode]} is ready.`);
    autoStartNext();
  }

  function continueTaskFromReview(minutes) {
    if (!pendingCompletion) return;
    const meta = saveCompletionMeta("continued");
    const todo = ensureCompletionTodo(meta);
    if (!todo) return;
    const task = pendingCompletion.task;
    const category = meta.category;
    state.customMinutes = clampMinutes(minutes, CUSTOM_MIN_MINUTES, CUSTOM_MAX_MINUTES);
    activeTodoId = todo.id;
    closeCompletionReview();
    pendingCompletion = null;
    saveState(state);
    setMode("custom", { force: true, keepActiveTodo: true });
    el.taskInput.value = task;
    el.taskCategoryInput.value = category;
    saveTimerSnapshot();
    start();
    showRewardToast(review.unlockedReward);
    announce(`Continuing ${task} for ${state.customMinutes} minutes.`);
  }

  function queueTaskFromReview() {
    if (!pendingCompletion) return;
    const review = pendingCompletion;
    const meta = saveCompletionMeta("queued");
    ensureCompletionTodo(meta);
    activeTodoId = null;
    el.taskInput.value = "";
    el.taskCategoryInput.value = "";
    closeCompletionReview();
    pendingCompletion = null;
    saveState(state);
    setMode(review.nextMode, { force: true });
    showRewardToast(review.unlockedReward);
    announce(`Task returned to the queue. ${MODE_LABELS[review.nextMode]} is ready.`);
    autoStartNext();
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
    updateFocusGuard();
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
    updateFocusGuard();
  }

  function pause() {
    if (!running) return;
    running = false;
    remaining = (endTime - Date.now()) / 1000;
    clearTick();
    renderTimer();
    renderModeButtons();
    renderTodos();
    saveTimerSnapshot();
    updateFocusGuard();
  }

  function reset() {
    running = false;
    clearTick();
    releaseActiveTodo(elapsedSeconds(), false);
    remaining = totalDuration;
    endTime = null;
    sessionStart = null;
    saveState(state);
    clearTimerSnapshot();
    renderTimer();
    renderModeButtons();
    renderTodos();
    updateFocusGuard();
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
    updateFocusGuard();

    const wasWork = mode === "focus" || mode === "custom";
    const startedAt = sessionStart || new Date();
    const finishedTodoId = activeTodoId;
    const sessionMinutes = Math.round(totalDuration / 60);
    sessionStart = null;
    endTime = null;

    if (wasWork) {
      /* The timer proves a block elapsed, not that the task is finished. Keep
         the linked task attached until the user answers the review sheet. */
      releaseActiveTodo(totalDuration, false);
      ensureTodayFresh();
      if (mode === "focus") {
        state.currentStreak = nextStreak(state.lastSessionDate, state.currentStreak, todayStr());
        state.lastSessionDate = todayStr();
        state.longestStreak = Math.max(state.longestStreak, state.currentStreak);
        state.focusSessions += 1;
      }
      state.todayCount += 1;
      state.totalSessions += 1;

      const xpEarned = focusSessionXp(state.currentStreak);
      const previousLevel = state.level;
      const applied = applyXp(state.xp, state.level, xpEarned);
      state.xp = applied.xp;
      state.level = applied.level;
      const tokensEarned = tokensEarnedBetween(previousLevel, state.level);
      state.focusTokens += tokensEarned;

      const todo = finishedTodoId ? state.todos.find((t) => t.id === finishedTodoId) : null;
      let taskName = todo ? todo.text : null;
      if (!taskName) taskName = el.taskInput.value.trim().slice(0, 60);
      if (!taskName) taskName = "Untitled focus session";
      const category = todo ? todo.category : cleanCategory(el.taskCategoryInput.value);
      const estimate = todo ? todo.minutes : sessionMinutes;
      const entry = addLogEntry(taskName, xpEarned, sessionMinutes, mode, category);

      state.badges = evaluateBadges(state.badges, {
        totalSessions: state.totalSessions,
        longestStreak: state.longestStreak,
        todayCount: state.todayCount,
        level: state.level,
        startHour: startedAt.getHours(),
      });

      const unlockedReward = levelRewardEarned(previousLevel, state.level, tokensEarned);
      const nextMode = nextModeAfterWork(mode, state.focusSessions);
      saveState(state);
      renderAll();
      announce(`Focus block complete. ${xpEarned} XP earned. Choose whether the task is done or needs more time.`);
      notifySessionEnd(
        `Focus block complete · +${xpEarned} XP`,
        `${taskName} — is the task finished?`
      );
      openCompletionReview({
        sessionId: entry.id,
        todoId: todo && todo.id,
        task: taskName,
        category,
        estimatedMinutes: estimate,
        blockMinutes: sessionMinutes,
        blockSeconds: totalDuration,
        nextMode,
        unlockedReward,
      });
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
    addTodo(el.todoInput.value, el.todoMinutesInput.value, el.todoCategoryInput.value);
    el.todoInput.value = "";
    el.todoCategoryInput.value = "";
    el.todoInput.focus();
  });

  el.onboardingCta.addEventListener("click", () => el.todoInput.focus());

  el.tabs.forEach((tab) => {
    tab.addEventListener("click", () => selectTab(tab.dataset.pane));
  });

  el.openCollection.addEventListener("click", () => selectTab("paneCollection"));
  el.focusNextStart.addEventListener("click", () => {
    const next = state.todos.find((item) => item.id !== activeTodoId);
    if (next) startTodo(next.id);
    else {
      selectTab("panePlan");
      el.todoInput.focus();
    }
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

  el.setAccent.addEventListener("change", () => updateSetting("accent", el.setAccent.value));
  el.setDialFace.addEventListener("change", () => updateSetting("dialFace", el.setDialFace.value));
  el.setBackdrop.addEventListener("change", () => updateSetting("backdrop", el.setBackdrop.value));

  el.setVolume.addEventListener("change", () => {
    updateSetting("alarmVolume", clampVolume(Number(el.setVolume.value) / 100));
    playAlarm();
  });

  el.setAutoStart.addEventListener("change", () => updateSetting("autoStart", el.setAutoStart.checked));

  el.setNotify.addEventListener("change", () => {
    updateSetting("notify", el.setNotify.checked);
    requestNotificationPermission();
  });

  el.setFocusGuard.addEventListener("change", () => {
    updateSetting("focusGuard", el.setFocusGuard.checked);
  });

  el.setBlockedApps.addEventListener("change", () => {
    updateSetting("blockedApps", el.setBlockedApps.value);
  });

  el.exportBackup.addEventListener("click", exportBackup);
  el.exportCsv.addEventListener("click", exportSessionsCsv);
  el.importBackup.addEventListener("click", () => el.importBackupFile.click());
  el.importBackupFile.addEventListener("change", () => restoreBackup(el.importBackupFile.files[0]));

  el.completionDone.addEventListener("click", finishTaskFromReview);
  el.completionContinue.addEventListener("click", () => continueTaskFromReview(5));
  el.completionAnother.addEventListener("click", () => {
    if (pendingCompletion) continueTaskFromReview(pendingCompletion.blockMinutes);
  });
  el.completionQueue.addEventListener("click", queueTaskFromReview);

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

  el.taskCategoryInput.addEventListener("input", () => {
    if (el.taskCategoryInput.value.length > 30) {
      el.taskCategoryInput.value = el.taskCategoryInput.value.slice(0, 30);
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
  updateFocusGuard();
})();
