// Pure runtime state shape shared by the companion app and the CLI: global pet
// position/selection, per-session bubble positions, and settings. All updates
// return new objects (no mutation).

export function createDefaultPositionState() {
  return {
    globalPet: {
      open: true,
      selectedPetId: undefined,
      manual: false
    },
    sessions: {},
    settings: {
      displayMode: "hybrid",
      attachBubblesToTerminals: true
    }
  };
}

export function updateGlobalPetPosition(state, position) {
  return {
    ...state,
    globalPet: {
      ...state.globalPet,
      x: position.x,
      y: position.y,
      width: position.width,
      height: position.height,
      displayId: position.displayId,
      manual: true
    }
  };
}

export function setSelectedPet(state, petId) {
  return {
    ...state,
    globalPet: {
      ...state.globalPet,
      selectedPetId: petId
    }
  };
}

export function getSelectedPetId(state) {
  return state?.globalPet?.selectedPetId;
}

export function serializePositionState(state) {
  return `${JSON.stringify(state, null, 2)}\n`;
}

export function parsePositionState(text) {
  const defaults = createDefaultPositionState();

  try {
    const parsed = JSON.parse(text);
    if (!isPlainObject(parsed) || !isPlainObject(parsed.globalPet)) {
      return defaults;
    }

    return {
      globalPet: {
        ...defaults.globalPet,
        ...parsed.globalPet
      },
      sessions: isPlainObject(parsed.sessions) ? parsed.sessions : defaults.sessions,
      settings: {
        ...defaults.settings,
        ...(isPlainObject(parsed.settings) ? parsed.settings : {})
      }
    };
  } catch {
    return defaults;
  }
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
