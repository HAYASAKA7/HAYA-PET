export const CELL_WIDTH = 192;
export const CELL_HEIGHT = 208;
export const ATLAS_COLUMNS = 8;
export const ATLAS_ROWS = 9;
export const ATLAS_WIDTH = CELL_WIDTH * ATLAS_COLUMNS;
export const ATLAS_HEIGHT = CELL_HEIGHT * ATLAS_ROWS;

export const ACTION_ROWS = Object.freeze({
  idle: 0,
  "running-right": 1,
  "running-left": 2,
  waving: 3,
  jumping: 4,
  failed: 5,
  waiting: 6,
  running: 7,
  review: 8
});

export const FRAME_COUNTS = Object.freeze({
  idle: 6,
  "running-right": 8,
  "running-left": 8,
  waving: 4,
  jumping: 5,
  failed: 8,
  waiting: 6,
  running: 6,
  review: 6
});

const AI_STATE_TO_PET_ACTION = Object.freeze({
  idle: "idle",
  thinking: "review",
  running_tool: "running",
  editing_files: "running",
  waiting_user: "waiting",
  waiting_approval: "waiting",
  reviewing: "review",
  compacting: "review",
  failed: "failed",
  interrupted: "failed",
  success: "jumping",
  stale: "waiting",
  exited: "jumping"
});

export function isPetAction(action) {
  return Object.prototype.hasOwnProperty.call(ACTION_ROWS, action);
}

export function getFrameCount(action) {
  if (!isPetAction(action)) {
    throw new Error(`Unknown pet action: ${action}`);
  }

  return FRAME_COUNTS[action];
}

export function getFrameRect(action, frameIndex) {
  const frameCount = getFrameCount(action);

  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= frameCount) {
    throw new RangeError(`Frame index ${frameIndex} is out of range for ${action}; expected 0-${frameCount - 1}`);
  }

  return {
    x: frameIndex * CELL_WIDTH,
    y: ACTION_ROWS[action] * CELL_HEIGHT,
    width: CELL_WIDTH,
    height: CELL_HEIGHT
  };
}

export function mapAiStateToPetAction(aiState) {
  const action = AI_STATE_TO_PET_ACTION[aiState];
  if (!action) {
    throw new Error(`Unknown AI client state: ${aiState}`);
  }

  return action;
}
