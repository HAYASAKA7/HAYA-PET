import { ACTION_ROWS, ATLAS_HEIGHT, ATLAS_WIDTH } from "./atlas.js";
import { parsePetManifest } from "./manifest.js";

export function validateAtlasDimensions(dimensions) {
  const errors = [];

  if (!dimensions || dimensions.width !== ATLAS_WIDTH || dimensions.height !== ATLAS_HEIGHT) {
    errors.push(
      `spritesheet must be ${ATLAS_WIDTH}x${ATLAS_HEIGHT}, received ${dimensions?.width}x${dimensions?.height}`
    );
  }

  return { ok: errors.length === 0, errors };
}

export function validatePetActions(actionFrameCounts) {
  const errors = [];
  const counts = actionFrameCounts ?? {};

  for (const action of Object.keys(ACTION_ROWS)) {
    const frameCount = counts[action];

    if (!Number.isInteger(frameCount) || frameCount <= 0) {
      errors.push(`action "${action}" must have at least one used cell`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function validatePet({ manifest, dimensions, actionFrameCounts } = {}) {
  const errors = [];

  const manifestResult = parsePetManifest(manifest);
  if (!manifestResult.ok) {
    errors.push(...manifestResult.errors);
  }

  errors.push(...validateAtlasDimensions(dimensions).errors);
  errors.push(...validatePetActions(actionFrameCounts).errors);

  return { ok: errors.length === 0, errors };
}
