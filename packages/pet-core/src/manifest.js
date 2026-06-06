import { ACTION_ROWS, CELL_HEIGHT, CELL_WIDTH } from "./atlas.js";

export const DEFAULT_FRAME_DURATION_MS = 120;

export function parsePetManifest(input) {
  if (!isPlainObject(input)) {
    return { ok: false, errors: ["manifest must be an object"] };
  }

  const errors = [];

  // Accept both this runtime's canonical fields and the Codex Desktop Pet
  // field names (displayName / spritesheetPath). Canonical wins when both exist.
  const name = input.name ?? input.displayName;
  const spritesheet = input.spritesheet ?? input.spritesheetPath;

  requireNonEmptyString(errors, input.id, "id");
  requireNonEmptyString(errors, name, "name");
  requireNonEmptyString(errors, spritesheet, "spritesheet");

  const cellWidth = input.cellWidth ?? CELL_WIDTH;
  const cellHeight = input.cellHeight ?? CELL_HEIGHT;

  if (cellWidth !== CELL_WIDTH) {
    errors.push(`cellWidth must be ${CELL_WIDTH}`);
  }

  if (cellHeight !== CELL_HEIGHT) {
    errors.push(`cellHeight must be ${CELL_HEIGHT}`);
  }

  const frameDurationMs = resolveDefaultDuration(errors, input.frameDurationMs);
  const actionFrameDurations = resolveActionDurations(errors, input.actionFrameDurations);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    errors: [],
    manifest: {
      id: input.id,
      name,
      spritesheet,
      cellWidth,
      cellHeight,
      frameDurationMs,
      actionFrameDurations
    }
  };
}

export function getFrameDurationMs(manifest, action) {
  if (!Object.prototype.hasOwnProperty.call(ACTION_ROWS, action)) {
    throw new Error(`Unknown pet action: ${action}`);
  }

  const override = manifest.actionFrameDurations?.[action];
  return Number.isFinite(override) ? override : manifest.frameDurationMs;
}

function resolveDefaultDuration(errors, value) {
  if (value === undefined) {
    return DEFAULT_FRAME_DURATION_MS;
  }

  if (!Number.isFinite(value) || value <= 0) {
    errors.push("frameDurationMs must be a positive number");
    return DEFAULT_FRAME_DURATION_MS;
  }

  return value;
}

function resolveActionDurations(errors, value) {
  if (value === undefined) {
    return {};
  }

  if (!isPlainObject(value)) {
    errors.push("actionFrameDurations must be an object");
    return {};
  }

  const resolved = {};
  for (const [action, duration] of Object.entries(value)) {
    if (!Object.prototype.hasOwnProperty.call(ACTION_ROWS, action)) {
      errors.push(`actionFrameDurations contains unknown action: ${action}`);
      continue;
    }

    if (!Number.isFinite(duration) || duration <= 0) {
      errors.push(`actionFrameDurations.${action} must be a positive number`);
      continue;
    }

    resolved[action] = duration;
  }

  return resolved;
}

function requireNonEmptyString(errors, value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${fieldName} must be a non-empty string`);
  }
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
