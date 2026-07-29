// Layer 1 renderer: the global pet overlay. The animation, interaction, and
// state-mapping logic all come from the unit-tested pure packages; this module
// is the browser glue that draws frames and forwards pointer gestures.

import { CELL_HEIGHT, CELL_WIDTH, getFrameRect } from "../../../../packages/pet-core/src/atlas.js";
import { clampScale, DEFAULT_SCALE, resolveScaleFromDrag } from "../../../../packages/pet-core/src/pet-scale.js";
import { getActionDurationMs, getFrameAt } from "../../../../packages/pet-core/src/animator.js";
import {
  clearDragAction,
  createAnimationState,
  resolveCurrentAction,
  setDragAction,
  setStableAction,
  triggerOneShot
} from "../../../../packages/pet-core/src/animation-state.js";
import { resolveCompanionPetState } from "../../../../packages/session-core/src/pet-state.js";
import { resolveVisibleBubbles } from "../../../../packages/session-core/src/bubble-linger.js";
import { resolvePanelPlacement } from "../main/panel-placement.js";
import { resolveBubbleListMaxHeight } from "../main/bubble-list-viewport.js";
import { createInteractionController } from "./interaction-controller.js";
import { createBubbleList } from "./session-bubbles.js";
import { createOverlayHoverClearer } from "./overlay-hover.js";
import { isOpaqueAlpha, isPointInsideRect } from "./pet-hit-test.js";
import { buildOverlayShapeRects, resolveElementLayoutRect, sameOverlayShape } from "./overlay-shape.js";

const bridge = window.aiPet;
const petEl = document.getElementById("pet");
const canvas = document.getElementById("pet-canvas");
const gripEl = document.getElementById("pet-resize-grip");
// willReadFrequently: the click-through hit-test samples a single pixel on every
// pointer move (see pointerHitsPetPixel), so keep the canvas CPU-backed.
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const panelEl = document.getElementById("bubbles");

// The sprite's natural cell size; the canvas is this times the user's scale.
const BASE_SIZE = Object.freeze({ width: CELL_WIDTH, height: CELL_HEIGHT });

const controller = createInteractionController({
  // Click is deferred so a double-click never also fires a wave. Clicking the
  // pet folds/unfolds the session bubbles; double-click forces them open.
  onAction: (event) => {
    if (event.type === "click") {
      playOneShot("waving");
      bubbleList.toggle();
    } else if (event.type === "double-click") {
      playOneShot("jumping");
      bubbleList.expand();
    }
  }
});
// Reposition the panel beside the pet after every (re)render, since its size
// changes with the number of bubbles and the collapsed/expanded state.
const bubbleList = createBubbleList(panelEl, { onRender: placePanel });

let animationState = createAnimationState("idle");
let manifest = { frameDurationMs: 120 };
let spritesheet;
let currentAction = "idle";
let actionStart = 0;
let dragOffset = { x: 0, y: 0 };
let previousSessionStates = {};
// The pet lives at this work-area-relative position inside the full-screen
// overlay window; dragging moves it via CSS (the window never moves).
let petLocal = { x: 0, y: 0 };
// User-chosen pet scale (resize grip), persisted like the position.
let petScale = DEFAULT_SCALE;
// Linger bookkeeping so a finished session's bubble stays ~2s before vanishing.
let lingerState = {};
let lingerTimer;
let lastBubblesPayload = [];
let shapeFrame;
let lastShapeRects = [];

function setupPet(config) {
  if (config?.pet?.manifest) {
    manifest = config.pet.manifest;
  }

  if (config?.petScale !== undefined) {
    applyPetScale(config.petScale);
  }

  if (config?.petPosition) {
    applyPetPosition(config.petPosition);
  }

  if (config?.pet?.spritesheetUrl) {
    const image = new Image();
    image.onload = () => {
      spritesheet = image;
    };
    image.src = config.pet.spritesheetUrl;
  }
}

function applyPetPosition(pos) {
  petLocal = clampPetLocal(pos);
  petEl.style.left = `${petLocal.x}px`;
  petEl.style.top = `${petLocal.y}px`;
  placePanel();
}

// Resizes the canvas's pixel size, so each frame re-renders at the new scale
// (no CSS stretching). Everything that reads canvas.width/height — drag
// clamping, panel placement — adapts automatically.
function applyPetScale(scale) {
  petScale = clampScale(scale);
  canvas.width = Math.round(BASE_SIZE.width * petScale);
  canvas.height = Math.round(BASE_SIZE.height * petScale);
  applyPetPosition(petLocal);
}

