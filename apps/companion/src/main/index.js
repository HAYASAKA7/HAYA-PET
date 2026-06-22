import { app, BrowserWindow, ipcMain, Menu, nativeImage, powerMonitor, screen, shell, Tray } from "electron";
import { fileURLToPath } from "node:url";
import { appendFileSync, readFileSync } from "node:fs";
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
import { clampLocalToWorkArea, resolveOverlayPlacement } from "./display-manager.js";
import { getPetScale, setPetScale, setSelectedPet, updateGlobalPetPosition } from "./position-store.js";
import { buildTrayMenu, buildTrayTooltip } from "./tray-menu.js";
import { createStateFile } from "./state-file.js";
import { discoverPetsWithFallback } from "./pet-loader.js";
import { checkForUpdate, UPDATE_PAGE_URL } from "../../../../packages/app-state/src/update-check.js";

const STALE_SWEEP_INTERVAL_MS = 10_000;
const __dirname = dirname(fileURLToPath(import.meta.url));

// Fallback tray icon (16×16 blue dot) used when no tray.png asset is present, so
// the tray — and therefore the Quit menu — always appears. Without it, a missing
// icon left users with no way to exit.
const TRAY_ICON_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAANElEQVR4nGNgoAXIW/HvPzZMtkaiDCJWM05DKDKAVM0YhowaQAUDBj4dUCUpE2MQQY3kAACyf/g8DHVl5wAAAABJRU5ErkJggg==";

// Best-effort daemon-side diagnostic, mirroring the wrapper's HAYA_PET_HOOK_DEBUG.
// When HAYA_PET_DAEMON_DEBUG points at a file, append one JSONL line per incoming
// non-heartbeat message in DAEMON ARRIVAL ORDER, with its updatedAt. This is the
// only place the true apply order is visible: the registry is last-writer-wins by
// arrival and ignores updatedAt, so a stale "working" message that arrives after
// "interrupted" would surface here as the clobber. Never throws.
function debugLogDaemonMessage(message) {
  const target = process.env.HAYA_PET_DAEMON_DEBUG;
  if (!target || !message || message.type === "heartbeat") {
    return;
  }
  try {
    appendFileSync(
      target,
      `${JSON.stringify({
        ts: Date.now(),
        type: message.type,
        sessionId: message.sessionId,
        state: message.state,
        source: message.source,
        updatedAt: message.updatedAt,
        summary: message.summary
      })}\n`
    );
  } catch {
    // diagnostics must never break the daemon
  }
}

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
// Set once the daily npm update check finds a newer version; surfaces as a
// tray item (see tray-menu.js).
let updateAvailable;

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
  pets = await discoverPetsWithFallback(paths.petSearchPaths);

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
      debugLogDaemonMessage(message);
      return runtime.handleMessage(message);
    },
    onProtocolError: (error) => console.error("protocol error:", error.message)
  });

  createPetWindow();
  createTray();
  registerRendererHandlers();
  registerDisplayWatchers();
  // Best-effort and cached in state.json (shared with the CLI's check, so at
  // most one registry request per day between them); never blocks startup.
  void detectUpdate();

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
  // Resolve which display the pet belongs on and where it sits inside that
  // display's work area; the window then spans that work area.
  applyOverlayPlacement(resolveCurrentPlacement());

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
  return clampLocalToWorkArea(local ?? petLocal, currentWorkArea, scaledPetSize());
}

// Resolve where the overlay should sit right now, given the saved position and the
// CURRENT set of displays. Used at startup and on every re-home.
function resolveCurrentPlacement() {
  return resolveOverlayPlacement({
    savedPosition: positionState.globalPet,
    displays: listDisplays(),
    petSize: scaledPetSize()
  });
}

// Adopt a resolved placement into the module's window/pet state (does NOT move the
// BrowserWindow — callers decide whether to create or setBounds).
function applyOverlayPlacement(placement) {
  currentWorkArea = placement.workArea;
  currentDisplayId = placement.displayId;
  petLocal = placement.petLocal;
}

