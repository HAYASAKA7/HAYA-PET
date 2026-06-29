const { contextBridge, ipcRenderer } = require("electron");

// Minimal, safe bridge between the sandboxed renderer and the main process.
// No Node APIs are exposed to the renderer directly.
contextBridge.exposeInMainWorld("aiPet", {
  listSessions: () => ipcRenderer.invoke("haya-pet:list-sessions"),
  savePetPosition: (local) => ipcRenderer.invoke("haya-pet:save-pet-position", local),
  savePetScale: (scale) => ipcRenderer.invoke("haya-pet:save-pet-scale", scale),
  setMouseIgnore: (ignore) => ipcRenderer.send("haya-pet:set-mouse-ignore", ignore),
  showPetMenu: () => ipcRenderer.send("haya-pet:show-pet-menu"),
  onConfig: (handler) => ipcRenderer.on("haya-pet:config", (_event, config) => handler(config)),
  onSessions: (handler) => ipcRenderer.on("haya-pet:sessions", (_event, payload) => handler(payload)),
  onPetPosition: (handler) => ipcRenderer.on("haya-pet:pet-position", (_event, pos) => handler(pos)),
  onDisplayMode: (handler) => ipcRenderer.on("haya-pet:display-mode", (_event, mode) => handler(mode))
});
