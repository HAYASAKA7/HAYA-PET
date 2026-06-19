import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { buildTrayMenu, buildTrayTooltip } from "../src/main/tray-menu.js";

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
  for (const id of ["toggle_pet", "sessions", "pets", "reset_position", "quit"]) {
    assert.ok(ids.includes(id), `missing ${id}`);
  }
  assert.ok(!ids.includes("display_mode"), "display mode should stay hidden until implemented");
  assert.ok(!ids.includes("attach_bubbles"), "attach bubbles should stay hidden until implemented");
  // "Open Settings" is parked until a settings window exists (every current
  // setting already has a tray/CLI/gesture home) — it must not be shown dead.
  assert.ok(!ids.includes("settings"), "settings item should stay hidden until implemented");
});

test("toggles the pet label based on visibility", () => {
  assert.equal(buildTrayMenu({ ...baseState, petVisible: true }).find((i) => i.id === "toggle_pet").label, "Hide Pet");
  assert.equal(buildTrayMenu({ ...baseState, petVisible: false }).find((i) => i.id === "toggle_pet").label, "Show Pet");
});

test("lists active sessions or shows an empty placeholder", () => {
  const withSessions = buildTrayMenu(baseState).find((i) => i.id === "sessions").submenu;
  assert.equal(withSessions[0].label, "Codex · netdisk-server");

  const empty = buildTrayMenu({ ...baseState, sessions: [] }).find((i) => i.id === "sessions").submenu;
  assert.equal(empty[0].enabled, false);
});

test("shows the update item only when a newer version is known", () => {
  const withoutUpdate = buildTrayMenu(baseState);
  assert.ok(!withoutUpdate.some((i) => i.id === "update"), "no update item by default");

  const withUpdate = buildTrayMenu({ ...baseState, updateAvailable: { latestVersion: "9.9.9" } });
  const item = withUpdate.find((i) => i.id === "update");
  assert.ok(item, "update item appears when an update is known");
  assert.ok(item.label.includes("9.9.9"), "label names the new version");
});

test("uses the HAYA Pet brand in the tray hover text", () => {
  assert.equal(buildTrayTooltip(), "HAYA Pet");
});
