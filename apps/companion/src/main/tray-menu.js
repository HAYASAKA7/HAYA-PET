// Pure tray menu model (product plan section 40). The Electron main process
// converts these descriptors into a native Menu; keeping it pure makes the
// recovery controls testable.

export function buildTrayTooltip() {
  return "HAYA Pet";
}

export function buildTrayMenu(state = {}) {
  const sessions = Array.isArray(state.sessions) ? state.sessions : [];
  const pets = Array.isArray(state.pets) ? state.pets : [];

  return [
    {
      id: "toggle_pet",
      label: state.petVisible ? "Hide Pet" : "Show Pet"
    },
    {
      id: "sessions",
      label: "Active Sessions",
      submenu: buildSessionItems(sessions)
    },
    {
      id: "pets",
      label: "Installed Pets",
      submenu: buildPetItems(pets, state.selectedPetId)
    },
    { id: "reset_position", label: "Reset Position" },
    // Parked until a real settings window exists; partially implemented knobs
    // stay hidden instead of showing dead or state-only controls.
    // { id: "settings", label: "Open Settings" },
    // Only present when the daily npm update check found a newer version;
    // clicking it opens the package page (the app never runs npm itself).
    ...(state.updateAvailable?.latestVersion
      ? [{ id: "update", label: `Update Available (${state.updateAvailable.latestVersion})` }]
      : []),
    { id: "separator", type: "separator" },
    { id: "quit", label: "Quit" }
  ];
}

function buildSessionItems(sessions) {
  if (sessions.length === 0) {
    return [{ id: "sessions:empty", label: "No active sessions", enabled: false }];
  }

  return sessions.map((session) => ({
    id: `session:${session.sessionId}`,
    label: session.label,
    sessionId: session.sessionId
  }));
}

function buildPetItems(pets, selectedPetId) {
  if (pets.length === 0) {
    return [{ id: "pets:empty", label: "No pets found", enabled: false }];
  }

  return pets.map((pet) => ({
    id: `pet:${pet.id}`,
    label: pet.name,
    petId: pet.id,
    type: "radio",
    checked: pet.id === selectedPetId
  }));
}
