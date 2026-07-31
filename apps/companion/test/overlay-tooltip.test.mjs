import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { createOverlayTooltip } from "../src/renderer/overlay-tooltip.js";

test("overlay tooltip shows data-tooltip text beside the target", () => {
  const root = new FakeElement("body");
  root.ownerDocument = new FakeDocument();
  const changes = [];
  const tooltip = createOverlayTooltip(root, { onChange: (visible) => changes.push(visible) });
  const target = new FakeElement("div");
  target.dataset.tooltip = "Codex · haya-pet";
  target.rect = { left: 40, top: 20, right: 120, bottom: 44, width: 80, height: 24 };

  assert.equal(tooltip.element.hidden, true);

  tooltip.showFor(target);

  assert.equal(tooltip.element.hidden, false);
  assert.equal(tooltip.element.textContent, "Codex · haya-pet");
  assert.equal(tooltip.element.style.left, "40px");
  assert.equal(tooltip.element.style.top, "50px");
  assert.deepEqual(changes, [true]);
});

test("overlay tooltip resolves the hovered target from a forwarded mouse point", () => {
  const root = new FakeElement("body");
  const document = new FakeDocument();
  root.ownerDocument = document;
  const tooltip = createOverlayTooltip(root);
  const target = new FakeElement("div");
  target.dataset.tooltip = "Hide sessions";
  document.hoveredElement = target;

  tooltip.showForPoint(10, 20);

  assert.equal(tooltip.element.hidden, false);
  assert.equal(tooltip.element.textContent, "Hide sessions");
});

test("overlay tooltip hides and reports shape changes", () => {
  const root = new FakeElement("body");
  root.ownerDocument = new FakeDocument();
  const changes = [];
  const tooltip = createOverlayTooltip(root, { onChange: (visible) => changes.push(visible) });
  const target = new FakeElement("div");
  target.dataset.tooltip = "Running tools";

  tooltip.showFor(target);
  tooltip.hide();

  assert.equal(tooltip.element.hidden, true);
  assert.equal(tooltip.element.textContent, "");
  assert.deepEqual(changes, [true, false]);
});

class FakeDocument {
  constructor() {
    this.hoveredElement = undefined;
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }

  elementFromPoint() {
    return this.hoveredElement;
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.className = "";
    this.textContent = "";
    this.hidden = false;
    this.ownerDocument = undefined;
    this.parentElement = undefined;
    this.rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    this.listeners = new Map();
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  addEventListener(name, handler) {
    this.listeners.set(name, handler);
  }

  removeEventListener(name, handler) {
    if (this.listeners.get(name) === handler) {
      this.listeners.delete(name);
    }
  }

  remove() {
    const parent = this.parentElement;
    if (!parent) {
      return;
    }
    const index = parent.children.indexOf(this);
    if (index !== -1) {
      parent.children.splice(index, 1);
    }
    this.parentElement = undefined;
  }

  getBoundingClientRect() {
    return this.rect;
  }
}