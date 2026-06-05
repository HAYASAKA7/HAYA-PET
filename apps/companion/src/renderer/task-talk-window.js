// Layer 3 renderer: the task talk window control surface. Uses the pure
// task-core helpers for reply-mode safety and control gating, and the adapter
// capabilities registry to decide what is safe to show per client.

import { resolveReplyMode } from "../../../../packages/task-core/src/replies.js";
import { getAdapterCapabilities } from "../../../../packages/adapters/src/capabilities.js";

export function createTalkWindow(container, bridge) {
  let current;

  function close() {
    current = undefined;
    container.classList.add("hidden");
    container.innerHTML = "";
  }

  function open(bubble, mode = "peek") {
    current = bubble;
    container.classList.remove("hidden");
    render(bubble, mode);
  }

  function render(bubble, mode) {
    const capabilities = getAdapterCapabilities(bubble.clientId);
    const replyMode = resolveReplyMode(capabilities);
    const controls = resolveControls(bubble);

    container.innerHTML = "";
    container.append(
      renderHeader(bubble, close),
      renderActivity(bubble),
      ...(bubble.state === "waiting_approval" ? [renderApproval(bubble, capabilities, bridge)] : []),
      renderComposer(bubble, replyMode, bridge),
      renderControls(controls, bubble, bridge)
    );

    if (mode === "peek") {
      // Peek keeps only the essentials visible; expanded/full reuse the same
      // building blocks with more history once a transcript store is wired.
      container.dataset.mode = "peek";
    }
  }

  async function resolveControls(bubble) {
    if (bridge?.getTaskControls) {
      return bridge.getTaskControls({ clientId: bubble.clientId, status: bubble.state });
    }
    return [];
  }

  return { open, close, isOpen: () => Boolean(current), current: () => current };
}

function renderHeader(bubble, close) {
  const header = document.createElement("header");
  const title = document.createElement("span");
  title.innerHTML = `<strong>${bubble.clientName}</strong> · ${bubble.projectName}`;
  const pill = document.createElement("span");
  pill.className = "pill";
  pill.dataset.state = bubble.state;
  pill.textContent = bubble.statusLabel;
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", close);
  header.append(title, pill, closeBtn);
  return header;
}

function renderActivity(bubble) {
  const activity = document.createElement("div");
  activity.className = "activity";
  activity.textContent = `${bubble.summary} · ${bubble.elapsedLabel}`;
  return activity;
}

function renderApproval(bubble, capabilities, bridge) {
  const panel = document.createElement("div");
  panel.className = "approval";
  panel.textContent = "Approval requested";

  const canApprove = capabilities.canApprove !== "unsupported";
  for (const decision of ["approve", "deny"]) {
    const btn = document.createElement("button");
    btn.textContent = decision === "approve" ? "Approve" : "Deny";
    btn.disabled = !canApprove;
    btn.addEventListener("click", () =>
      bridge?.resolveApproval?.({ sessionId: bubble.sessionId, approvalId: bubble.approvalId, decision })
    );
    panel.appendChild(btn);
  }
  return panel;
}

function renderComposer(bubble, replyMode, bridge) {
  const composer = document.createElement("div");
  composer.className = "composer";

  if (replyMode === "open-terminal") {
    const note = document.createElement("button");
    note.textContent = "Open terminal to reply";
    note.addEventListener("click", () => bridge?.reply?.({ sessionId: bubble.sessionId, text: "", focusTerminal: true }));
    composer.appendChild(note);
    return composer;
  }

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = replyMode === "best-effort" ? "Reply (best effort)…" : "Reply…";

  const send = document.createElement("button");
  send.textContent = "Send";
  send.addEventListener("click", () => {
    const text = input.value.trim();
    if (text) {
      bridge?.reply?.({ sessionId: bubble.sessionId, text });
      input.value = "";
    }
  });

  composer.append(input, send);
  return composer;
}

function renderControls(controlsPromise, bubble, bridge) {
  const wrap = document.createElement("div");
  wrap.className = "controls";

  Promise.resolve(controlsPromise).then((controls) => {
    for (const control of controls) {
      if (control.id === "reply" || control.id === "approve" || control.id === "deny") {
        continue; // rendered in the composer / approval panel
      }
      const btn = document.createElement("button");
      btn.textContent = control.label;
      btn.disabled = !control.enabled;
      wrap.appendChild(btn);
    }
  });

  return wrap;
}
