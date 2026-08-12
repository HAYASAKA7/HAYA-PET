// Runs the pet at its manifest frame cadence instead of invalidating the canvas
// on every display refresh. wake() re-evaluates state without forcing a draw;
// invalidate() is reserved for real visual changes such as image load/resize.
export function createPetAnimationTimer(options) {
  const {
    getState,
    resolveAction,
    getFrame,
    getNextDelay,
    draw,
    now = () => performance.now(),
    setTimer = setTimeout,
    clearTimer = clearTimeout
  } = options;

  let timer;
  let running = false;
  let invalidated = true;
  let currentAction;
  let actionStart = 0;
  let renderedAction;
  let renderedFrame = -1;

  function tick() {
    timer = undefined;
    if (!running) return;

    const timestamp = now();
    const state = getState();
    const action = resolveAction(state, timestamp);
    if (action !== currentAction) {
      currentAction = action;
      actionStart = timestamp;
    }

    const elapsed = Math.max(0, timestamp - actionStart);
    const frame = getFrame(action, elapsed);
    if (invalidated || action !== renderedAction || frame !== renderedFrame) {
      draw(action, frame, timestamp);
      renderedAction = action;
      renderedFrame = frame;
      invalidated = false;
    }

    let delay = getNextDelay(action, elapsed);
    if (action === state?.oneShotAction && Number.isFinite(state.oneShotEndsAt)) {
      delay = Math.min(delay, Math.max(1, state.oneShotEndsAt - timestamp));
    }
    timer = setTimer(tick, Math.max(1, Math.ceil(delay)));
  }

  function reschedule() {
    if (!running) return;
    clearTimer(timer);
    tick();
  }

  return {
    start() {
      if (running) return;
      running = true;
      tick();
    },
    wake() {
      reschedule();
    },
    invalidate() {
      invalidated = true;
      reschedule();
    },
    stop() {
      running = false;
      clearTimer(timer);
      timer = undefined;
    }
  };
}
