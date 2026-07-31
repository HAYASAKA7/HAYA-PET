export function createOverlayHoverClearer({ petEl, isInteractionCaptured, onPointerCleared, onHoverCleared, setMouseIgnore } = {}) {
  return function clearOverlayHover() {
    if (isInteractionCaptured?.()) {
      return false;
    }
    onPointerCleared?.();
    petEl?.classList?.remove("show-grip");
    onHoverCleared?.();
    setMouseIgnore?.(true);
    return true;
  };
}