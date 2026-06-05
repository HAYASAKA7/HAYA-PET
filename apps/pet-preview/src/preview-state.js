import {
  ACTION_ROWS,
  FRAME_COUNTS,
  getFrameCount,
  getFrameRect
} from "../../../packages/pet-core/src/atlas.js";

export function buildPreviewRows() {
  return Object.entries(ACTION_ROWS).map(([action, row]) => ({
    action,
    row,
    frameCount: FRAME_COUNTS[action]
  }));
}

export function createPreviewState(options = {}) {
  const action = options.action ?? "idle";
  const frameIndex = options.frameIndex ?? 0;
  const scale = options.scale ?? 2;
  const playing = options.playing ?? true;

  return withFrameRect({
    action,
    frameIndex,
    scale,
    playing
  });
}

export function selectPreviewAction(state, action) {
  return withFrameRect({
    ...state,
    action,
    frameIndex: 0,
    playing: true
  });
}

export function setPreviewScale(state, scale) {
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new RangeError("scale must be greater than 0");
  }

  return withFrameRect({
    ...state,
    scale
  });
}

export function setPreviewPlaying(state, playing) {
  return withFrameRect({
    ...state,
    playing: Boolean(playing)
  });
}

export function advancePreviewFrame(state) {
  const frameCount = getFrameCount(state.action);
  return withFrameRect({
    ...state,
    frameIndex: (state.frameIndex + 1) % frameCount
  });
}

function withFrameRect(state) {
  return {
    ...state,
    frameRect: getFrameRect(state.action, state.frameIndex)
  };
}
