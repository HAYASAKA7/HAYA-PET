// Best-effort npm update check shared by the CLI (one-line notice) and the
// companion (tray item). One small registry request per TTL window, cached in
// state.json so the CLI and companion share it; every failure path resolves to
// undefined — an update notice must never block or break a run. Opt out with
// HAYA_PET_NO_UPDATE_CHECK=1.

export const UPDATE_PACKAGE_NAME = "@hayasaka7/haya-pet";
export const UPDATE_COMMAND = `npm install -g ${UPDATE_PACKAGE_NAME}`;
export const UPDATE_PAGE_URL = `https://www.npmjs.com/package/${UPDATE_PACKAGE_NAME}`;

// The version-specific manifest (a few KB) — not the full packument.
const REGISTRY_LATEST_URL = "https://registry.npmjs.org/@hayasaka7%2fhaya-pet/latest";
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 3000;

// Strictly-numeric dotted compare ("v" prefix tolerated). Anything else —
// prerelease tags, garbage, missing values — is conservatively "not newer",
// so a weird registry response can never produce a false update nag.
export function isNewerVersion(candidate, current) {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) {
    return false;
  }

  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) {
      return x > y;
    }
  }
  return false;
}

function parseVersion(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }
  const parts = value.trim().replace(/^v/, "").split(".");
  if (!parts.every((part) => /^\d+$/.test(part))) {
    return undefined;
  }
  return parts.map((part) => Number.parseInt(part, 10));
}

export function getLastUpdateCheck(state) {
  const entry = state?.updateCheck;
  if (!entry || typeof entry !== "object") {
    return undefined;
  }
  return entry;
}

export function setUpdateCheck(state, { checkedAt, latestVersion }) {
  return {
    ...state,
    updateCheck: { checkedAt, latestVersion }
  };
}

// Resolve the latest published version from the npm registry. The outer timer
// (not request.setTimeout) also covers DNS stalls, which happen before any
// socket exists. Always resolves — undefined on any failure.
export function fetchLatestVersion({
  url = REGISTRY_LATEST_URL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  get
} = {}) {
  return new Promise((resolve) => {
    let request;
    let settled = false;
    const settle = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        request?.destroy?.();
      } catch {
        // already closed
      }
      resolve(value);
    };

    // Deliberately ref'd: this timer is what guarantees the promise settles
    // (and an awaiting caller terminates) even when the request never responds
    // — e.g. a DNS stall. It is cleared the moment anything else settles, so it
    // never holds the process open after a normal success or failure.
    const timer = setTimeout(() => settle(undefined), timeoutMs);

    resolveGet(get)
      .then((getFn) => {
        if (settled) {
          return;
        }
        request = getFn(url, { headers: { accept: "application/json" } }, (response) => {
          if (response.statusCode !== 200) {
            response.resume();
            settle(undefined);
            return;
          }
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            body += chunk;
          });
          response.on("end", () => {
            try {
              const version = JSON.parse(body)?.version;
              settle(typeof version === "string" ? version : undefined);
            } catch {
              settle(undefined);
            }
          });
        });
        request.on("error", () => settle(undefined));
      })
      .catch(() => settle(undefined));
  });
}

// node:https is imported lazily so merely loading this module (e.g. from the
// renderer-adjacent companion code or tests) never touches the network stack.
async function resolveGet(get) {
  if (get) {
    return get;
  }
  const https = await import("node:https");
  return https.get;
}

// The single entry point: load the cached result (or fetch + cache it), and
// report `{ currentVersion, latestVersion }` only when an update exists.
// Never throws and never rejects.
export async function checkForUpdate(options = {}) {
  const {
    currentVersion,
    stateFile,
    env = process.env,
    now = Date.now,
    ttlMs = DEFAULT_TTL_MS,
    fetchLatest = fetchLatestVersion
  } = options;

  try {
    if (env.HAYA_PET_NO_UPDATE_CHECK === "1" || env.HAYA_PET_NO_UPDATE_CHECK === "true") {
      return undefined;
    }
    if (typeof currentVersion !== "string" || currentVersion === "" || !stateFile) {
      return undefined;
    }

    const state = await stateFile.load();
    const cached = getLastUpdateCheck(state);

    let latestVersion;
    if (cached && Number.isFinite(cached.checkedAt) && now() - cached.checkedAt < ttlMs) {
      latestVersion = cached.latestVersion;
    } else {
      latestVersion = await fetchLatest();
      if (typeof latestVersion !== "string" || latestVersion === "") {
        return undefined;
      }
      await stateFile.save(setUpdateCheck(state, { checkedAt: now(), latestVersion }));
    }

    return isNewerVersion(latestVersion, currentVersion) ? { currentVersion, latestVersion } : undefined;
  } catch {
    return undefined;
  }
}
