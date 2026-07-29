export function createOverlayHoverClearer({ petEl, isInteractionCaptured, onPointerCleared, setMouseIgnore } = {}) {
  return function clearOverlayHover() {
    if (isInteractionCaptured?.()) {
      return false;
    }
    onPointerCleared?.();
    petEl?.classList?.remove("show-grip");
    setMouseIgnore?.(true);
    return true;
  };
}