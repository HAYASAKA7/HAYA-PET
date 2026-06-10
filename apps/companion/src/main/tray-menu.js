// Pure tray menu model (product plan section 40). The Electron main process
// converts these descriptors into a native Menu; keeping it pure makes the
// recovery controls testable.

const DISPLAY_MODES = Object.freeze([
  { value: "global", label: "Global" },
  { value: "cluster", label: "Cluster" },
  { value: "per-terminal", label: "Per Terminal" },
  { value: "hybrid", label: "Hybrid" }
]);

export function buildTrayMenu(state = {}) {
  const sessions = Array.isArray(state.sessions) ? state.sessions : [];
  const pets = Array.isArray(state.pets) ? state.pets : [];

  return [
    {
      id: "toggle_pet",
      label: state.petVisible ? "Hide Pet" : "Show Pet"
    },
    {
      id: "display_mode",
      label: "Display Mode",
      submenu: DISPLAY_MODES.map((mode) => ({
        id: `display_mode:${mode.value}`,
        label: mode.label,
        value: mode.value,
        type: "radio",
        checked: state.displayMode === mode.value
      }))
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
    {
      id: "attach_bubbles",
      label: "Attach Bubbles to Terminals",
      type: "checkbox",
      checked: Boolean(state.attachBubblesToTerminals)
    },
    { id: "reset_position", label: "Reset Position" },
    // Parked until a real settings window exists: every current setting already
    // has a home (tray toggles, `haya-pet hooks`, drag/grip gestures), so the
    // item would be a dead button. Re-enable once settings outgrow the tray
    // (e.g. bubble text size, linger duration) and a handler is wired up.
    // { id: "settings", label: "Open Settings" },
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
