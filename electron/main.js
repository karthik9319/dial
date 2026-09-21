const { app, BrowserWindow } = require("electron");
const path = require("path");

/* Dev runs (`electron .`) share the generic "Electron" app bundle, so the
   macOS menu bar and Dock label read "Electron" unless overridden here.
   Must be set before 'ready' to take effect. A packaged build (npm run
   build) doesn't need this — electron-builder names the bundle "Dial"
   from package.json's productName. */
app.setName("Dial");

const ICON_PATH = path.join(__dirname, "build", "icon.png");

function createWindow() {
  const win = new BrowserWindow({
    width: 380,
    height: 720,
    minWidth: 320,
    minHeight: 560,
    maxWidth: 460,
    backgroundColor: "#17181c",
    title: "Dial",
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, "..", "index.html"));
}

app.whenReady().then(() => {
  /* macOS dev runs (`electron .`) ignore BrowserWindow's `icon` for the Dock —
     only a packaged .app picks up build.mac.icon, so set it explicitly here. */
  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(ICON_PATH);
  }

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
