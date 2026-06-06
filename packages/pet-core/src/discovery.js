import { readdir as fsReaddir, readFile as fsReadFile, stat as fsStat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parsePetManifest } from "./manifest.js";

// Scans pet search paths for Codex-compatible pets. Each pet is a directory
// containing pet.json plus a spritesheet file. Filesystem functions are
// injectable so discovery is testable without touching the real disk. Pets are
// deduplicated by manifest id (first search path wins).
export async function discoverPets(searchPaths = [], deps = {}) {
  const { readdir } = resolveFs(deps);
  const pets = [];
  const seen = new Set();

  for (const searchPath of searchPaths) {
    const entries = await safeReaddir(readdir, searchPath);

    for (const entry of entries) {
      const petDir = join(searchPath, entry);
      const pet = await loadPetFromDir(petDir, deps);
      if (pet && !seen.has(pet.manifest.id)) {
        seen.add(pet.manifest.id);
        pets.push(pet);
      }
    }
  }

  return pets;
}

export async function loadPetFromDir(petDir, deps = {}) {
  const { readFile, stat } = resolveFs(deps);
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
  if (!(await fileExists(stat, spritesheetPath))) {
    return undefined;
  }

  return {
    dir: petDir,
    manifest: result.manifest,
    spritesheetPath,
    spritesheetUrl: pathToFileURL(spritesheetPath).href
  };
}

function resolveFs(deps) {
  return {
    readdir: deps.readdir ?? fsReaddir,
    readFile: deps.readFile ?? fsReadFile,
    stat: deps.stat ?? fsStat
  };
}

async function safeReaddir(readdir, dir) {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

async function fileExists(stat, path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
