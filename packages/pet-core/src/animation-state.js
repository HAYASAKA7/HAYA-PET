import { isPetAction } from "./atlas.js";

const DRAG_ACTIONS = Object.freeze({
  left: "running-left",
  right: "running-right"
});

function assertPetAction(action) {
  if (!isPetAction(action)) {
    throw new Error(`Unknown pet action: ${action}`);
  }
}

export function createAnimationState(stableAction = "idle") {
  assertPetAction(stableAction);

  return {
    stableAction,
    currentAction: stableAction
  };
}

export function setStableAction(state, stableAction) {
  assertPetAction(stableAction);

  return {
    ...state,
    stableAction,
    currentAction: state.dragAction ?? state.oneShotAction ?? stableAction
  };
}

export function triggerOneShot(state, oneShotAction, now, durationMs) {
  assertPetAction(oneShotAction);

  if (!Number.isFinite(now)) {
    throw new TypeError("now must be a finite timestamp");
  }

  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new RangeError("durationMs must be greater than 0");
  }

  return {
    ...state,
    currentAction: oneShotAction,
    oneShotAction,
    oneShotStartedAt: now,
    oneShotEndsAt: now + durationMs,
    previousStableAction: state.stableAction
  };
}

export function setDragAction(state, direction) {
  const dragAction = DRAG_ACTIONS[direction];
  if (!dragAction) {
    throw new Error(`Unknown drag direction: ${direction}`);
  }

  return {
    ...state,
    currentAction: dragAction,
    dragAction
  };
}

export function clearDragAction(state) {
  const next = { ...state };
  delete next.dragAction;
  next.currentAction = next.oneShotAction ?? next.stableAction;
  return next;
}

export function resolveCurrentAction(state, now) {
  if (state.dragAction) {
    return state.dragAction;
  }

  if (state.oneShotAction && Number.isFinite(state.oneShotEndsAt) && now < state.oneShotEndsAt) {
    return state.oneShotAction;
  }

  return state.stableAction;
}
