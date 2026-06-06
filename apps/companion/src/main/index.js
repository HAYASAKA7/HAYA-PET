import { app, BrowserWindow, ipcMain, Menu, screen, Tray } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createDaemonRuntime } from "../../../../packages/daemon-core/src/daemon-runtime.js";
import { createIpcServer } from "../../../../packages/daemon-core/src/ipc-server.js";
import { getDefaultPaths } from "../../../../packages/platform-core/src/paths.js";
import { getPlatformCapabilities } from "../../../../packages/platform-core/src/capabilities.js";
import { buildBubbleViews } from "../../../../packages/session-core/src/bubble-view.js";
import { getAdapterCapabilities } from "../../../../packages/adapters/src/capabilities.js";
import { resolveTaskControls } from "../../../../packages/task-core/src/controls.js";
import { buildApprovalDecision } from "../../../../packages/task-core/src/approvals.js";
import { buildTaskInputRequest } from "../../../../packages/task-core/src/replies.js";
import { buildPetWindowOptions } from "./window-options.js";
import { resolveSavedPosition, clampWindowBounds } from "./display-manager.js";
import { setSelectedPet, updateGlobalPetPosition } from "./position-store.js";
import { buildTrayMenu } from "./tray-menu.js";
import { createStateFile } from "./state-file.js";
import { discoverPets } from "./pet-loader.js";

const STALE_SWEEP_INTERVAL_MS = 10_000;
const __dirname = dirname(fileURLToPath(import.meta.url));

const paths = getDefaultPaths();
const capabilities = getPlatformCapabilities();
const stateFile = createStateFile({ statePath: paths.statePath });

let petWindow;
let tray;
let ipcServer;
let positionState;
let pets = [];
let runtime;

// Electron singleton: a second launch forwards to the running instance.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => focusPet());
  app.whenReady().then(bootstrap).catch((error) => {
    console.error("ai-pet companion failed to start:", error);
    app.quit();
  });
}

async function bootstrap() {
  positionState = await stateFile.load();
  pets = await discoverPets(paths.petSearchPaths);

  runtime = createDaemonRuntime({
    onSessionChanged: () => pushSessions()
  });

  ipcServer = await createIpcServer({
    endpoint: paths.ipcEndpoint,
    onMessage: (message) => runtime.handleMessage(message),
    onProtocolError: (error) => console.error("protocol error:", error.message)
  });

  createPetWindow();
  createTray();
  registerRendererHandlers();

  const sweep = setInterval(() => {
    runtime.markStaleSessions(Date.now());
    // Refresh the renderer so dropped (dead/finished) sessions disappear and the
    // pet settles to idle even when no new session event fires.
    pushSessions();
  }, STALE_SWEEP_INTERVAL_MS);
  sweep.unref?.();

  app.on("before-quit", async () => {
    clearInterval(sweep);
    await ipcServer?.close();
  });
}

