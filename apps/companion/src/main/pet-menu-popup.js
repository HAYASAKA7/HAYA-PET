export function resolvePetMenuPopupOptions(ownerWindow) {
  if (!ownerWindow || ownerWindow.isDestroyed?.()) {
    return {};
  }

  // The transparent pet overlay is intentionally non-focusable/click-through.
  // Owning a native context menu from that window can leave the menu stuck until
  // a click lands back on the pet region. Use an unowned popup in that mode so
  // normal outside clicks dismiss the menu.
  if (ownerWindow.isFocusable?.() === false) {
    return {};
  }

  return { window: ownerWindow };
}