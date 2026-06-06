import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "../../../test/harness.mjs";
import { discoverPets, loadPetFromDir } from "../src/discovery.js";

function manifest(id, name) {
  return JSON.stringify({ id, name, spritesheet: "spritesheet.webp" });
}

// Builds an injectable fake fs from explicit dir listings and file contents.
function fakeFs({ dirs = {}, files = {} } = {}) {
  return {
    async readdir(dir) {
      if (!(dir in dirs)) {
        const error = new Error("no dir");
        error.code = "ENOENT";
        throw error;
      }
      return dirs[dir];
    },
    async readFile(path) {
      if (!(path in files)) {
        const error = new Error("no file");
        error.code = "ENOENT";
        throw error;
      }
      return files[path];
    },
    async stat(path) {
      if (!(path in files)) {
        const error = new Error("no file");
        error.code = "ENOENT";
        throw error;
      }
      return {};
    }
  };
}

test("discovers pets with a manifest and spritesheet", async () => {
  const root = join("petsdir");
  const catDir = join(root, "cat");
  const fs = fakeFs({
    dirs: { [root]: ["cat"] },
    files: {
      [join(catDir, "pet.json")]: manifest("cat", "Cat"),
      [join(catDir, "spritesheet.webp")]: "binary"
    }
  });

  const pets = await discoverPets([root], fs);
  assert.equal(pets.length, 1);
  assert.equal(pets[0].manifest.id, "cat");
  assert.equal(pets[0].manifest.name, "Cat");
});

test("skips folders missing a spritesheet", async () => {
  const root = join("petsdir");
  const fs = fakeFs({
    dirs: { [root]: ["nopix"] },
    files: { [join(root, "nopix", "pet.json")]: manifest("nopix", "NoPix") }
  });

  assert.deepEqual(await discoverPets([root], fs), []);
});

test("dedupes by id across search paths (first wins)", async () => {
  const a = join("a");
  const b = join("b");
  const fs = fakeFs({
    dirs: { [a]: ["cat"], [b]: ["cat"] },
    files: {
      [join(a, "cat", "pet.json")]: manifest("cat", "Cat A"),
      [join(a, "cat", "spritesheet.webp")]: "x",
      [join(b, "cat", "pet.json")]: manifest("cat", "Cat B"),
      [join(b, "cat", "spritesheet.webp")]: "x"
    }
  });

  const pets = await discoverPets([a, b], fs);
  assert.equal(pets.length, 1);
  assert.equal(pets[0].manifest.name, "Cat A");
});

test("returns undefined for an invalid manifest", async () => {
  const dir = join("p");
  const fs = fakeFs({ files: { [join(dir, "pet.json")]: "{ not json" } });
  assert.equal(await loadPetFromDir(dir, fs), undefined);
});

test("tolerates missing search directories", async () => {
  assert.deepEqual(await discoverPets([join("does-not-exist")], fakeFs()), []);
});
