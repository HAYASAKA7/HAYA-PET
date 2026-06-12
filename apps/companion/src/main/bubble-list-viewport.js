// Caps the bubble list's visible height. Two budgets apply, and the tighter one
// wins: the HEIGHT budget (the pixel room between the folder button and the
// screen edge on the side the list opens toward) and a COUNT budget — at most
// MAX_VISIBLE_BUBBLES bubbles are visible at once, so a long session list stays
// a compact panel and the rest is reached by scrolling (.bubble-list has
// overflow-y: auto). The floor keeps the list usable even when the button sits
// against a screen edge.
const DEFAULT_MAX_VISIBLE_BUBBLES = 3;
const DEFAULT_MIN_HEIGHT = 96;

// `bubbleBottoms` are the layout bottoms (offsetTop + offsetHeight) of each
// bubble in list order; the count cap is the bottom of the last bubble allowed
// to be visible, so exactly that many show before scrolling.
export function resolveBubbleListMaxHeight({
  room,
  bubbleBottoms = [],
  maxVisible = DEFAULT_MAX_VISIBLE_BUBBLES,
  minHeight = DEFAULT_MIN_HEIGHT
} = {}) {
  const heightBudget = Number.isFinite(room) ? Math.round(room) : 0;

  const capBottom = bubbleBottoms.length > maxVisible ? bubbleBottoms[maxVisible - 1] : undefined;
  const countBudget = Number.isFinite(capBottom) ? Math.round(capBottom) : Infinity;

  return Math.max(minHeight, Math.min(heightBudget, countBudget));
}
