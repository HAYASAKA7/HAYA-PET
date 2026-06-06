const { contextBridge, ipcRenderer } = require("electron");

// Minimal, safe bridge between the sandboxed renderer and the main process.
// No Node APIs are exposed to the renderer directly.
contextBridge.exposeInMainWorld("aiPet", {
  listSessions: () => ipcRenderer.invoke("ai-pet:list-sessions"),
  savePetPosition: (local) => ipcRenderer.invoke("ai-pet:save-pet-position", local),
  setMouseIgnore: (ignore) => ipcRenderer.send("ai-pet:set-mouse-ignore", ignore),
  onConfig: (handler) => ipcRenderer.on("ai-pet:config", (_event, config) => handler(config)),
  onSessions: (handler) => ipcRenderer.on("ai-pet:sessions", (_event, payload) => handler(payload)),
  onPetPosition: (handler) => ipcRenderer.on("ai-pet:pet-position", (_event, pos) => handler(pos)),
  onDisplayMode: (handler) => ipcRenderer.on("ai-pet:display-mode", (_event, mode) => handler(mode))
});
