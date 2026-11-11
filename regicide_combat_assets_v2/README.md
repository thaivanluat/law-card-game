# Regicide Combat Asset Pack v2

## Included
- 12 royal bosses (Jack, Queen, King x Spades, Hearts, Diamonds, Clubs): 36 transparent single-pose idle/attack/hit PNGs, plus 12 seven-frame die strips.
- 4 cosmetic players (Warrior, Ranger, Mage, Cleric): 8 idle/block transparent PNGs, 4 synthesized hit poses, 4 seven-frame die strips.
- Three optional 7-frame FX sprite strips: block, hit, slash.
- `manifest.json` with every path and frame dimension; contact-sheet preview.

## IMPORTANT QUALITY NOTE
These assets reuse the **previous concept-art character cutouts**, so some low-resolution/pixelated regions or stray atlas fragments may still be present. The die sprite strips are **procedural transforms** (tilt, fall, fade) of these drawings, not new hand-drawn anatomical death poses. Do not claim they are production-quality art. They are usable as a prototype and never require Cursor to cut a sprite sheet.

## Phaser usage
- Preload all assets from the JSON manifest, including bosses that have not spawned yet.
- Idle/attack/hit/block are individual images. Load with `scene.load.image(key, path)`. Do not apply a crop.
- Die action: **seven frames in one horizontal strip**, each exactly **384 x 384**; load using `scene.load.spritesheet(key, path, { frameWidth: 384, frameHeight: 384 })`.
- FX strips: seven frames of 256 x 256.
- Do not use a spritesheet loader for single pose images.
- Use `(0.5, 1)` origins and consistent render height. Do not stretch to arbitrary widths and heights simultaneously.
- A killed boss is not replaced until the death animation has finished. When spawning the next boss, use its own keys and reset alpha/rotation/position.
- Death strips' last frame is intentionally transparent.
- This pack does not modify the official Regicide rule flow, Jester, defense discards, or coop turn order.

For exact paths and frame definitions, inspect `manifest.json`.

**Player block pose note:** the prior generated block PNGs included clipping or neighboring artwork, so this pack uses the cleaned idle silhouette for the block pose and provides the `fx/block.png` shield effect to overlay.
