import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parsePetManifest } from "../../../../packages/pet-core/src/manifest.js";

// Scans the configured pet search paths for Codex-compatible pets. Each pet is a
// directory containing pet.json plus a spritesheet. Atlas dimension validation
// happens in the renderer once the image has loaded (Image.naturalWidth).
export async function discoverPets(searchPaths = []) {
  const pets = [];
  const seen = new Set();

  for (const searchPath of searchPaths) {
    const entries = await safeReaddir(searchPath);

    for (const entry of entries) {
      const petDir = join(searchPath, entry);
      const pet = await loadPetFromDir(petDir);
      if (pet && !seen.has(pet.manifest.id)) {
        seen.add(pet.manifest.id);
        pets.push(pet);
      }
    }
  }

  return pets;
}

export async function loadPetFromDir(petDir) {
  const manifestPath = join(petDir, "pet.json");

  let raw;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch {
    return undefined;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }

  const result = parsePetManifest(parsed);
  if (!result.ok) {
    return undefined;
  }

  const spritesheetPath = join(petDir, result.manifest.spritesheet);
  if (!(await fileExists(spritesheetPath))) {
    return undefined;
  }

  return {
    dir: petDir,
    manifest: result.manifest,
    spritesheetPath,
    spritesheetUrl: pathToFileURL(spritesheetPath).href
  };
}

async function safeReaddir(dir) {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
