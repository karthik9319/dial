const { contextBridge, ipcRenderer } = require("electron");

// The renderer owns the timer; the main process owns the tray and native
// notifications. This is the whole surface between them — the page still runs
// standalone in a browser, where window.dialBridge is simply absent.
contextBridge.exposeInMainWorld("dialBridge", {
  platform: process.platform,
  updateTimer: (snapshot) => ipcRenderer.send("dial:timer-update", snapshot),
  notify: (payload) => ipcRenderer.send("dial:notify", payload),
  configureGuard: (config) => ipcRenderer.send("dial:focus-guard", config),
  onGuardBlocked: (handler) => ipcRenderer.on("dial:guard-blocked", (_event, payload) => handler(payload)),
  onCommand: (handler) => ipcRenderer.on("dial:command", (_event, action) => handler(action)),
});
