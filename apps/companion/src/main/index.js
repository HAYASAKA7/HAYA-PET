import { app, BrowserWindow, ipcMain, Menu, nativeImage, powerMonitor, screen, shell, Tray } from "electron";
import { fileURLToPath } from "node:url";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
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
import { createOverlayCrashPolicy } from "./overlay-crash-recovery.js";
import { getPetScale, setPetScale, setSelectedPet, updateGlobalPetPosition } from "./position-store.js";
import { buildTrayMenu, buildTrayTooltip } from "./tray-menu.js";
import { createStateFile } from "./state-file.js";
import { discoverPetsWithFallback } from "./pet-loader.js";
import { checkForUpdate, UPDATE_PAGE_URL } from "../../../../packages/app-state/src/update-check.js";
import { configureElectronStorage } from "./electron-storage.js";

const STALE_SWEEP_INTERVAL_MS = 10_000;
const __dirname = dirname(fileURLToPath(import.meta.url));

// render-process-gone / child-process-gone reasons that mean a genuine crash we
// should recover from. Clean exits and kills (e.g. during app shutdown) are
// excluded so quitting never spawns a replacement overlay.
const CRASH_REASONS = new Set(["crashed", "oom", "launch-failed", "integrity-failure"]);

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
configureElectronStorage(app, paths, {
  onError: (entry) => logOverlayCrash({ kind: "electron-storage-path-failed", ...entry })
});
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

// Auto-recovers the transparent overlay when its GPU/renderer process crashes
// (see overlay-crash-recovery.js). `quittingApp` suppresses recovery during
// shutdown so a teardown-time process exit is not mistaken for a crash.
const overlayCrashPolicy = createOverlayCrashPolicy();
let quittingApp = false;
let overlayRecovering = false;
let overlayShapeKey = "";

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
  registerCrashWatchers();
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
    quittingApp = true;
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
  overlayShapeKey = "";

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
  // Shape the native window immediately to the pet bounds; the renderer expands
  // this to include bubbles once it has measured the DOM. This avoids exposing a
  // desktop-sized transparent surface during startup.
  applyOverlayShape([{ x: petLocal.x, y: petLocal.y, ...scaledPetSize() }]);
  petWindow.loadFile(join(__dirname, "..", "renderer", "index.html"));
  petWindow.webContents.on("did-finish-load", () => {
    // A finished load means the (possibly recreated) overlay is painting again,
    // so clear the in-flight flag and the consecutive-crash count.
    overlayRecovering = false;
    overlayCrashPolicy.markRecovered();
    sendPetConfig();
    pushSessions();
  });

  // The renderer process dying (crash / OOM) leaves the transparent overlay blank
  // while the app keeps running — recreate it. Filtered to real crashes so a clean
  // exit or a kill during shutdown does not trigger a recovery.
  petWindow.webContents.on("render-process-gone", (_event, details) => {
    if (!CRASH_REASONS.has(details?.reason)) {
      return;
    }
    handleOverlayCrash("render-process-gone", { reason: details.reason, exitCode: details.exitCode });
  });
}

// Recover from an overlay GPU/renderer crash by recreating the window outright.
// Re-asserting bounds does not repaint a dead surface, so the window itself must
// be rebuilt; createPetWindow re-resolves placement and the follow-up re-home puts
// it on a currently-valid display and shows it. persist:false keeps the user's
// preferred-display memory intact (as with automatic display re-homes).
function recreatePetWindow(rehomeOptions = { persist: false }) {
  const previous = petWindow;
  petWindow = undefined;
  try {
    previous?.destroy();
  } catch {
    // destroying an already-dead window is fine
  }
  createPetWindow();
  rehomeOverlay({ persist: false, ...rehomeOptions });
}

// Decide-and-act on an overlay crash: log it (always), then recreate the window
// unless we are shutting down or the crash policy has hit its loop guard.
function handleOverlayCrash(kind, details = {}) {
  // Ignore crashes during shutdown, and while a recovery is already in flight — a
  // single GPU loss often fires BOTH the GPU child-process-gone and the renderer
  // render-process-gone, and we want ONE recreate, not a double rebuild that also
  // double-counts against the loop guard.
  if (quittingApp || overlayRecovering) {
    return;
  }
  const recover = overlayCrashPolicy.shouldRecover();
  logOverlayCrash({ kind, ...details, recover, consecutiveFailures: overlayCrashPolicy.consecutiveFailures });
  if (!recover) {
    return;
  }
  overlayRecovering = true;
  try {
    recreatePetWindow();
  } catch (error) {
    // A failed rebuild clears the in-flight flag so a later crash can retry.
    overlayRecovering = false;
    console.error("overlay recovery failed:", error.message);
  }
}

// Append one JSONL line per overlay crash (and whether we attempted recovery) to
// the logs dir. Unlike the opt-in debug logs this is always on: a crash is rare,
// unpredictable, and exactly what we need a record of after the fact. Never throws.
function logOverlayCrash(entry) {
  try {
    mkdirSync(paths.logDir, { recursive: true });
    appendFileSync(
      join(paths.logDir, "overlay-crash.log"),
      `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`
    );
  } catch {
    // logging a crash must never crash the daemon
  }
}

function applyOverlayShape(rects) {
  if (!petWindow || petWindow.isDestroyed() || typeof petWindow.setShape !== "function") {
    return;
  }
  if (capabilities.transparentOverlay !== "required") {
    return;
  }
  const safeRects = sanitizeOverlayShapeRects(rects);
  if (safeRects.length === 0) {
    return;
  }
  const key = JSON.stringify(safeRects);
  if (key === overlayShapeKey) {
    return;
  }
  try {
    petWindow.setShape(safeRects);
    overlayShapeKey = key;
  } catch (error) {
    logOverlayCrash({ kind: "overlay-shape-failed", message: error?.message });
  }
}

