const { contextBridge, ipcRenderer } = require("electron");

// Minimal, safe bridge between the sandboxed renderer and the main process.
// No Node APIs are exposed to the renderer directly.
contextBridge.exposeInMainWorld("aiPet", {
  listSessions: () => ipcRenderer.invoke("ai-pet:list-sessions"),
  moveWindow: (position) => ipcRenderer.invoke("ai-pet:move-window", position),
  savePosition: () => ipcRenderer.invoke("ai-pet:save-position"),
  getTaskControls: (params) => ipcRenderer.invoke("ai-pet:task-controls", params),
  reply: (params) => ipcRenderer.invoke("ai-pet:reply", params),
  resolveApproval: (params) => ipcRenderer.invoke("ai-pet:approval-decision", params),
  onConfig: (handler) => ipcRenderer.on("ai-pet:config", (_event, config) => handler(config)),
  onSessions: (handler) => ipcRenderer.on("ai-pet:sessions", (_event, payload) => handler(payload)),
  onDisplayMode: (handler) => ipcRenderer.on("ai-pet:display-mode", (_event, mode) => handler(mode))
});
