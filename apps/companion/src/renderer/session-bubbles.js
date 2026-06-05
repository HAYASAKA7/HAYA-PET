// Layer 2 renderer: compact session bubbles. Consumes the bubble view models
// produced by packages/session-core/bubble-view.js (already shaped by the main
// process), so this module is pure DOM rendering.

export function createBubbleList(container, { onSelect } = {}) {
  return {
    render(bubbles = []) {
      container.innerHTML = "";

      for (const bubble of bubbles) {
        container.appendChild(renderBubble(bubble, onSelect));
      }
    }
  };
}

function renderBubble(bubble, onSelect) {
  const el = document.createElement("div");
  el.className = bubble.selected ? "bubble selected" : "bubble";
  el.dataset.sessionId = bubble.sessionId;

  const row = document.createElement("div");
  row.className = "row";

  const identity = document.createElement("span");
  identity.innerHTML = `<span class="client">${escapeHtml(bubble.clientName)}</span> ` +
    `<span class="project">${escapeHtml(bubble.projectName)}</span>`;

  const pill = document.createElement("span");
  pill.className = "pill";
  pill.dataset.state = bubble.state;
  pill.textContent = bubble.statusLabel;

  row.append(identity, pill);

  const summary = document.createElement("div");
  summary.className = "summary";
  summary.textContent = `${bubble.summary} · ${bubble.elapsedLabel}`;

  el.append(row, summary);
  el.addEventListener("click", () => onSelect?.(bubble));

  return el;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
