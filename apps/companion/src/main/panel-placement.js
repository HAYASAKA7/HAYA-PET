// Decides where a panel (task talk window / bubble cluster) should sit relative
// to the pet so it sits *beside* the pet — never on top of it — and stays fully
// inside the visible work area. Picks the side with the most room: right, then
// left, then below, then above, clamping the cross-axis to the work area.
const DEFAULT_GAP = 8;

export function resolvePanelPlacement({ pet, panel, workArea, gap = DEFAULT_GAP } = {}) {
  const right = pet.x + pet.width + gap;
  const left = pet.x - gap - panel.width;
  const below = pet.y + pet.height + gap;
  const above = pet.y - gap - panel.height;

  const areaRight = workArea.x + workArea.width;
  const areaBottom = workArea.y + workArea.height;

  if (right + panel.width <= areaRight) {
    return { side: "right", x: right, y: clampAxis(pet.y, panel.height, workArea.y, areaBottom) };
  }

  if (left >= workArea.x) {
    return { side: "left", x: left, y: clampAxis(pet.y, panel.height, workArea.y, areaBottom) };
  }

  if (below + panel.height <= areaBottom) {
    return { side: "below", x: clampAxis(pet.x, panel.width, workArea.x, areaRight), y: below };
  }

  if (above >= workArea.y) {
    return { side: "above", x: clampAxis(pet.x, panel.width, workArea.x, areaRight), y: above };
  }

  // No clear room on any side (tiny screen): overlap as a last resort, clamped.
  return {
    side: "overlap",
    x: clampAxis(pet.x, panel.width, workArea.x, areaRight),
    y: clampAxis(pet.y, panel.height, workArea.y, areaBottom)
  };
}

function clampAxis(start, size, min, max) {
  if (start + size > max) {
    return Math.max(min, max - size);
  }
  return Math.max(min, start);
}
