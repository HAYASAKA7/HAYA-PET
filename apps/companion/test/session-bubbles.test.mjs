import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { createBubbleList } from "../src/renderer/session-bubbles.js";
import { resolveBubbleListMaxHeight } from "../src/main/bubble-list-viewport.js";

// With five 48px bubbles spaced 54px apart, the host caps the list at the
// third bubble's bottom (156px) while the content runs to 264px, so the
// largest reachable scrollTop is 264 - 156 = 108.
const MAX_SCROLL_TOP = 108;

test("preserves bubble-list scroll position across ordinary session updates", () => {
  const restoreDocument = installFakeDocument();
  try {
    const container = new FakeElement("div");
    const bubbles = makeBubbles(["s1", "s2", "s3", "s4", "s5"]);
    const listView = createBubbleList(container, { onRender: createHostOnRender(container) });

    listView.render(bubbles);
    findList(container).scrollTop = 100;

    listView.render(bubbles.map((bubble) =>
      bubble.sessionId === "s4" ? { ...bubble, statusKind: "done", statusLabel: "Done" } : bubble
    ));

    assert.equal(findList(container).scrollTop, 100);
  } finally {
    restoreDocument();
  }
});

test("keeps the same list element across session updates so scroll gestures stay attached", () => {
  const restoreDocument = installFakeDocument();
  try {
    const container = new FakeElement("div");
    const bubbles = makeBubbles(["s1", "s2", "s3", "s4", "s5"]);
    const listView = createBubbleList(container, { onRender: createHostOnRender(container) });

    listView.render(bubbles);
    const firstList = findList(container);

    listView.render(bubbles.map((bubble) =>
      bubble.sessionId === "s2" ? { ...bubble, statusKind: "done", statusLabel: "Done" } : bubble
    ));

    // A wheel scroll or a scrollbar drag is bound to the element itself;
    // replacing the node mid-gesture makes the browser drop the gesture.
    assert.equal(findList(container), firstList);
  } finally {
    restoreDocument();
  }
});

test("keeps bubble elements for sessions that persist, updating them in place", () => {
  const restoreDocument = installFakeDocument();
  try {
    const container = new FakeElement("div");
    const bubbles = makeBubbles(["s1", "s2", "s3", "s4", "s5"]);
    const listView = createBubbleList(container, { onRender: createHostOnRender(container) });

    listView.render(bubbles);
    const firstBubble = findBubble(container, "s2");

    listView.render(bubbles.map((bubble) =>
      bubble.sessionId === "s2" ? { ...bubble, statusKind: "done", statusLabel: "Done", summary: "finished" } : bubble
    ));

    const updated = findBubble(container, "s2");
    assert.equal(updated, firstBubble);
    assert.equal(updated.dataset.kind, "done");
    assert.equal(findActivity(updated).textContent, "finished");
  } finally {
    restoreDocument();
  }
});

test("drops ended sessions and inserts new ones in payload order", () => {
  const restoreDocument = installFakeDocument();
  try {
    const container = new FakeElement("div");
    const listView = createBubbleList(container, { onRender: createHostOnRender(container) });

    listView.render(makeBubbles(["s1", "s2", "s3", "s4", "s5"]));
    listView.render(makeBubbles(["s2", "s6", "s4"]));

    const ids = findList(container).children.map((child) => child.dataset.sessionId);
    assert.deepEqual(ids, ["s2", "s6", "s4"]);
  } finally {
    restoreDocument();
  }
});

test("updates the folder button in place (count and urgency dot)", () => {
  const restoreDocument = installFakeDocument();
  try {
    const container = new FakeElement("div");
    const listView = createBubbleList(container, { onRender: createHostOnRender(container) });

    listView.render(makeBubbles(["s1", "s2", "s3", "s4", "s5"]));
    const button = findButton(container);

    listView.render(makeBubbles(["s1", "s2", "s3"]).map((bubble) =>
      bubble.sessionId === "s3" ? { ...bubble, statusKind: "failed", statusLabel: "Failed" } : bubble
    ));

    assert.equal(findButton(container), button);
    assert.equal(childByClass(button, "folder-count").textContent, "3");
    assert.equal(childByClass(button, "folder-summary").dataset.kind, "failed");
  } finally {
    restoreDocument();
  }
});

