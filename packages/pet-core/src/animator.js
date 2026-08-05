import { getFrameCount } from "./atlas.js";
import { DEFAULT_FRAME_DURATION_MS } from "./manifest.js";

export function getFrameAt(action, elapsedMs, manifest = {}) {
  const frameCount = getFrameCount(action);
  const duration = resolveDuration(action, manifest);
  const elapsed = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  const actionDuration = frameCount * duration;
  const pause = resolveLoopPause(action, manifest);
  const cycleDuration = actionDuration + pause;
  const cycleElapsed = pause > 0 ? elapsed % cycleDuration : elapsed;

  if (pause > 0 && cycleElapsed >= actionDuration) {
    return frameCount - 1;
  }

  return Math.floor(cycleElapsed / duration) % frameCount;
}

export function getActionDurationMs(action, manifest = {}) {
  return getFrameCount(action) * resolveDuration(action, manifest);
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

function resolveLoopPause(action, manifest) {
  const override = manifest.actionLoopPausesMs?.[action];
  if (Number.isFinite(override) && override > 0) {
    return override;
  }

  return 0;
}
