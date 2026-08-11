export function showPetMenuPopup({ menu, ownerWindow, tray, platform, position }) {
  if (!menu || !ownerWindow || ownerWindow.isDestroyed?.()) {
    return false;
  }

  const nonfocusable = ownerWindow.isFocusable?.() === false;
  if (platform === "win32" && nonfocusable) {
    if (!tray || tray.isDestroyed?.()) {
      return false;
    }
    tray.popUpContextMenu(menu, position);
    return true;
  }

  menu.popup(nonfocusable ? {} : { window: ownerWindow });
  return true;
}
