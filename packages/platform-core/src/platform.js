export function normalizePlatform(platform = process.platform) {
  if (platform === "win32" || platform === "windows") {
    return "windows";
  }

  if (platform === "darwin" || platform === "macos") {
    return "macos";
  }

  if (platform === "linux") {
    return "linux";
  }

  return "unsupported";
}
