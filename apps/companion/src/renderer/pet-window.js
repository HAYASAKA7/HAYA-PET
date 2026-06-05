// Layer 1 renderer: the global pet overlay. The animation, interaction, and
// state-mapping logic all come from the unit-tested pure packages; this module
// is the browser glue that draws frames and forwards pointer gestures.

import { CELL_HEIGHT, CELL_WIDTH, getFrameRect, mapAiStateToPetAction } from "../../../../packages/pet-core/src/atlas.js";
import { getActionDurationMs, getFrameAt } from "../../../../packages/pet-core/src/animator.js";
import {
  clearDragAction,
  createAnimationState,
  resolveCurrentAction,
  setDragAction,
  setStableAction,
  triggerOneShot
} from "../../../../packages/pet-core/src/animation-state.js";
import { createInteractionController } from "./interaction-controller.js";
import { createBubbleList } from "./session-bubbles.js";
import { createTalkWindow } from "./task-talk-window.js";

const bridge = window.aiPet;
const canvas = document.getElementById("pet-canvas");
const ctx = canvas.getContext("2d");

const controller = createInteractionController();
const bubbleList = createBubbleList(document.getElementById("bubbles"), { onSelect: selectSession });
const talkWindow = createTalkWindow(document.getElementById("talk-window"), bridge);

let animationState = createAnimationState("idle");
let manifest = { frameDurationMs: 120 };
let spritesheet;
let currentAction = "idle";
let actionStart = 0;
let dragOffset = { x: 0, y: 0 };
let latestBubbles = [];
let selectedSessionId;

function setupPet(config) {
  if (config?.pet?.manifest) {
    manifest = config.pet.manifest;
  }

  if (config?.pet?.spritesheetUrl) {
    const image = new Image();
    image.onload = () => {
      spritesheet = image;
    };
    image.src = config.pet.spritesheetUrl;
  }
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
  controller.pointerDown({ x: event.screenX, y: event.screenY, time: performance.now() });
});

canvas.addEventListener("pointermove", (event) => {
  const result = controller.pointerMove({ x: event.screenX, y: event.screenY, time: performance.now() });
  if (result?.type === "drag") {
    animationState = setDragAction(animationState, result.direction);
    bridge?.moveWindow?.({ x: event.screenX - dragOffset.x, y: event.screenY - dragOffset.y });
  }
});

canvas.addEventListener("pointerup", (event) => {
  const result = controller.pointerUp({ x: event.screenX, y: event.screenY, time: performance.now() });
  if (!result) {
    return;
  }

  if (result.type === "drag-end") {
    animationState = clearDragAction(animationState);
    bridge?.savePosition?.();
  } else if (result.type === "click") {
    playOneShot("waving");
    openSelectedTalkWindow("peek");
  } else if (result.type === "double-click") {
    playOneShot("jumping");
    openSelectedTalkWindow("expanded");
  }
});

// --- Session wiring ---

function applySessions(payload) {
  latestBubbles = payload?.bubbles ?? [];
  bubbleList.render(latestBubbles);

  const priority = latestBubbles.find((bubble) => bubble.sessionId === payload?.prioritySessionId) ?? latestBubbles[0];
  if (priority) {
    animationState = setStableAction(animationState, safeAction(priority.state));
  } else {
    animationState = setStableAction(animationState, "idle");
  }
}

function selectSession(bubble) {
  selectedSessionId = bubble.sessionId;
  talkWindow.open(bubble, "peek");
}

function openSelectedTalkWindow(mode) {
  const bubble = latestBubbles.find((b) => b.sessionId === selectedSessionId) ?? latestBubbles[0];
  if (bubble) {
    selectedSessionId = bubble.sessionId;
    talkWindow.open(bubble, mode);
  }
}

function safeAction(state) {
  try {
    return mapAiStateToPetAction(state);
  } catch {
    return "idle";
  }
}

if (bridge) {
  bridge.onConfig(setupPet);
  bridge.onSessions(applySessions);
  bridge.listSessions().then(applySessions).catch(() => {});
}

requestAnimationFrame(frameLoop);
