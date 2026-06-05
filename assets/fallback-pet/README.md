# Fallback Pet

This directory holds the bundled fallback pet manifest. The matching
`spritesheet.webp` is a binary 1536×1872 Codex-compatible atlas (8 columns ×
9 rows of 192×208 cells) and is **not** checked in here.

To use a real pet:

- Drop a Codex-compatible pet (a folder with `pet.json` + `spritesheet.webp`)
  into `~/.codex/pets` or `~/.ai-pet/pets`, or
- Add `spritesheet.webp` next to this `pet.json`.

If no spritesheet is found, the companion renderer draws labelled placeholder
frames so interaction and state mapping can still be exercised during
development. Atlas dimensions are validated against 1536×1872 once the image
loads (`packages/pet-core/src/validation.js`).