function sanitizeOverlayShapeRects(rects) {
  if (!Array.isArray(rects)) {
    return [];
  }
  const bounds = currentWorkArea ?? { width: 0, height: 0 };
  const maxWidth = Number.isFinite(bounds.width) ? bounds.width : 0;
  const maxHeight = Number.isFinite(bounds.height) ? bounds.height : 0;
  return rects.flatMap((rect) => {
    const x = Math.max(0, Math.floor(Number(rect?.x)));
    const y = Math.max(0, Math.floor(Number(rect?.y)));
    const right = Math.min(maxWidth, Math.ceil(Number(rect?.x) + Number(rect?.width)));
    const bottom = Math.min(maxHeight, Math.ceil(Number(rect?.y) + Number(rect?.height)));
    const width = right - x;
    const height = bottom - y;
    return width > 0 && height > 0 ? [{ x, y, width, height }] : [];
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

// Builds the native menu template from the pure tray model. Shared by the tray
// icon and the pet's right-click context menu so both stay identical.
function buildTrayMenuTemplate() {
  const sessions = (runtime?.listSessions() ?? []).map((session) => ({
    sessionId: session.sessionId,
    label: `${session.clientDisplayName} · ${session.projectName}`
  }));

  return buildTrayMenu({
    petVisible: petWindow?.isVisible() ?? true,
    displayMode: positionState.settings.displayMode,
    attachBubblesToTerminals: positionState.settings.attachBubblesToTerminals,
    selectedPetId: positionState.globalPet.selectedPetId,
    sessions,
    pets: pets.map((pet) => ({ id: pet.manifest.id, name: pet.manifest.name })),
    updateAvailable
  }).map(toElectronMenuItem);
}

function refreshTrayMenu() {
  if (!tray) {
    return;
  }

  tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate()));
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

// The GPU process dying (a driver TDR reset or VRAM exhaustion under heavy load,
// e.g. local image generation) is app-wide rather than tied to one webContents,
// and likewise blanks the transparent overlay. Recreate the overlay when it goes,
// filtered to real crashes so a shutdown-time kill is ignored.
function registerCrashWatchers() {
  app.on("child-process-gone", (_event, details) => {
    if (details?.type !== "GPU" || !CRASH_REASONS.has(details?.reason)) {
      return;
    }
    handleOverlayCrash("gpu-process-gone", { reason: details.reason, exitCode: details.exitCode });
  });

  // On Windows/Linux, Electron's DEFAULT when the last window closes is to quit the
  // whole app. For this persistent overlay+daemon that means a single stray window
  // close silently tears down the pet — the process exits cleanly, so there is no
  // crash, no WER fault, and no log, exactly matching the "running but I can't see
  // it" reports. Subscribing here overrides that default: unless we are genuinely
  // quitting, rebuild the overlay instead of exiting. handleOverlayCrash logs it,
  // honors the quit + in-flight guards, and applies the same loop cap.
  app.on("window-all-closed", () => {
    handleOverlayCrash("window-all-closed");
  });

  // A stray error in the MAIN process otherwise exits it silently (Electron writes
  // to a detached stderr no one sees). Log it with a stack so the next occurrence
  // finally has a cause on disk, and keep the tray/daemon alive — a logged bad
  // state beats a vanished pet. (Child renderer/GPU crashes are handled above.)
  process.on("uncaughtException", (error) => {
    logOverlayCrash({ kind: "uncaught-exception", message: error?.message, stack: error?.stack });
  });
  process.on("unhandledRejection", (reason) => {
    logOverlayCrash({
      kind: "unhandled-rejection",
      message: reason?.message ?? String(reason),
      stack: reason?.stack
    });
  });
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

  ipcMain.on("haya-pet:set-window-shape", (_event, rects) => {
    applyOverlayShape(rects);
  });

  // Right-click on the pet pops up the same menu as the tray icon (built from
  // the one pure tray model), since the tray icon is often buried in the Windows
  // overflow. Fire-and-forget: the native menu is shown and dispatched in main.
  ipcMain.on("haya-pet:show-pet-menu", () => {
    if (!petWindow || petWindow.isDestroyed()) {
      return;
    }
    Menu.buildFromTemplate(buildTrayMenuTemplate()).popup({ window: petWindow });
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
  if (!petWindow || petWindow.isDestroyed()) {
    // The window was torn down (e.g. a stray close the quit-guard kept from
    // killing the app); rebuild it rather than no-op on a dead reference.
    recreatePetWindow({ persist: true });
    refreshTrayMenu();
    return;
  }
  if (petWindow.isVisible()) {
    petWindow.hide();
  } else {
    // Recreate on show: a stranded or compositor-lost window can still report
    // isVisible() === true, so the user's first click hides it and this
    // second click must put a fresh overlay back on a valid display.
    recreatePetWindow({ persist: true });
  }
  refreshTrayMenu();
}

function focusPet() {
  // Relaunching `haya-pet` (second-instance) is a restore gesture. Rebuild the
  // BrowserWindow as well as re-homing it, because a compositor-lost transparent
  // surface can stay alive while no longer painting.
  recreatePetWindow({ persist: true });
}

function resetPosition() {
  // Reset is also a last-resort visual recovery control. Recreate first so it
  // can recover an alive-but-unpaintable transparent surface, then recenter.
  recreatePetWindow({ recenter: true, persist: true });
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