test("keeps the list mounted but marked collapsed, preserving scroll across a toggle", () => {
  const restoreDocument = installFakeDocument();
  try {
    const container = new FakeElement("div");
    const bubbles = makeBubbles(["s1", "s2", "s3", "s4", "s5"]);
    const listView = createBubbleList(container, { onRender: createHostOnRender(container) });

    listView.render(bubbles);
    findList(container).scrollTop = 100;

    // Collapsing keeps the node mounted (so it can animate out) but marks it
    // collapsed and drops the `interactive` marker so hit-testing ignores it.
    listView.toggle();
    const collapsed = findList(container);
    assert.ok(collapsed);
    assert.ok(collapsed.className.split(" ").includes("collapsed"));
    assert.ok(!collapsed.className.split(" ").includes("interactive"));

    listView.toggle();
    const expanded = findList(container);
    assert.ok(!expanded.className.split(" ").includes("collapsed"));
    assert.ok(expanded.className.split(" ").includes("interactive"));
    // The scrollTop rode through untouched since the node was never rebuilt.
    assert.equal(expanded.scrollTop, 100);
  } finally {
    restoreDocument();
  }
});

test("scrolls to a session when it newly needs attention", () => {
  const restoreDocument = installFakeDocument();
  try {
    const container = new FakeElement("div");
    const bubbles = makeBubbles(["s1", "s2", "s3", "s4", "s5"]);
    const listView = createBubbleList(container, { onRender: createHostOnRender(container) });

    listView.render(bubbles);
    findList(container).scrollTop = 0;

    listView.render(bubbles.map((bubble) =>
      bubble.sessionId === "s5" ? { ...bubble, statusKind: "attention", statusLabel: "Needs attention" } : bubble
    ));

    assert.equal(findList(container).scrollTop, MAX_SCROLL_TOP);
  } finally {
    restoreDocument();
  }
});

test("scrolls to a session when it newly fails", () => {
  const restoreDocument = installFakeDocument();
  try {
    const container = new FakeElement("div");
    const bubbles = makeBubbles(["s1", "s2", "s3", "s4", "s5"]);
    const listView = createBubbleList(container, { onRender: createHostOnRender(container) });

    listView.render(bubbles);
    findList(container).scrollTop = 0;

    listView.render(bubbles.map((bubble) =>
      bubble.sessionId === "s5" ? { ...bubble, statusKind: "failed", statusLabel: "Failed" } : bubble
    ));

    assert.equal(findList(container).scrollTop, MAX_SCROLL_TOP);
  } finally {
    restoreDocument();
  }
});

test("shows the compact project label and keeps the full name as an aria label", () => {
  const restoreDocument = installFakeDocument();
  try {
    const container = new FakeElement("div");
    const listView = createBubbleList(container, { onRender: createHostOnRender(container) });

    listView.render([{
      sessionId: "s1",
      statusKind: "working",
      statusLabel: "Working",
      clientName: "Claude Code",
      projectName: "netdisk-server",
      projectLabel: "netdisk-se...",
      summary: "running",
      elapsedLabel: "1s"
    }]);

    const bubble = findBubble(container, "s1");
    const title = childByClass(childByClass(bubble, "body"), "title");
    assert.equal(childByClass(title, "client").textContent, "Claude Code");
    assert.equal(childByClass(title, "project").textContent, "netdisk-se...");
    assert.equal(title.title, "");
    assert.equal(title.attributes["aria-label"], "Claude Code · netdisk-server");
    assert.equal(title.dataset.tooltip, "Claude Code · netdisk-server");
  } finally {
    restoreDocument();
  }
});

test("shows the compact summary label and keeps the full summary as an aria label", () => {
  const restoreDocument = installFakeDocument();
  try {
    const container = new FakeElement("div");
    const listView = createBubbleList(container, { onRender: createHostOnRender(container) });

    listView.render([{
      sessionId: "s1",
      statusKind: "working",
      statusLabel: "Running tools",
      clientName: "Claude Code",
      projectName: "haya-pet",
      projectLabel: "haya-pet",
      summary: "Read packages/session-core/src/summaries.js",
      summaryLabel: "Read packages/session-core/src/s...",
      elapsedLabel: "1s"
    }]);

    const activity = findActivity(findBubble(container, "s1"));
    // The bubble renders the capped label so a long tool name can't widen it...
    assert.equal(activity.textContent, "Read packages/session-core/src/s...");
    assert.equal(activity.title, "");
    assert.equal(activity.attributes["aria-label"], "Read packages/session-core/src/summaries.js · 1s");
    assert.equal(activity.dataset.tooltip, "Read packages/session-core/src/summaries.js · 1s");
  } finally {
    restoreDocument();
  }
});


