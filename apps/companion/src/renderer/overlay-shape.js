export function buildOverlayShapeRects({ viewport, rects = [] } = {}) {
  const width = finiteNumber(viewport?.width);
  const height = finiteNumber(viewport?.height);
  if (!width || !height) {
    return [];
  }

  const shaped = [];
  for (const rect of rects) {
    const source = normalizeSourceRect(rect);
    if (!source) {
      continue;
    }
    const left = Math.max(0, Math.floor(source.left));
    const top = Math.max(0, Math.floor(source.top));
    const right = Math.min(width, Math.ceil(source.right));
    const bottom = Math.min(height, Math.ceil(source.bottom));
    const shapedWidth = right - left;
    const shapedHeight = bottom - top;
    if (shapedWidth <= 0 || shapedHeight <= 0) {
      continue;
    }
    shaped.push({ x: left, y: top, width: shapedWidth, height: shapedHeight });
  }
  return shaped;
}

export function sameOverlayShape(a = [], b = []) {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((rect, index) => {
    const other = b[index];
    return rect.x === other.x && rect.y === other.y && rect.width === other.width && rect.height === other.height;
  });
}

function normalizeSourceRect(rect) {
  const left = finiteNumber(rect?.left ?? rect?.x);
  const top = finiteNumber(rect?.top ?? rect?.y);
  const right = finiteNumber(rect?.right ?? (left === undefined ? undefined : left + finiteNumber(rect?.width)));
  const bottom = finiteNumber(rect?.bottom ?? (top === undefined ? undefined : top + finiteNumber(rect?.height)));
  if ([left, top, right, bottom].some((value) => value === undefined) || right <= left || bottom <= top) {
    return undefined;
  }
  return { left, top, right, bottom };
}

function finiteNumber(value) {
  return Number.isFinite(value) ? value : undefined;
}
