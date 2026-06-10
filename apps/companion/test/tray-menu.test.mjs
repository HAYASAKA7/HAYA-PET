import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { buildTrayMenu } from "../src/main/tray-menu.js";

const baseState = {
  petVisible: true,
  displayMode: "hybrid",
  attachBubblesToTerminals: true,
  sessions: [{ sessionId: "s1", label: "Codex · netdisk-server" }],
  pets: [{ id: "example-pet", name: "Example Pet" }]
};

test("includes the documented recovery controls", () => {
  const menu = buildTrayMenu(baseState);
  const ids = menu.map((item) => item.id);
  for (const id of ["toggle_pet", "display_mode", "sessions", "pets", "attach_bubbles", "reset_position", "quit"]) {
    assert.ok(ids.includes(id), `missing ${id}`);
  }
  // "Open Settings" is parked until a settings window exists (every current
  // setting already has a tray/CLI/gesture home) — it must not be shown dead.
  assert.ok(!ids.includes("settings"), "settings item should stay hidden until implemented");
});

test("toggles the pet label based on visibility", () => {
  assert.equal(buildTrayMenu({ ...baseState, petVisible: true }).find((i) => i.id === "toggle_pet").label, "Hide Pet");
  assert.equal(buildTrayMenu({ ...baseState, petVisible: false }).find((i) => i.id === "toggle_pet").label, "Show Pet");
});

test("checks the current display mode in the submenu", () => {
  const submenu = buildTrayMenu(baseState).find((i) => i.id === "display_mode").submenu;
  const hybrid = submenu.find((i) => i.value === "hybrid");
  const global = submenu.find((i) => i.value === "global");
  assert.equal(hybrid.checked, true);
  assert.equal(global.checked, false);
});

test("lists active sessions or shows an empty placeholder", () => {
  const withSessions = buildTrayMenu(baseState).find((i) => i.id === "sessions").submenu;
  assert.equal(withSessions[0].label, "Codex · netdisk-server");

  const empty = buildTrayMenu({ ...baseState, sessions: [] }).find((i) => i.id === "sessions").submenu;
  assert.equal(empty[0].enabled, false);
});

test("reflects the attach-bubbles checkbox state", () => {
  assert.equal(buildTrayMenu(baseState).find((i) => i.id === "attach_bubbles").checked, true);
  assert.equal(buildTrayMenu({ ...baseState, attachBubblesToTerminals: false }).find((i) => i.id === "attach_bubbles").checked, false);
});