function clampPetLocal(pos) {
  const maxX = Math.max(0, window.innerWidth - canvas.width);
  const maxY = Math.max(0, window.innerHeight - canvas.height);
  return {
    x: Math.min(Math.max(Math.round(pos?.x ?? 0), 0), maxX),
    y: Math.min(Math.max(Math.round(pos?.y ?? 0), 0), maxY)
  };
}

// Anchors the folder button on whichever side of the pet has room, fully inside
// the overlay (== the work area), so dragging never pushes it off-screen. The
// button's box drives the placement; the (absolutely positioned) list then
// opens toward the screen centre, so toggling it never moves the button.
function placePanel() {
  const rect = panelEl.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    scheduleOverlayShape();
    return; // nothing to place (no active sessions)
  }

  const workArea = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
  const placement = resolvePanelPlacement({
    pet: { x: petLocal.x, y: petLocal.y, width: canvas.width, height: canvas.height },
    panel: { width: rect.width, height: rect.height },
    workArea
  });
  panelEl.style.left = `${Math.round(placement.x)}px`;
  panelEl.style.top = `${Math.round(placement.y)}px`;

  const list = panelEl.querySelector(".bubble-list");
  if (list) {
    const margin = 12;
    const openUp = placement.y > workArea.height / 2;
    const alignRight = placement.x + rect.width / 2 > workArea.width / 2;
    list.dataset.openDirection = openUp ? "up" : "down";
    list.dataset.openAlign = alignRight ? "right" : "left";
    // Cap the height to the room actually available on the chosen side AND to
    // three visible bubbles — more sessions are reached by scrolling the list.
    const room = openUp ? placement.y - margin : workArea.height - (placement.y + rect.height) - margin;
    const bubbleBottoms = Array.from(list.children, (child) => child.offsetTop + child.offsetHeight);
    list.style.maxHeight = `${resolveBubbleListMaxHeight({ room, bubbleBottoms })}px`;
  }

  scheduleOverlayShape();
}

function frameLoop(now) {
  const action = resolveCurrentAction(animationState, now);
  if (action !== currentAction) {
    currentAction = action;
    actionStart = now;
  }

  const frameIndex = getFrameAt(action, now - actionStart, manifest);
  draw(action, frameIndex);
  requestAnimationFrame(frameLoop);
}

function draw(action, frameIndex) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (spritesheet) {
    const rect = getFrameRect(action, frameIndex);
    ctx.drawImage(spritesheet, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
  } else {
    drawPlaceholder(action, frameIndex);
  }
}

// Development fallback so the pet still renders without a Codex spritesheet.
function drawPlaceholder(action, frameIndex) {
  ctx.fillStyle = "rgba(110, 168, 254, 0.85)";
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(16, 16, canvas.width - 32, canvas.height - 32, 16) : ctx.rect(16, 16, canvas.width - 32, canvas.height - 32);
  ctx.fill();
  ctx.fillStyle = "#001233";
  ctx.font = "14px system-ui";
  ctx.textAlign = "center";
  ctx.fillText(action, canvas.width / 2, canvas.height / 2);
  ctx.fillText(`frame ${frameIndex}`, canvas.width / 2, canvas.height / 2 + 20);
}

function playOneShot(action) {
  animationState = triggerOneShot(animationState, action, performance.now(), getActionDurationMs(action, manifest));
}

// --- Pointer interaction (click vs drag distinction lives in the controller) ---

canvas.addEventListener("pointerdown", (event) => {
  // Only the primary button drives click/drag; right-click pops the context menu
  // (handled below) and must not also fire a wave/toggle or start a drag.
  if (event.button !== 0) {
    return;
  }
  canvas.setPointerCapture(event.pointerId);
  // Hold click-through off for the whole press: a drag swaps to the running
  // frames, whose opaque pixels differ from the grabbed one, so re-running the
  // pixel test mid-gesture could flip the window to pass-through and drop it.
  petPressed = true;
  dragOffset = { x: event.offsetX, y: event.offsetY };
  // Window-local (clientX/Y) coords throughout — the overlay covers the work area.
  controller.pointerDown({ x: event.clientX, y: event.clientY, time: performance.now() });
});

canvas.addEventListener("pointermove", (event) => {
  const result = controller.pointerMove({ x: event.clientX, y: event.clientY, time: performance.now() });
  if (result?.type === "drag") {
    animationState = setDragAction(animationState, result.direction);
    applyPetPosition({ x: event.clientX - dragOffset.x, y: event.clientY - dragOffset.y });
  }
});

canvas.addEventListener("pointerup", (event) => {
  // Mirror pointerdown: ignore non-primary releases so a right-click never feeds
  // the click controller (its pointerDown was skipped anyway).
  if (event.button !== 0) {
    return;
  }
  // Click / double-click are delivered asynchronously via onAction; only the
  // synchronous drag-end is handled here.
  petPressed = false;
  const result = controller.pointerUp({ x: event.clientX, y: event.clientY, time: performance.now() });
  if (result?.type === "drag-end") {
    animationState = clearDragAction(animationState);
    bridge?.savePetPosition?.(petLocal);
  }
  refreshMouseIgnore(event.clientX, event.clientY);
});

