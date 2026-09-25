const { app, BrowserWindow, Menu, Notification, Tray, ipcMain, nativeImage } = require("electron");
const { execFile } = require("child_process");
const path = require("path");

/* Dev runs (`electron .`) share the generic "Electron" app bundle, so the
   macOS menu bar and Dock label read "Electron" unless overridden here.
   Must be set before 'ready' to take effect. A packaged build (npm run
   build) doesn't need this — electron-builder names the bundle "Dial"
   from package.json's productName. */
app.setName("Dial");

/* All Dial windows share one saved-data file regardless of which folder they
   run from (userData is keyed by app name, not path). A second instance
   can't get a write lock on that file, so it would load blank and — on any
   action — overwrite the real data. Refuse the second launch and just focus
   the existing window instead. */
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

const ICON_PATH = path.join(__dirname, "build", "icon.png");
const TRAY_ICON_PATH = path.join(__dirname, "build", "trayTemplate.png");

let win = null;
let tray = null;
let quitting = false;
let timerState = { display: "", running: false, label: "Focus" };
let guardTimer = null;
let guardBusy = false;
let guardActive = false;
let guardGeneration = 0;
let guardApps = [];
let lastGuardedApp = "";
let lastGuardedAt = 0;

function createWindow() {
  win = new BrowserWindow({
    width: 380,
    height: 720,
    minWidth: 320,
    minHeight: 560,
    maxWidth: 460,
    backgroundColor: "#17181c",
    title: "Dial",
    icon: ICON_PATH,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, "..", "index.html"));
  win.once("ready-to-show", () => win.show());

  /* Closing the window only hides it, so the renderer keeps ticking and the
     tray countdown stays live. Quit explicitly from the tray or Cmd+Q. */
  win.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    win.hide();
  });

  win.on("closed", () => {
    win = null;
  });
}

function showWindow() {
  if (!win) {
    createWindow();
    return;
  }
  win.show();
  win.focus();
}

function send(action) {
  if (win && !win.isDestroyed()) win.webContents.send("dial:command", action);
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: timerState.display ? `${timerState.label} · ${timerState.display}` : "Dial — idle", enabled: false },
    { type: "separator" },
    { label: timerState.running ? "Pause" : "Start", click: () => send("toggle") },
    { label: "Reset", click: () => send("reset") },
    { type: "separator" },
    { label: "Show Dial", click: showWindow },
    {
      label: "Quit Dial",
      accelerator: "Command+Q",
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
}

function createTray() {
  const image = nativeImage.createFromPath(TRAY_ICON_PATH);
  image.setTemplateImage(true);
  tray = new Tray(image);
  tray.setToolTip("Dial");
  tray.setContextMenu(buildTrayMenu());
}

function refreshTray() {
  if (!tray) return;
  /* An empty title collapses the tray item back to just the icon when idle. */
  tray.setTitle(timerState.display ? ` ${timerState.display}` : "");
  tray.setToolTip(timerState.display ? `Dial — ${timerState.label} ${timerState.display}` : "Dial");
  tray.setContextMenu(buildTrayMenu());
}

ipcMain.on("dial:timer-update", (_event, snapshot) => {
  timerState = Object.assign(timerState, snapshot || {});
  refreshTray();
});

function stopFocusGuard() {
  if (guardTimer) clearInterval(guardTimer);
  guardTimer = null;
  guardBusy = false;
  guardActive = false;
  guardGeneration += 1;
}

function runAppleScript(args, callback) {
  execFile("/usr/bin/osascript", args, { timeout: 2500 }, callback);
}

function checkFocusGuard() {
  if (!guardActive || guardBusy || !guardApps.length || process.platform !== "darwin") return;
  guardBusy = true;
  const generation = guardGeneration;
  runAppleScript(
    ["-e", 'tell application "System Events" to get name of first application process whose frontmost is true'],
    (error, stdout) => {
      if (generation !== guardGeneration) return;
      const frontmost = String(stdout || "").trim();
      const blocked = !error && guardApps.find((name) => name.toLocaleLowerCase() === frontmost.toLocaleLowerCase());
      if (!guardActive || !blocked || frontmost === "Dial" || frontmost === "Electron") {
        guardBusy = false;
        return;
      }
      const now = Date.now();
      if (lastGuardedApp === frontmost && now - lastGuardedAt < 3000) {
        guardBusy = false;
        return;
      }
      /* The app name is passed as argv, never interpolated into AppleScript. */
      runAppleScript(
        [
          "-e", "on run argv",
          "-e", "set targetName to item 1 of argv",
          "-e", 'tell application "System Events" to set visible of process targetName to false',
          "-e", "end run",
          frontmost,
        ],
        (hideError) => {
          if (generation !== guardGeneration) return;
          guardBusy = false;
          if (hideError || !guardActive) return;
          lastGuardedApp = frontmost;
          lastGuardedAt = now;
          showWindow();
          if (win && !win.isDestroyed()) win.webContents.send("dial:guard-blocked", { app: frontmost });
        }
      );
    }
  );
}

ipcMain.on("dial:focus-guard", (_event, config) => {
  stopFocusGuard();
  guardApps = Array.isArray(config && config.apps)
    ? config.apps.map((name) => String(name).trim()).filter(Boolean).slice(0, 20)
    : [];
  if (!config || !config.active || !guardApps.length || process.platform !== "darwin") return;
  guardActive = true;
  checkFocusGuard();
  guardTimer = setInterval(checkFocusGuard, 1500);
});

/* Bouncing the Dock needs no permission, so it's the one alert that always
   lands — including unpackaged dev runs, where macOS refuses notifications
   from the generic Electron bundle (UNErrorDomain 1). A "critical" bounce
   keeps going until you switch to the app, which is the point: you're not
   looking at Dial while it counts down. */
function demandAttention() {
  if (process.platform === "darwin" && app.dock) app.dock.bounce("critical");
}

ipcMain.on("dial:notify", (_event, payload) => {
  const focused = win && !win.isDestroyed() && win.isFocused();
  if (focused) return; // you're already looking at it

  demandAttention();

  if (!Notification.isSupported()) return;
  const notification = new Notification({
    title: (payload && payload.title) || "Dial",
    body: (payload && payload.body) || "",
    silent: true, // the renderer already plays the chosen alarm
  });
  notification.on("click", showWindow);
  notification.show();
});

app.on("second-instance", () => {
  showWindow();
});

app.whenReady().then(() => {
  /* macOS dev runs (`electron .`) ignore BrowserWindow's `icon` for the Dock —
     only a packaged .app picks up build.mac.icon, so set it explicitly here. */
  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(ICON_PATH);
  }

  createWindow();
  createTray();

  app.on("activate", showWindow);
});

app.on("before-quit", () => {
  quitting = true;
  stopFocusGuard();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
