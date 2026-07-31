// Layer 2 renderer: Codex-style progress bubbles. Each ongoing AI session shows
// a status icon, its title (client · project), and the newest activity line.
// A folder button at the top toggles the whole stack open/closed.
//
// Consumes the bubble view models produced by packages/session-core/bubble-view.js
// (already shaped + sorted by the main process), so this module is pure DOM glue.
// Status kinds come from `bubble.statusKind`: working | done | attention | failed.
//
// Rendering is INCREMENTAL, not a full rebuild: the list element and each
// session's bubble persist across updates and are mutated in place. Sessions
// push status constantly (plus a linger tick), and a wheel scroll or scrollbar
// drag is bound to the live element — replacing the node mid-gesture made the
// browser drop the gesture ("scroll disconnects, redo it"). Keeping the nodes
// stable also avoids restarting the spinner animation on every refresh.

const STATUS_GLYPH = Object.freeze({
  working: "",   // animated spinner drawn via CSS
  done: "✓",
  attention: "!",
  failed: "✕",
  idle: ""
});

export function createBubbleList(container, { collapsed = false, onRender } = {}) {
  let lastBubbles = [];
  let isCollapsed = collapsed;
  let lastScrollTop = 0;
  let previousKinds = {};
  // Persistent nodes, reused across paints (see the module header).
  let folderButtonEl;
  let listEl;

  function toggle() {
    isCollapsed = !isCollapsed;
    paint();
  }

  function paint() {
    // Capture the live scroll position before anything can tear the list down.
    if (listEl) {
      lastScrollTop = listEl.scrollTop;
    }
    const scrollTargetSessionId = resolveScrollTarget(lastBubbles, previousKinds);
    previousKinds = Object.fromEntries(lastBubbles.map((bubble) => [bubble.sessionId, bubble.statusKind]));

    // Nothing running -> keep the overlay clean (just the pet, no folder button).
    if (lastBubbles.length === 0) {
      clearContainer();
      onRender?.();
      return;
    }

    if (!folderButtonEl) {
      folderButtonEl = createFolderButton(toggle);
      container.appendChild(folderButtonEl);
    }
    updateFolderButton(folderButtonEl, lastBubbles, isCollapsed);

    // The list stays mounted whether open or collapsed so the collapse can
    // animate out (a macOS-popover shrink+fade, see styles.css) instead of
    // vanishing; this also preserves the scroll position and the spinner across
    // a toggle. The `collapsed` class drives the transition and, once faded,
    // drops the list from hit-testing (pointer-events + visibility), so the
    // click-through overlay ignores it — hence it also sheds the `interactive`
    // marker while collapsed.
    if (!listEl) {
      // The list itself must be pointer-active (not just the bubbles): with more
      // than three sessions it scrolls, and the scrollbar + the gaps between
      // bubbles belong to the list element — if it stayed click-through, wheel/
      // drag there would fall through to the desktop.
      listEl = document.createElement("div");
      container.appendChild(listEl);
    }
    reconcileBubbles(listEl, lastBubbles);
    listEl.className = isCollapsed ? "bubble-list collapsed" : "bubble-list interactive";

    // Let the host reposition the panel now that its size is known. This must
    // happen BEFORE the scroll restore below: the host's placement pass is what
    // applies the list's max-height cap (.bubble-list has none in CSS), and
    // until that cap exists the list is as tall as its content, so any
    // scrollTop assigned to it would clamp back to 0.
    onRender?.();

    // Restoring scroll only matters while the list is visible; a collapsed list
    // keeps the scrollTop it had, so it reopens exactly where the user left it.
    if (!isCollapsed) {
      applyListScroll(listEl, scrollTargetSessionId, lastScrollTop);
      lastScrollTop = listEl.scrollTop;
    }
  }

  function clearContainer() {
    container.innerHTML = "";
    folderButtonEl = undefined;
    listEl = undefined;
  }

  return {
    render(bubbles = []) {
      lastBubbles = Array.isArray(bubbles) ? bubbles : [];
      paint();
    },
    expand() {
      if (isCollapsed) {
        toggle();
      }
    },
    toggle,
    isCollapsed: () => isCollapsed
  };
}

// Reuses bubble elements for sessions that persist (mutating them in place),
// creates elements for new sessions, removes elements for gone sessions, and
// orders the list to match the payload — all without replacing the list node.
function reconcileBubbles(list, bubbles) {
  const existing = new Map();
  for (const child of Array.from(list.children)) {
    if (child.dataset?.sessionId) {
      existing.set(child.dataset.sessionId, child);
    }
  }

  const desired = new Set(bubbles.map((bubble) => bubble.sessionId));
  for (const [sessionId, el] of existing) {
    if (!desired.has(sessionId)) {
      el.remove();
      existing.delete(sessionId);
    }
  }

  bubbles.forEach((bubble, index) => {
    let el = existing.get(bubble.sessionId);
    if (el) {
      applyBubble(el, bubble);
    } else {
      el = renderBubble(bubble);
    }
    // Place el at `index`. insertBefore moves an already-present node, so a
    // forward walk converges the order in one pass (sessionIds are unique, so
    // el is never already in the finalized prefix [0..index-1]).
    if (list.children[index] !== el) {
      list.insertBefore(el, list.children[index] ?? null);
    }
  });
}