canvas.addEventListener("pointercancel", () => {
  petPressed = false;
  animationState = clearDragAction(animationState);
});

// Right-click the pet to open the same menu as the tray icon. The native menu is
// built and shown in the main process; preventDefault stops Electron's default
// context menu. Only fires over opaque pet pixels (transparent areas are
// click-through and the right-click falls to the desktop, like a left-click).
canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  bridge?.showPetMenu?.();
});

// --- Resize grip: drag to scale the pet, double-click to reset ---

let resizeDrag; // { startScale, startPointer } while a grip drag is active

gripEl.addEventListener("pointerdown", (event) => {
  gripEl.setPointerCapture(event.pointerId);
  gripEl.classList.add("active");
  resizeDrag = {
    startScale: petScale,
    startPointer: { x: event.clientX, y: event.clientY }
  };
});

gripEl.addEventListener("pointermove", (event) => {
  if (!resizeDrag) {
    return;
  }
  applyPetScale(resolveScaleFromDrag({
    startScale: resizeDrag.startScale,
    startPointer: resizeDrag.startPointer,
    pointer: { x: event.clientX, y: event.clientY },
    baseSize: BASE_SIZE
  }));
});

gripEl.addEventListener("pointerup", () => {
  if (!resizeDrag) {
    return;
  }
  resizeDrag = undefined;
  gripEl.classList.remove("active");
  bridge?.savePetScale?.(petScale);
});

gripEl.addEventListener("pointercancel", () => {
  resizeDrag = undefined;
  gripEl.classList.remove("active");
});

gripEl.addEventListener("dblclick", () => {
  applyPetScale(DEFAULT_SCALE);
  bridge?.savePetScale?.(DEFAULT_SCALE);
});

// Re-clamp and re-place when the work area changes (display/resolution change).
window.addEventListener("resize", () => {
  applyPetPosition(petLocal);
  scheduleOverlayShape();
});

panelEl.addEventListener("transitionend", (event) => {
  if (event.target?.classList?.contains("bubble-list")) {
    scheduleOverlayShape();
  }
});

// --- Session wiring ---

function applySessions(payload) {
  const allBubbles = payload?.bubbles ?? [];
  const { stableAction, oneShots, nextStates } = resolveCompanionPetState({
    bubbles: allBubbles,
    prioritySessionId: payload?.prioritySessionId,
    previousStates: previousSessionStates
  });
  previousSessionStates = nextStates;

  // The pet's body language is driven only by active work (handled inside the
  // resolver); the panel shows every live session via renderBubbles().
  lastBubblesPayload = allBubbles;
  renderBubbles();

  for (const action of oneShots) {
    playOneShot(action);
  }

  animationState = setStableAction(animationState, stableAction);
  refreshMouseIgnore(lastPointer.x, lastPointer.y);
}

// Applies the 2s linger: finished sessions keep their final status icon briefly,
// then drop off. Re-runs itself when the linger window elapses so a bubble
// disappears on schedule even if no new session event arrives.
function renderBubbles() {
  const { visible, lingerState: nextLinger, nextWakeMs } = resolveVisibleBubbles({
    bubbles: lastBubblesPayload,
    now: Date.now(),
    lingerState
  });
  lingerState = nextLinger;
  bubbleList.render(visible);

  clearTimeout(lingerTimer);
  if (nextWakeMs !== undefined) {
    lingerTimer = setTimeout(renderBubbles, nextWakeMs);
  }
  refreshMouseIgnore(lastPointer.x, lastPointer.y);
}

// --- Native overlay shape ---
//
// The BrowserWindow spans the work area for simple placement math, but the OS
// should only see the pet and bubble panel as drawable/hit-test regions. Without
// this, setIgnoreMouseEvents(false) during a drag makes the whole desktop-sized
// transparent window a topmost Chromium surface, which can interfere with other
// Chromium/Electron video and terminal renderers.

function scheduleOverlayShape() {
  if (shapeFrame !== undefined) {
    return;
  }
  shapeFrame = requestAnimationFrame(() => {
    shapeFrame = undefined;
    refreshOverlayShape();
  });
}

function refreshOverlayShape() {
  const rects = buildOverlayShapeRects({
    viewport: { width: window.innerWidth, height: window.innerHeight },
    rects: collectOverlayShapeRects()
  });
  if (sameOverlayShape(rects, lastShapeRects)) {
    return;
  }
  lastShapeRects = rects;
  bridge?.setWindowShape?.(rects);
}

