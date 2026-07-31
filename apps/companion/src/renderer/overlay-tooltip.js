const TOOLTIP_OFFSET = 6;
const EDGE_MARGIN = 6;

export function createOverlayTooltip(root, { document = root?.ownerDocument ?? globalThis.document, window = document?.defaultView ?? globalThis.window, onChange } = {}) {
  if (!root || !document) {
    throw new TypeError("createOverlayTooltip requires a root element and document");
  }

  const element = document.createElement("div");
  element.className = "overlay-tooltip";
  element.hidden = true;
  root.appendChild(element);

  let activeTarget;

  function showFor(target) {
    const text = resolveTooltipText(target);
    if (!text) {
      hide();
      return false;
    }

    const changed = element.hidden || activeTarget !== target || element.textContent !== text;
    activeTarget = target;
    element.textContent = text;
    element.hidden = false;
    positionTooltip(element, target, root, window);
    if (changed) {
      onChange?.(true);
    }
    return true;
  }

  function showForPoint(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return hide();
    }
    const target = findTooltipTarget(document.elementFromPoint?.(x, y));
    return target ? showFor(target) : hide();
  }

  function hide() {
    if (element.hidden) {
      return false;
    }
    activeTarget = undefined;
    element.hidden = true;
    element.textContent = "";
    onChange?.(false);
    return true;
  }

  function handleMouseOver(event) {
    const target = findTooltipTarget(event.target);
    if (target) {
      showFor(target);
    }
  }

  function handleMouseMove(event) {
    showForPoint(event.clientX, event.clientY);
  }

  function handleMouseOut(event) {
    if (!activeTarget) {
      return;
    }
    const related = event.relatedTarget;
    if (related && (related === activeTarget || activeTarget.contains?.(related))) {
      return;
    }
    hide();
  }

  function handleFocusIn(event) {
    const target = findTooltipTarget(event.target);
    if (target) {
      showFor(target);
    }
  }

  function handleFocusOut(event) {
    if (!activeTarget) {
      return;
    }
    const related = event.relatedTarget;
    if (related && (related === activeTarget || activeTarget.contains?.(related))) {
      return;
    }
    hide();
  }

  root.addEventListener("mouseover", handleMouseOver);
  root.addEventListener("mousemove", handleMouseMove);
  root.addEventListener("mouseout", handleMouseOut);
  root.addEventListener("focusin", handleFocusIn);
  root.addEventListener("focusout", handleFocusOut);

  return {
    element,
    showFor,
    showForPoint,
    hide,
    destroy() {
      root.removeEventListener("mouseover", handleMouseOver);
      root.removeEventListener("mousemove", handleMouseMove);
      root.removeEventListener("mouseout", handleMouseOut);
      root.removeEventListener("focusin", handleFocusIn);
      root.removeEventListener("focusout", handleFocusOut);
      element.remove();
    }
  };
}

function findTooltipTarget(target) {
  return target?.closest?.("[data-tooltip]") ?? (resolveTooltipText(target) ? target : undefined);
}

function resolveTooltipText(target) {
  const value = target?.dataset?.tooltip ?? target?.getAttribute?.("data-tooltip") ?? "";
  return String(value).trim();
}

function positionTooltip(element, target, root, window) {
  const targetRect = target?.getBoundingClientRect?.();
  if (!targetRect) {
    return;
  }

  const rootRect = root.getBoundingClientRect?.() ?? { left: 0, top: 0, width: window?.innerWidth ?? 0, height: window?.innerHeight ?? 0 };
  const rootLeft = Number.isFinite(rootRect.left) ? rootRect.left : 0;
  const rootTop = Number.isFinite(rootRect.top) ? rootRect.top : 0;
  const rootWidth = Number.isFinite(rootRect.width) && rootRect.width > 0 ? rootRect.width : window?.innerWidth;
  const rootHeight = Number.isFinite(rootRect.height) && rootRect.height > 0 ? rootRect.height : window?.innerHeight;

  const width = Number.isFinite(element.offsetWidth) ? element.offsetWidth : 0;
  const height = Number.isFinite(element.offsetHeight) ? element.offsetHeight : 0;
  const maxLeft = Number.isFinite(rootWidth) && rootWidth > 0 ? Math.max(EDGE_MARGIN, rootWidth - width - EDGE_MARGIN) : undefined;
  const maxTop = Number.isFinite(rootHeight) && rootHeight > 0 ? Math.max(EDGE_MARGIN, rootHeight - height - EDGE_MARGIN) : undefined;

  let left = targetRect.left - rootLeft;
  let top = targetRect.bottom - rootTop + TOOLTIP_OFFSET;
  if (maxLeft !== undefined) {
    left = Math.min(Math.max(left, EDGE_MARGIN), maxLeft);
  }
  if (maxTop !== undefined) {
    top = Math.min(Math.max(top, EDGE_MARGIN), maxTop);
  }

  element.style.left = `${Math.round(left)}px`;
  element.style.top = `${Math.round(top)}px`;
}