const URGENT_KINDS = new Set(["attention", "failed"]);
function resolveScrollTarget(bubbles, previousKinds) {
  let attentionSessionId;
  for (const bubble of bubbles) {
    if (!URGENT_KINDS.has(bubble.statusKind) || previousKinds[bubble.sessionId] === bubble.statusKind) {
      continue;
    }
    if (bubble.statusKind === "failed") {
      return bubble.sessionId;
    }
    attentionSessionId ??= bubble.sessionId;
  }
  return attentionSessionId;
}

function applyListScroll(list, sessionId, fallbackScrollTop) {
  if (sessionId) {
    const target = Array.from(list.children).find((child) => child.dataset.sessionId === sessionId);
    if (target) {
      list.scrollTop = target.offsetTop;
      return;
    }
  }
  list.scrollTop = fallbackScrollTop;
}

function createFolderButton(onToggle) {
  const btn = document.createElement("button");
  // "interactive" marks the only pointer-active regions so the rest of the
  // overlay window can stay click-through (see pet-window.js).
  btn.className = "folder-toggle interactive";
  btn.type = "button";

  // A simple disclosure caret (rotates when open) — quieter than a folder glyph.
  const caret = document.createElement("span");
  caret.className = "caret";

  const count = document.createElement("span");
  count.className = "folder-count";

  // A small dot summary of the most urgent kind, so the user can tell something
  // needs attention without opening the folder.
  const summary = document.createElement("span");
  summary.className = "folder-summary";

  btn.append(caret, count, summary);
  btn.addEventListener("click", onToggle);
  return btn;
}

function updateFolderButton(btn, bubbles, collapsed) {
  btn.setAttribute("aria-expanded", String(!collapsed));
  setTooltipFreeLabel(btn, collapsed ? "Show sessions" : "Hide sessions");
  const [, count, summary] = btn.children;
  count.textContent = String(bubbles.length);
  summary.dataset.kind = mostUrgentKind(bubbles);
}

function renderBubble(bubble) {
  const el = document.createElement("div");
  el.className = "bubble interactive";
  el.dataset.sessionId = bubble.sessionId;

  const icon = document.createElement("span");
  icon.className = "status-icon";

  const body = document.createElement("div");
  body.className = "body";

  const title = document.createElement("div");
  title.className = "title";

  // Persistent title parts (mutated in place across updates, like everything
  // else here). The client name is always shown in full; the project name is
  // shown compact (bubble.projectLabel) with the full name kept as an aria label.
  const client = document.createElement("span");
  client.className = "client";
  const project = document.createElement("span");
  project.className = "project";
  title.append(client, project);

  const activity = document.createElement("div");
  activity.className = "activity";

  body.append(title, activity);
  el.append(icon, body);

  applyBubble(el, bubble);
  return el;
}

// Writes a bubble's dynamic content. Used for both fresh elements (from
// renderBubble) and reused ones, so a session update mutates the live node.
function applyBubble(el, bubble) {
  el.dataset.kind = bubble.statusKind;

  const [icon, body] = el.children;
  icon.dataset.kind = bubble.statusKind;
  icon.textContent = STATUS_GLYPH[bubble.statusKind] ?? "";
  setTooltipFreeLabel(icon, bubble.statusLabel);

  const [title, activity] = body.children;
  const [client, project] = title.children;
  client.textContent = bubble.clientName;
  project.textContent = bubble.projectLabel ?? bubble.projectName;
  setTooltipFreeLabel(title, bubble.projectName ? `${bubble.clientName} · ${bubble.projectName}` : bubble.clientName);
  // Compact label keeps a long status/tool name from stretching the bubble; the
  // full summary stays available through the controlled overlay tooltip and assistive tech.
  activity.textContent = bubble.summaryLabel ?? bubble.summary;
  setTooltipFreeLabel(activity, `${bubble.summary ?? bubble.statusLabel} · ${bubble.elapsedLabel}`);
}

// Picks the kind that should win the collapsed-folder dot: a failure or a
// request for attention always beats ongoing work, which beats done/idle.
function setTooltipFreeLabel(el, label) {
  const text = String(label ?? "");
  el.title = "";
  el.setAttribute("aria-label", text);
  if (text) {
    el.dataset.tooltip = text;
  } else {
    delete el.dataset.tooltip;
  }
}
const KIND_RANK = Object.freeze({ failed: 0, attention: 1, working: 2, done: 3, idle: 4 });
function mostUrgentKind(bubbles) {
  let best = "idle";
  for (const bubble of bubbles) {
    if ((KIND_RANK[bubble.statusKind] ?? 9) < (KIND_RANK[best] ?? 9)) {
      best = bubble.statusKind;
    }
  }
  return best;
}
