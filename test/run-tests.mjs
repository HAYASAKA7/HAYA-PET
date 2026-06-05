import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runRegisteredTests } from "./harness.mjs";

async function findTestFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findTestFiles(absolute));
    } else if (entry.name.endsWith(".test.mjs")) {
      files.push(absolute);
    }
  }

  return files;
}

const root = fileURLToPath(new URL("..", import.meta.url));
const testRoots = ["packages", "apps"];
const testFiles = [];

for (const testRoot of testRoots) {
  try {
    testFiles.push(...await findTestFiles(join(root, testRoot)));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

for (const file of testFiles) {
  const displayPath = relative(root, file).split(sep).join("/");
  console.log(`# ${displayPath}`);
  await import(pathToFileURL(file));
}

const result = await runRegisteredTests();
console.log(`# ${result.total - result.failed}/${result.total} tests passed`);

if (result.failed > 0) {
  process.exitCode = 1;
}