// Re-home the overlay onto a currently-valid display and re-assert its bounds.
// A display change (monitor unplugged, resolution/DPI change, dock/undock,
// sleep→resume) can strand the window off-screen on a display that no longer
// exists: the pet "vanishes" while the process is alive, and neither Show/Hide
// nor Reset (which only move the sprite INSIDE the window) bring it back. This is
// the one operation that puts the window itself back on screen.
function rehomeOverlay({ recenter = false, persist = true } = {}) {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }

  applyOverlayPlacement(resolveCurrentPlacement());
  if (recenter) {
    petLocal = cornerPetLocal();
  }

  try {
    petWindow.setBounds(currentWorkArea);
  } catch (error) {
    // Setting bounds must never crash the overlay; the next display event retries.
    console.error("overlay re-home failed:", error.message);
  }
  if (!petWindow.isVisible()) {
    petWindow.show();
  }
  sendPetPosition();
  // Automatic re-homes (display change / resume) deliberately do NOT persist, so
  // the user's preferred display is preserved and the pet returns there once that
  // display comes back. User-initiated re-homes (reset/show) persist as usual.
  if (persist) {
    persistPetPosition();
  }
}

// Bottom-right corner of the current work area (the Reset target).
function cornerPetLocal() {
  const margin = 24;
  const size = scaledPetSize();
  return clampPetLocal({
    x: (currentWorkArea?.width ?? size.width) - size.width - margin,
    y: (currentWorkArea?.height ?? size.height) - size.height - margin
  });
}

function createTray() {
  try {
    tray = new Tray(loadTrayIcon());
    tray.setToolTip(buildTrayTooltip());
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
    pets: pets.map((pet) => ({ id: pet.manifest.id, name: pet.manifest.name })),
    updateAvailable
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

// Daily npm update check (shared cache with the CLI in state.json). On a hit,
// the tray gains an "Update Available (x.y.z)" item; checkForUpdate itself
// never throws, so this can run unawaited from bootstrap.
async function detectUpdate() {
  const update = await checkForUpdate({
    currentVersion: readPackageVersion(),
    // Every companion write flows through the in-memory positionState (load →
    // mutate → save). Mirror that here: read the live copy, and on save merge
    // only the cache key into whatever positionState is by then — a direct
    // stateFile.save of the load-time snapshot could clobber a pet move made
    // while the registry fetch was in flight.
    stateFile: {
      load: async () => positionState,
      save: async (next) => {
        positionState = { ...positionState, updateCheck: next.updateCheck };
        return stateFile.save(positionState);
      }
    }
  });
  if (update) {
    updateAvailable = update;
    refreshTrayMenu();
  }
}

// The published version lives in the ROOT package.json (the companion workspace
// has its own, unpublished version number).
function readPackageVersion() {
  try {
    const packagePath = join(__dirname, "..", "..", "..", "..", "package.json");
    return JSON.parse(readFileSync(packagePath, "utf8")).version;
  } catch {
    return undefined;
  }
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
    case "update":
      // Open the package page rather than running npm ourselves — installing
      // is the user's call (and may need their node manager / sudo setup).
      shell.openExternal(UPDATE_PAGE_URL);
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

// The overlay window is positioned once at creation; without these it would never
// react to the display layout changing under it. Re-home on any display add/remove/
// metrics change, and on resume from sleep (which commonly fires a metrics change
// and, on Windows, can blank a transparent surface — re-asserting bounds repaints).
function registerDisplayWatchers() {
  const onDisplayChange = () => rehomeOverlay({ persist: false });
  screen.on("display-metrics-changed", onDisplayChange);
  screen.on("display-added", onDisplayChange);
  screen.on("display-removed", onDisplayChange);
  try {
    powerMonitor.on("resume", onDisplayChange);
  } catch {
    // powerMonitor is unavailable on some platforms/headless; never fatal.
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
  if (petWindow.isVisible()) {
    petWindow.hide();
  } else {
    // Re-home on show: a stranded (off-screen) window still reports isVisible()
    // === true, so the user's first click hides it and this second click must put
    // it back on a valid display, not just show it at the same bad bounds.
    rehomeOverlay();
  }
  refreshTrayMenu();
}

function focusPet() {
  // Relaunching `haya-pet` (second-instance) is also a "bring it back" gesture, so
  // re-home rather than show at possibly-stale bounds.
  rehomeOverlay();
}

function resetPosition() {
  // Re-home onto a valid display FIRST (a stale display layout is exactly when
  // users reach for Reset), then drop the pet to the bottom-right corner.
  rehomeOverlay({ recenter: true });
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
