# Publishing

How HAYA Pet is released to npm. Most users never need this — see the
[README](../README.md) to install and use it.

## Release flow

Releases are automated by [`.github/workflows/release.yml`](../.github/workflows/release.yml):
pushing a `v*` tag triggers a workflow that installs, runs the tests, checks the
tag matches `package.json`, and publishes to npm.

```bash
npm version patch        # bumps package.json + creates tag vX.Y.Z
git push --follow-tags   # pushes the tag → triggers the release workflow
```

The workflow installs with `ELECTRON_SKIP_BINARY_DOWNLOAD=1` (the ~150 MB binary
isn't needed to test or publish) and publishes with
`npm publish --provenance --access public` using the `NPM_TOKEN` secret.

## One-time setup

1. **`NPM_TOKEN` secret** — create an npm *automation* (or granular publish) token
   at npmjs.com and add it under GitHub → repo Settings → Secrets and variables →
   Actions → `NPM_TOKEN`.
2. **Package name** — confirm the name in `package.json` is available
   (`npm view <name>`); rename or use a scope (`@you/haya-pet`) if taken. The
   workflow already passes `--access public` for scoped packages.
3. **`private` removed** — `npm publish` refuses private packages; the root
   `package.json` must not have `"private": true` (already removed).
4. **Provenance / public repo** — `--provenance` requires a public repo and the
   `id-token: write` permission (set in the workflow). Drop `--provenance` if the
   repo is private.

## Notes

- **Local registry mirror.** If your local npm points at a mirror (e.g.
  `registry.npmmirror.com`), don't `npm publish` locally — the workflow targets
  `registry.npmjs.org` explicitly, which is what you want.
- **Lockfile sync.** After changing dependencies in `package.json`, refresh the
  lockfile (`npm install --package-lock-only`) and commit it, or CI's `npm ci`
  will fail on the mismatch.
- **Tarball contents.** The package ships the whole tree (`apps/` + `packages/`)
  because modules import each other by relative path. Test files are currently
  included; add a `"files"` allowlist to `package.json` to trim the tarball to
  runtime code only.
- **Runtime deps.** `electron` is a dependency (the CLI launches it); `node-pty`
  is optional (native build; live observation degrades gracefully without it).