function createPetWindow() {
  const displays = listDisplays();
  const saved = resolveSavedPosition(positionState.globalPet, displays);
  const { browserWindow } = buildPetWindowOptions({ capabilities, bounds: saved });

  petWindow = new BrowserWindow({
    ...browserWindow,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  petWindow.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
  petWindow.loadFile(join(__dirname, "..", "renderer", "index.html"));
  petWindow.on("moved", persistWindowPosition);
  petWindow.webContents.on("did-finish-load", () => {
    sendPetConfig();
    pushSessions();
  });
}

function createTray() {
  try {
    tray = new Tray(join(__dirname, "..", "renderer", "assets", "tray.png"));
  } catch {
    // Tray icon is optional in development; the menu can still be exposed via IPC.
    return;
  }
  refreshTrayMenu();
}

function refreshTrayMenu() {
  if (!tray) {
    return;
  }

  const sessions = (runtime?.listSessions() ?? []).map((session) => ({
    sessionId: session.sessionId,
    label: `${session.clientDisplayName} · ${session.projectName}`
  }));

  const template = buildTrayMenu({
    petVisible: petWindow?.isVisible() ?? true,
    displayMode: positionState.settings.displayMode,
    attachBubblesToTerminals: positionState.settings.attachBubblesToTerminals,
    selectedPetId: positionState.globalPet.selectedPetId,
    sessions,
    pets: pets.map((pet) => ({ id: pet.manifest.id, name: pet.manifest.name }))
  }).map(toElectronMenuItem);

  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function toElectronMenuItem(item) {
  if (item.type === "separator") {
    return { type: "separator" };
  }

  const electronItem = {
    label: item.label,
    type: item.type === "checkbox" || item.type === "radio" ? item.type : undefined,
    checked: item.checked,
    enabled: item.enabled !== false
  };

  if (item.submenu) {
    electronItem.submenu = item.submenu.map(toElectronMenuItem);
  } else {
    electronItem.click = () => handleTrayClick(item);
  }

  return electronItem;
}

function handleTrayClick(item) {
  switch (item.id) {
    case "toggle_pet":
      togglePet();
      break;
    case "reset_position":
      resetPosition();
      break;
    case "quit":
      app.quit();
      break;
    default:
      if (item.id?.startsWith("display_mode:")) {
        setDisplayMode(item.value);
      } else if (item.id === "attach_bubbles") {
        toggleAttachBubbles();
      } else if (item.petId) {
        selectPet(item.petId);
      }
  }
}

function registerRendererHandlers() {
  ipcMain.handle("ai-pet:list-sessions", () => buildSessionPayload());

  ipcMain.handle("ai-pet:move-window", (_event, { x, y }) => {
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.setPosition(Math.round(x), Math.round(y));
    }
  });

  ipcMain.handle("ai-pet:save-position", async () => {
    persistWindowPosition();
    return positionState.globalPet;
  });

  ipcMain.handle("ai-pet:task-controls", (_event, { clientId, status }) => {
    return resolveTaskControls(getAdapterCapabilities(clientId), status);
  });

  ipcMain.handle("ai-pet:reply", (_event, { sessionId, text }) => {
    // Routing to adapters is a later phase; for now we record the intent.
    return buildTaskInputRequest({ sessionId, inputId: `in_${Date.now()}`, text, createdAt: Date.now() });
  });

  ipcMain.handle("ai-pet:approval-decision", (_event, { sessionId, approvalId, decision }) => {
    return buildApprovalDecision({ sessionId, approvalId, decision, decidedAt: Date.now() });
  });
}

function buildSessionPayload() {
  const sessions = runtime?.listSessions() ?? [];
  const priority = runtime?.getPrioritySession({ pinnedSessionId: positionState.globalPet.selectedSessionId });

  return {
    bubbles: buildBubbleViews(sessions, Date.now(), {
      selectedSessionId: priority?.sessionId
    }),
    prioritySessionId: priority?.sessionId
  };
}

function pushSessions() {
  refreshTrayMenu();
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send("ai-pet:sessions", buildSessionPayload());
  }
}

function sendPetConfig() {
  const selected = pets.find((pet) => pet.manifest.id === positionState.globalPet.selectedPetId) ?? pets[0];
  petWindow.webContents.send("ai-pet:config", {
    pet: selected
      ? { manifest: selected.manifest, spritesheetUrl: selected.spritesheetUrl }
      : undefined,
    overlayMode: capabilities.transparentOverlay === "required" ? "transparent-overlay" : "fallback-window"
  });
}

function applyWindowPosition(position) {
  positionState = updateGlobalPetPosition(positionState, position);
}

let persistTimer;
function persistWindowPosition() {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }

  const bounds = petWindow.getBounds();
  const display = screen.getDisplayMatching(bounds);
  applyWindowPosition({ ...bounds, displayId: String(display.id) });

  // Debounce disk writes during drag (positionSaveDebounce, plan section 27).
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    stateFile.save(positionState).catch((error) => console.error("save failed:", error.message));
  }, 200);
}

function togglePet() {
  if (!petWindow) {
    return;
  }
  petWindow.isVisible() ? petWindow.hide() : petWindow.show();
  refreshTrayMenu();
}

function focusPet() {
  petWindow?.show();
}

function resetPosition() {
  const displays = listDisplays();
  const primary = displays.find((display) => display.primary) ?? displays[0];
  const bounds = clampWindowBounds({ width: petWindow.getBounds().width, height: petWindow.getBounds().height }, primary);
  petWindow.setBounds(bounds);
  persistWindowPosition();
}

function setDisplayMode(displayMode) {
  positionState = { ...positionState, settings: { ...positionState.settings, displayMode } };
  stateFile.save(positionState).catch(() => {});
  petWindow?.webContents.send("ai-pet:display-mode", displayMode);
  refreshTrayMenu();
}

function toggleAttachBubbles() {
  const attachBubblesToTerminals = !positionState.settings.attachBubblesToTerminals;
  positionState = { ...positionState, settings: { ...positionState.settings, attachBubblesToTerminals } };
  stateFile.save(positionState).catch(() => {});
  refreshTrayMenu();
}

function selectPet(petId) {
  positionState = setSelectedPet(positionState, petId);
  stateFile.save(positionState).catch(() => {});
  sendPetConfig();
  refreshTrayMenu();
}

function listDisplays() {
  return screen.getAllDisplays().map((display) => ({
    id: String(display.id),
    primary: display.id === screen.getPrimaryDisplay().id,
    bounds: display.bounds,
    workArea: display.workArea,
    scaleFactor: display.scaleFactor
  }));
}
