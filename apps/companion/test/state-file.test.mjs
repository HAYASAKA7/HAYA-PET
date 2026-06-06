import assert from "node:assert/strict";
import { test } from "../../../test/harness.mjs";
import { createStateFile } from "../src/main/state-file.js";

function fakeFs(initial) {
  const files = new Map(initial ? Object.entries(initial) : []);
  return {
    files,
    async readFile(path) {
      if (!files.has(path)) {
        const error = new Error("not found");
        error.code = "ENOENT";
        throw error;
      }
      return files.get(path);
    },
    async writeFile(path, content) {
      files.set(path, content);
    },
    async mkdir() {}
  };
}

test("returns default state when the file is missing", async () => {
  const fs = fakeFs();
  const store = createStateFile({ statePath: "/tmp/haya-pet/state.json", ...fs });
  const state = await store.load();
  assert.equal(state.globalPet.open, true);
  assert.equal(state.settings.displayMode, "hybrid");
});

test("persists and reloads global pet position", async () => {
  const fs = fakeFs();
  const store = createStateFile({ statePath: "/tmp/haya-pet/state.json", ...fs });

  await store.save({
    globalPet: { open: true, x: 100, y: 200, manual: true },
    sessions: {},
    settings: { displayMode: "hybrid", attachBubblesToTerminals: true }
  });

  const reloaded = await store.load();
  assert.equal(reloaded.globalPet.x, 100);
  assert.equal(reloaded.globalPet.y, 200);
});

test("recovers from corrupt state content", async () => {
  const fs = fakeFs({ "/tmp/haya-pet/state.json": "{ not json" });
  const store = createStateFile({ statePath: "/tmp/haya-pet/state.json", ...fs });
  const state = await store.load();
  assert.equal(state.globalPet.open, true);
});
