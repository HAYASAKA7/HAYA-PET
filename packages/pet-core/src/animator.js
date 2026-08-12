import { getFrameCount } from "./atlas.js";
import { DEFAULT_FRAME_DURATION_MS } from "./manifest.js";

export function getFrameAt(action, elapsedMs, manifest = {}) {
  const frameCount = getFrameCount(action);
  const duration = resolveDuration(action, manifest);
  const elapsed = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  return Math.floor(elapsed / duration) % frameCount;
}

export function getActionDurationMs(action, manifest = {}) {
  return getFrameCount(action) * resolveDuration(action, manifest);
}

export function getTimeToNextFrame(action, elapsedMs, manifest = {}) {
  const duration = resolveDuration(action, manifest);
  const elapsed = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  const position = elapsed % duration;
  return position === 0 ? duration : duration - position;
}

function resolveDuration(action, manifest) {
  const override = manifest.actionFrameDurations?.[action];
  if (Number.isFinite(override) && override > 0) {
    return override;
  }

  if (Number.isFinite(manifest.frameDurationMs) && manifest.frameDurationMs > 0) {
    return manifest.frameDurationMs;
  }

  return DEFAULT_FRAME_DURATION_MS;
}
