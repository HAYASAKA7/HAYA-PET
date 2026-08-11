export function showPetMenuPopup(menu, ownerWindow) {
  if (!menu || !ownerWindow || ownerWindow.isDestroyed?.()) {
    return false;
  }

  const restoreFocusability = ownerWindow.isFocusable?.() === false;
  let restored = false;
  const restore = () => {
    if (restored || !restoreFocusability || ownerWindow.isDestroyed?.()) {
      return;
    }
    restored = true;
    ownerWindow.setFocusable(false);
  };

  if (restoreFocusability) {
    ownerWindow.setFocusable(true);
  }

  try {
    if (restoreFocusability) {
      ownerWindow.focus();
    }
    menu.popup({ window: ownerWindow, callback: restore });
    return true;
  } catch (error) {
    restore();
    throw error;
  }
}
