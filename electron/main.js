const { app, BrowserWindow, Menu, Notification, Tray, ipcMain, nativeImage } = require("electron");
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
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
