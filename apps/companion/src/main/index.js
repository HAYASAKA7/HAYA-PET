import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createDaemonRuntime } from "../../../../packages/daemon-core/src/daemon-runtime.js";
import { createIpcServer } from "../../../../packages/daemon-core/src/ipc-server.js";
import {
  createApprovalWatchCoordinator,
  watchForApprovedProcess
} from "../../../../packages/daemon-core/src/approval-process-watcher.js";
import { createProcessSnapshotLister } from "../../../../packages/platform-core/src/process-snapshot.js";
import { getDefaultPaths } from "../../../../packages/platform-core/src/paths.js";
import { getPlatformCapabilities } from "../../../../packages/platform-core/src/capabilities.js";
import { buildBubbleViews } from "../../../../packages/session-core/src/bubble-view.js";
import { clampScale } from "../../../../packages/pet-core/src/pet-scale.js";
import { buildPetWindowOptions, PET_SIZE } from "./window-options.js";
import { resolveSavedPosition } from "./display-manager.js";
import { getPetScale, setPetScale, setSelectedPet, updateGlobalPetPosition } from "./position-store.js";
import { buildTrayMenu } from "./tray-menu.js";
import { createStateFile } from "./state-file.js";
import { discoverPets } from "./pet-loader.js";

const STALE_SWEEP_INTERVAL_MS = 10_000;
const __dirname = dirname(fileURLToPath(import.meta.url));

// Fallback tray icon (16×16 blue dot) used when no tray.png asset is present, so
// the tray — and therefore the Quit menu — always appears. Without it, a missing
// icon left users with no way to exit.
const TRAY_ICON_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAANElEQVR4nGNgoAXIW/HvPzZMtkaiDCJWM05DKDKAVM0YhowaQAUDBj4dUCUpE2MQQY3kAACyf/g8DHVl5wAAAABJRU5ErkJggg==";

const paths = getDefaultPaths();
const capabilities = getPlatformCapabilities();
const stateFile = createStateFile({ statePath: paths.statePath });

let petWindow;
let tray;
let ipcServer;
let positionState;
let pets = [];
let runtime;
// The overlay window spans this work area; the pet is positioned *inside* it at
// `petLocal` (work-area-relative coords) and moved via CSS rather than by moving
// the window, so the bubble panel can always be placed on-screen beside it.
let currentWorkArea;
let currentDisplayId;
let petLocal = { x: 0, y: 0 };
// User-chosen pet scale (resize grip); the pet occupies PET_SIZE × petScale.
let petScale = 1;
let approvalWatch;

// Electron singleton: a second launch forwards to the running instance.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => focusPet());
  app.whenReady().then(bootstrap).catch((error) => {
    console.error("haya-pet companion failed to start:", error);
    app.quit();
  });
}

async function bootstrap() {
  positionState = await stateFile.load();
  petScale = clampScale(getPetScale(positionState));
  pets = await discoverPets(paths.petSearchPaths);

  // Clients fire no event at the moment the user ACCEPTS a permission prompt
  // (only denial/finish are observable), so a waiting_approval session would
  // otherwise look stuck until its tool completed. The approval watcher flips
  // it to running_tool when the approved command verifiably starts — a new
  // persistent process under the client — and never on a timer, so a genuinely
  // unanswered prompt keeps warning. Unsupported platforms simply skip this.
  const processLister = createProcessSnapshotLister();
  approvalWatch = processLister
    ? createApprovalWatchCoordinator({
        createWatcher: ({ rootPid, onApproved }) =>
          watchForApprovedProcess({ rootPid, listProcesses: processLister, onApproved }),
        onApproved: (sessionId) => {
          try {
            runtime.handleMessage({
              type: "state",
              sessionId,
              state: "running_tool",
              summary: "approved",
              confidence: 0.6,
              source: "client_log",
              updatedAt: Date.now()
            });
          } catch {
            // The session may have unregistered between detection and report.
          }
        }
      })
    : undefined;

  runtime = createDaemonRuntime({
    onSessionChanged: (session) => {
      approvalWatch?.onSessionChanged(session);
      pushSessions();
    }
  });

  ipcServer = await createIpcServer({
    endpoint: paths.ipcEndpoint,
    onMessage: (message) => {
      // `haya-pet stop` asks the daemon to exit; everything else is a session event.
      if (message?.type === "shutdown") {
        app.quit();
        return;
      }
      return runtime.handleMessage(message);
    },
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
    approvalWatch?.stopAll();
    await ipcServer?.close();
  });
}