test("uses controlled overlay tooltips instead of native title tooltips in session controls", () => {
  const restoreDocument = installFakeDocument();
  try {
    const container = new FakeElement("div");
    const listView = createBubbleList(container, { onRender: createHostOnRender(container) });

    listView.render([{
      sessionId: "s1",
      statusKind: "working",
      statusLabel: "Working",
      clientName: "Codex",
      projectName: "haya-pet",
      summary: "running",
      elapsedLabel: "1s"
    }]);

    const button = findButton(container);
    const bubble = findBubble(container, "s1");
    const icon = bubble.children[0];
    assert.equal(button.title, "");
    assert.equal(button.attributes["aria-label"], "Hide sessions");
    assert.equal(button.dataset.tooltip, "Hide sessions");
    assert.equal(icon.title, "");
    assert.equal(icon.attributes["aria-label"], "Working");
    assert.equal(icon.dataset.tooltip, "Working");
  } finally {
    restoreDocument();
  }
});
test("clears everything when no sessions remain", () => {
  const restoreDocument = installFakeDocument();
  try {
    const container = new FakeElement("div");
    const listView = createBubbleList(container, { onRender: createHostOnRender(container) });

    listView.render(makeBubbles(["s1", "s2"]));
    listView.render([]);

    assert.equal(container.children.length, 0);
  } finally {
    restoreDocument();
  }
});

function makeBubbles(sessionIds) {
  return sessionIds.map((sessionId) => ({
    sessionId,
    statusKind: "working",
    statusLabel: "Working",
    clientName: "Codex",
    projectName: sessionId,
    summary: "running",
    elapsedLabel: "1s"
  }));
}

function findList(container) {
  return container.children.find((child) => child.className.split(" ").includes("bubble-list"));
}

function findButton(container) {
  return container.children.find((child) => child.className === "folder-toggle interactive");
}

function findBubble(container, sessionId) {
  return findList(container).children.find((child) => child.dataset.sessionId === sessionId);
}

function findActivity(bubble) {
  const body = childByClass(bubble, "body");
  return childByClass(body, "activity");
}

function childByClass(parent, className) {
  return parent.children.find((child) => child.className === className);
}

// Mirrors pet-window's placePanel(): after each render the host measures the
// bubbles and applies the max-height cap. The list only becomes scrollable
// once this runs — the scroll-restore regression lived in that gap.
function createHostOnRender(container, room = 1000) {
  return () => {
    const list = findList(container);
    if (!list) {
      return;
    }
    const bubbleBottoms = list.children.map((child) => child.offsetTop + child.offsetHeight);
    list.style.maxHeight = `${resolveBubbleListMaxHeight({ room, bubbleBottoms })}px`;
  };
}

function installFakeDocument() {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: (tagName) => new FakeElement(tagName)
  };
  return () => {
    globalThis.document = previousDocument;
  };
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.style = {};
    this.parentElement = undefined;
    this.className = "";
    this.textContent = "";
    this.title = "";
    this.type = "";
    this._scrollTop = 0;
  }

  set innerHTML(_value) {
    for (const child of this.children) {
      child.parentElement = undefined;
    }
    this.children = [];
  }

  get innerHTML() {
    return "";
  }

  appendChild(child) {
    child.parentElement?.removeChild(child);
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  append(...children) {
    for (const child of children) {
      this.appendChild(child);
    }
  }

  insertBefore(child, reference) {
    child.parentElement?.removeChild(child);
    child.parentElement = this;
    const index = reference ? this.children.indexOf(reference) : -1;
    if (index === -1) {
      this.children.push(child);
    } else {
      this.children.splice(index, 0, child);
    }
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index !== -1) {
      this.children.splice(index, 1);
      child.parentElement = undefined;
    }
    return child;
  }

  remove() {
    this.parentElement?.removeChild(this);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  addEventListener(_name, _handler) {}

  get offsetTop() {
    const index = this.parentElement ? this.parentElement.children.indexOf(this) : 0;
    return Math.max(index, 0) * 54;
  }

  get offsetHeight() {
    return this.className === "bubble interactive" ? 48 : 24;
  }

  // The content height: bottom edge of the last child, like the browser.
  get scrollHeight() {
    const last = this.children[this.children.length - 1];
    return last ? last.offsetTop + last.offsetHeight : 0;
  }

  // Without a max-height cap the element grows to fit its content, which
  // makes it unscrollable (clientHeight === scrollHeight).
  get clientHeight() {
    const cap = Number.parseFloat(this.style.maxHeight);
    return Number.isFinite(cap) ? Math.min(cap, this.scrollHeight) : this.scrollHeight;
  }

  get scrollTop() {
    return this._scrollTop;
  }

  // Browsers clamp scrollTop into [0, scrollHeight - clientHeight]; the real
  // bug hid behind a fake that accepted any value.
  set scrollTop(value) {
    const maxScroll = Math.max(0, this.scrollHeight - this.clientHeight);
    this._scrollTop = Math.min(Math.max(value, 0), maxScroll);
  }
}