function collectOverlayShapeRects() {
  const rects = [canvas.getBoundingClientRect()];
  const folder = panelEl.querySelector(".folder-toggle");
  const list = panelEl.querySelector(".bubble-list");
  if (isElementVisibleForShape(folder)) {
    rects.push(folder.getBoundingClientRect());
  }
  if (isElementVisibleForShape(list)) {
    rects.push(resolveElementLayoutRect(list));
  }
  return rects;
}

function isElementVisibleForShape(el) {
  if (!el) {
    return false;
  }
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") {
    return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

// --- Click-through forwarding ---
//
// The overlay window covers a large area but should only intercept the mouse
// over the pet and the bubble chips; everywhere else must pass through to the
// desktop. The window is created ignoring mouse events (with forwarding), and
// we flip it back on whenever the cursor is over an `.interactive` element. Over
// the pet canvas we go further and only intercept where the sprite has opaque
// pixels, so the transparent margins of the cell pass clicks through too.

let mouseIgnored;
let petPressed = false; // a press/drag is in progress on the pet canvas
let lastPointer = { x: -1, y: -1 };

const clearOverlayHover = createOverlayHoverClearer({
  petEl,
  isInteractionCaptured: () => Boolean(resizeDrag || petPressed),
  onPointerCleared: () => {
    lastPointer = { x: -1, y: -1 };
  },
  setMouseIgnore
});

function setMouseIgnore(ignore) {
  const next = Boolean(ignore);
  if (next !== mouseIgnored) {
    mouseIgnored = next;
    bridge?.setMouseIgnore?.(next);
  }
}

// True when the cursor is over a non-transparent pixel of the current frame. The
// canvas already holds the current frame at the current scale, so sampling it
// directly needs no atlas math. (Electron lets us read a file://-drawn canvas;
// if a future version ever taints it, getImageData throws and we fall back to
// treating the whole canvas box as interactive.)
function pointerHitsPetPixel(x, y) {
  if (!spritesheet) {
    return true; // dev placeholder has no sprite: keep the whole box interactive
  }
  const rect = canvas.getBoundingClientRect();
  if (!isPointInsideRect({ x, y }, rect)) {
    return false;
  }
  const lx = Math.floor(x - rect.left);
  const ly = Math.floor(y - rect.top);
  try {
    return isOpaqueAlpha(ctx.getImageData(lx, ly, 1, 1).data[3]);
  } catch {
    return true; // tainted canvas: degrade to full-box interactivity
  }
}

function refreshMouseIgnore(x, y) {
  // While the grip is captured, the pointer can briefly leave it (the pet only
  // approximately tracks the diagonal); flipping click-through mid-drag would
  // drop the pointerup, so hold interaction until the drag ends. The same holds
  // for a press/drag on the pet body (petPressed).
  if (resizeDrag || petPressed) {
    return;
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return;
  }
  const interactiveEl = document.elementFromPoint(x, y)?.closest(".interactive");
  let interactive = Boolean(interactiveEl);
  // Pixel precision applies only to the pet body; the grip and bubbles (their
  // own .interactive elements) keep their full hit area.
  if (interactiveEl === canvas) {
    interactive = pointerHitsPetPixel(x, y);
  }
  setMouseIgnore(!interactive);
}

// The resize grip reveals whenever the cursor is over the pet's bounding box —
// the same judgement as before — kept independent of the pixel-precise
// click-through so passing clicks through transparent areas never hides it. The
// window forwards move events even while click-through is on, so this stays
// accurate over transparent (passed-through) areas too.
function refreshGripVisibility(x, y) {
  const inside = Number.isFinite(x) && Number.isFinite(y) && isPointInsideRect({ x, y }, canvas.getBoundingClientRect());
  petEl.classList.toggle("show-grip", inside || Boolean(resizeDrag));
}

window.addEventListener("mousemove", (event) => {
  lastPointer = { x: event.clientX, y: event.clientY };
  refreshMouseIgnore(event.clientX, event.clientY);
  refreshGripVisibility(event.clientX, event.clientY);
});

window.addEventListener("mouseleave", clearOverlayHover);
window.addEventListener("mouseout", (event) => {
  if (!event.relatedTarget) {
    clearOverlayHover();
  }
});
window.addEventListener("blur", clearOverlayHover);

if (bridge) {
  bridge.setMouseIgnore?.(true);
  bridge.onConfig(setupPet);
  bridge.onSessions(applySessions);
  bridge.onPetPosition?.(applyPetPosition);
  bridge.listSessions().then(applySessions).catch(() => {});
  scheduleOverlayShape();
}

requestAnimationFrame(frameLoop);
