# Regicide HUD asset sheets

All three image files are PNG RGBA, 2172 x 724 px.

- `four_frame_red_sword_pulse.png` - four attack intent sword variants.
- `glowing_fantasy_suit_immunity_icons.png` - four suit immunity emblems, ordered spades, hearts, diamonds, clubs.
- `ornate_fantasy_health_bar_sprite_sheet.png` - decorative bar frames and fill elements.

IMPORTANT: These are generated image sheets, NOT prevalidated production sprite atlases. Individual art may have varying internal padding. Do NOT use guessed arbitrary texture crops. Phaser can load the whole PNGs; for individual icons, regular 4-column cells are 543 x 724 px, but verify cell bounds in preview before relying on them. Health bars are best implemented with Phaser graphics/9-slice shapes using the sheet for visual reference or ornamentation, because cropping/stretching entire cells may distort them. No gameplay rule should depend on HUD sprites.

Official Regicide has boss health, but players do NOT have HP; defense is done by discarding cards. Show player defense status during retaliation, not a persistent HP bar.
