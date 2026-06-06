// Layer 1 renderer: the global pet overlay. The animation, interaction, and
// state-mapping logic all come from the unit-tested pure packages; this module
// is the browser glue that draws frames and forwards pointer gestures.

import { CELL_HEIGHT, CELL_WIDTH, getFrameRect } from "../../../../packages/pet-core/src/atlas.js";
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
import { createInteractionController } from "./interaction-controller.js";
import { createBubbleList } from "./session-bubbles.js";

const bridge = window.aiPet;
const canvas = document.getElementById("pet-canvas");
const ctx = canvas.getContext("2d");
const panelEl = document.getElementById("bubbles");

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
// Linger bookkeeping so a finished session's bubble stays ~2s before vanishing.
let lingerState = {};
let lingerTimer;
let lastBubblesPayload = [];

function setupPet(config) {
  if (config?.pet?.manifest) {
    manifest = config.pet.manifest;
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
  canvas.style.left = `${petLocal.x}px`;
  canvas.style.top = `${petLocal.y}px`;
  placePanel();
}

function clampPetLocal(pos) {
  const maxX = Math.max(0, window.innerWidth - canvas.width);
  const maxY = Math.max(0, window.innerHeight - canvas.height);
  return {
    x: Math.min(Math.max(Math.round(pos?.x ?? 0), 0), maxX),
    y: Math.min(Math.max(Math.round(pos?.y ?? 0), 0), maxY)
  };
}

// Places the bubble panel on whichever side of the pet has room, fully inside
// the overlay (== the work area), so dragging never pushes it off-screen.
function placePanel() {
  const rect = panelEl.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return; // nothing to place (no active sessions)
  }
  const placement = resolvePanelPlacement({
    pet: { x: petLocal.x, y: petLocal.y, width: canvas.width, height: canvas.height },
    panel: { width: rect.width, height: rect.height },
    workArea: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }
  });
  panelEl.style.left = `${Math.round(placement.x)}px`;
  panelEl.style.top = `${Math.round(placement.y)}px`;
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
  ctx.roundRect ? ctx.roundRect(16, 16, CELL_WIDTH - 32, CELL_HEIGHT - 32, 16) : ctx.rect(16, 16, CELL_WIDTH - 32, CELL_HEIGHT - 32);
  ctx.fill();
  ctx.fillStyle = "#001233";
  ctx.font = "14px system-ui";
  ctx.textAlign = "center";
  ctx.fillText(action, CELL_WIDTH / 2, CELL_HEIGHT / 2);
  ctx.fillText(`frame ${frameIndex}`, CELL_WIDTH / 2, CELL_HEIGHT / 2 + 20);
}

function playOneShot(action) {
  animationState = triggerOneShot(animationState, action, performance.now(), getActionDurationMs(action, manifest));
}

// --- Pointer interaction (click vs drag distinction lives in the controller) ---

canvas.addEventListener("pointerdown", (event) => {
  canvas.setPointerCapture(event.pointerId);
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
  // Click / double-click are delivered asynchronously via onAction; only the
  // synchronous drag-end is handled here.
  const result = controller.pointerUp({ x: event.clientX, y: event.clientY, time: performance.now() });
  if (result?.type === "drag-end") {
    animationState = clearDragAction(animationState);
    bridge?.savePetPosition?.(petLocal);
  }
});

// Re-clamp and re-place when the work area changes (display/resolution change).
window.addEventListener("resize", () => {
  applyPetPosition(petLocal);
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

// --- Click-through forwarding ---
//
// The overlay window covers a large area but should only intercept the mouse
// over the pet and the bubble chips; everywhere else must pass through to the
// desktop. The window is created ignoring mouse events (with forwarding), and
// we flip it back on whenever the cursor is over an `.interactive` element.

let mouseIgnored;
let lastPointer = { x: -1, y: -1 };

function refreshMouseIgnore(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return;
  }
  const target = document.elementFromPoint(x, y);
  const interactive = Boolean(target && target.closest(".interactive"));
  const ignore = !interactive;
  if (ignore !== mouseIgnored) {
    mouseIgnored = ignore;
    bridge?.setMouseIgnore?.(ignore);
  }
}

window.addEventListener("mousemove", (event) => {
  lastPointer = { x: event.clientX, y: event.clientY };
  refreshMouseIgnore(event.clientX, event.clientY);
});

if (bridge) {
  bridge.setMouseIgnore?.(true);
  bridge.onConfig(setupPet);
  bridge.onSessions(applySessions);
  bridge.onPetPosition?.(applyPetPosition);
  bridge.listSessions().then(applySessions).catch(() => {});
}

requestAnimationFrame(frameLoop);