function createPetWindow() {
  const displays = listDisplays();
  // Resolve the pet's saved on-screen position (pet-sized), which also tells us
  // which display it belongs on. The window then spans that display's work area.
  const saved = resolveSavedPosition(positionState.globalPet, displays);
  const display = displays.find((d) => d.id === saved.displayId)
    ?? displays.find((d) => d.primary)
    ?? displays[0];
  currentWorkArea = display.workArea ?? display.bounds;
  currentDisplayId = display.id;
  petLocal = clampPetLocal({ x: saved.x - currentWorkArea.x, y: saved.y - currentWorkArea.y });

  const { browserWindow } = buildPetWindowOptions({ capabilities, bounds: currentWorkArea });

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
  // The whole work area is covered, so empty area MUST pass clicks through to the
  // desktop; the renderer re-enables interaction (via haya-pet:set-mouse-ignore)
  // only over the pet + bubbles.
  petWindow.setIgnoreMouseEvents(true, { forward: true });
  petWindow.loadFile(join(__dirname, "..", "renderer", "index.html"));
  petWindow.webContents.on("did-finish-load", () => {
    sendPetConfig();
    pushSessions();
  });
}

function scaledPetSize() {
  return {
    width: Math.round(PET_SIZE.width * petScale),
    height: Math.round(PET_SIZE.height * petScale)
  };
}

function clampPetLocal(local) {
  const size = scaledPetSize();
  const maxX = Math.max(0, (currentWorkArea?.width ?? size.width) - size.width);
  const maxY = Math.max(0, (currentWorkArea?.height ?? size.height) - size.height);
  return {
    x: Math.min(Math.max(local.x ?? 0, 0), maxX),
    y: Math.min(Math.max(local.y ?? 0, 0), maxY)
  };
}

function createTray() {
  try {
    tray = new Tray(loadTrayIcon());
    tray.setToolTip("Haya Pet — right-click to Quit");
  } catch (error) {
    // A failed tray must not take the whole app down; log and continue.
    console.error("tray unavailable:", error.message);
    return;
  }
  refreshTrayMenu();
}

function loadTrayIcon() {
  const fileIcon = nativeImage.createFromPath(join(__dirname, "..", "renderer", "assets", "tray.png"));
  // createFromPath returns an empty image (no throw) when the file is missing.
  return fileIcon.isEmpty() ? nativeImage.createFromDataURL(TRAY_ICON_DATA_URL) : fileIcon;
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
  ipcMain.handle("haya-pet:list-sessions", () => buildSessionPayload());

  // Fired on every cursor move while hovering the overlay, so use the
  // fire-and-forget channel (no round-trip) to toggle click-through.
  ipcMain.on("haya-pet:set-mouse-ignore", (_event, ignore) => {
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.setIgnoreMouseEvents(Boolean(ignore), { forward: true });
    }
  });

  // The pet moves within the overlay (CSS), so the renderer reports its new
  // work-area-relative position instead of moving the window.
  ipcMain.handle("haya-pet:save-pet-position", async (_event, local) => {
    petLocal = clampPetLocal(local ?? petLocal);
    persistPetPosition();
    return petLocal;
  });

  // Resize grip released (or double-clicked to reset): store the new scale and
  // re-clamp the position so a grown pet never sticks out of the work area.
  ipcMain.handle("haya-pet:save-pet-scale", async (_event, scale) => {
    petScale = clampScale(scale);
    petLocal = clampPetLocal(petLocal);
    persistPetPosition();
    return petScale;
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
    petWindow.webContents.send("haya-pet:sessions", buildSessionPayload());
  }
}

function sendPetConfig() {
  const selected = pets.find((pet) => pet.manifest.id === positionState.globalPet.selectedPetId) ?? pets[0];
  petWindow.webContents.send("haya-pet:config", {
    pet: selected
      ? { manifest: selected.manifest, spritesheetUrl: selected.spritesheetUrl }
      : undefined,
    overlayMode: capabilities.transparentOverlay === "required" ? "transparent-overlay" : "fallback-window",
    petPosition: petLocal,
    petScale
  });
}

function sendPetPosition() {
  petWindow?.webContents.send("haya-pet:pet-position", petLocal);
}

let persistTimer;
function persistPetPosition() {
  if (!currentWorkArea) {
    return;
  }

  // Store the pet's absolute on-screen top-left so it can be restored on the
  // right display, mapping the in-window position back to screen coordinates.
  // The persisted box is the *scaled* size, so display restore clamps correctly.
  const size = scaledPetSize();
  positionState = setPetScale(updateGlobalPetPosition(positionState, {
    x: currentWorkArea.x + petLocal.x,
    y: currentWorkArea.y + petLocal.y,
    width: size.width,
    height: size.height,
    displayId: currentDisplayId
  }), petScale);

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
  // Drop the pet back to the bottom-right corner of its work area.
  const margin = 24;
  const size = scaledPetSize();
  petLocal = clampPetLocal({
    x: (currentWorkArea?.width ?? size.width) - size.width - margin,
    y: (currentWorkArea?.height ?? size.height) - size.height - margin
  });
  sendPetPosition();
  persistPetPosition();
}

function setDisplayMode(displayMode) {
  positionState = { ...positionState, settings: { ...positionState.settings, displayMode } };
  stateFile.save(positionState).catch(() => {});
  petWindow?.webContents.send("haya-pet:display-mode", displayMode);
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
