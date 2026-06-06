// Layer 2 renderer: Codex-style progress bubbles. Each ongoing AI session shows
// a status icon, its title (client · project), and the newest activity line.
// A folder button at the top toggles the whole stack open/closed.
//
// Consumes the bubble view models produced by packages/session-core/bubble-view.js
// (already shaped + sorted by the main process), so this module is pure DOM glue.
// Status kinds come from `bubble.statusKind`: working | done | attention | failed.

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

  function toggle() {
    isCollapsed = !isCollapsed;
    paint();
  }

  function paint() {
    container.innerHTML = "";

    // Nothing running -> keep the overlay clean (just the pet, no folder button).
    if (lastBubbles.length > 0) {
      container.appendChild(renderFolderButton(lastBubbles, isCollapsed, toggle));

      if (!isCollapsed) {
        const list = document.createElement("div");
        list.className = "bubble-list";
        for (const bubble of lastBubbles) {
          list.appendChild(renderBubble(bubble));
        }
        container.appendChild(list);
      }
    }

    // Let the host reposition the panel now that its size is known.
    onRender?.();
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

function renderFolderButton(bubbles, collapsed, onToggle) {
  const btn = document.createElement("button");
  // "interactive" marks the only pointer-active regions so the rest of the
  // overlay window can stay click-through (see pet-window.js).
  btn.className = "folder-toggle interactive";
  btn.type = "button";
  btn.setAttribute("aria-expanded", String(!collapsed));
  btn.title = collapsed ? "Show sessions" : "Hide sessions";

  // A simple disclosure caret (rotates when open) — quieter than a folder glyph.
  const caret = document.createElement("span");
  caret.className = "caret";

  const count = document.createElement("span");
  count.className = "folder-count";
  count.textContent = String(bubbles.length);

  // A small dot summary of the most urgent kind, so the user can tell something
  // needs attention without opening the folder.
  const summary = document.createElement("span");
  summary.className = "folder-summary";
  summary.dataset.kind = mostUrgentKind(bubbles);

  btn.append(caret, count, summary);
  btn.addEventListener("click", onToggle);
  return btn;
}

function renderBubble(bubble) {
  const el = document.createElement("div");
  el.className = "bubble interactive";
  el.dataset.sessionId = bubble.sessionId;
  el.dataset.kind = bubble.statusKind;

  const icon = document.createElement("span");
  icon.className = "status-icon";
  icon.dataset.kind = bubble.statusKind;
  icon.textContent = STATUS_GLYPH[bubble.statusKind] ?? "";
  icon.title = bubble.statusLabel;

  const body = document.createElement("div");
  body.className = "body";

  const title = document.createElement("div");
  title.className = "title";
  title.innerHTML = `<span class="client">${escapeHtml(bubble.clientName)}</span> ` +
    `<span class="project">${escapeHtml(bubble.projectName)}</span>`;

  const activity = document.createElement("div");
  activity.className = "activity";
  activity.textContent = bubble.summary;
  activity.title = `${bubble.statusLabel} · ${bubble.elapsedLabel}`;

  body.append(title, activity);
  el.append(icon, body);
  return el;
}

// Picks the kind that should win the collapsed-folder dot: a failure or a
// request for attention always beats ongoing work, which beats done/idle.
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

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
