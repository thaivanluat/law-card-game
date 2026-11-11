# Regicide — private solo / 2–4 player web game

Unofficial fan-made, self-hosted implementation for solo play or up to four friends. No account, subscription, database or external dependencies required.

## Requirements
- Node.js 18 or newer

## Start
```bash
node server.js
```
Visit http://localhost:3000 on the host.

### Two devices on the same Wi-Fi
Find your host computer's LAN IP (e.g. `192.168.1.20`). Both devices open `http://192.168.1.20:3000`. Allow incoming TCP port 3000 through your computer's firewall if prompted.

### Friends in different places
Host on a trusted server with HTTPS, or use a private network tool such as Tailscale to access the host. Do not publicly expose an HTTP-only game server without TLS and appropriate access controls.

## Play
### Solo
1. Choose **Play solo**. The assault starts immediately with an 8-card hand.
2. Attack and defend on your own. You have **2 Jesters** set aside: flip one before attacking or before defending to discard your whole hand and refill to 8 (twice per game).
3. Wins are ranked **Gold / Silver / Bronze** by how many Jesters you used (0 / 1 / 2).

### Co-op (2–4 players)
1. Host configures optional **home rules**, then **Create room**.
2. Others join with the 6-character code (max 4). Cosmetic roles: Warrior, Ranger, Mage, Cleric.
3. Host starts when at least 2 players are present. Hands stay private.

### Home rules (default OFF = official rulebook)
- **Diamonds — each draws:** each player draws up to the attack value. Off = shared clockwise draw until that many cards are taken.
- **Jesters in Tavern:** on → 2p gets 2 Jesters in the Tavern (3→1, 4→2). Off → official 2→0 · 3→1 · 4→2.

## Rules
- Solo: hand size 8, two Jesters as hand refreshes (official solo variant). Co-op hands: 2p 7 · 3p 6 · 4p 5.
- 12 royals (Jacks, Queens, Kings), in that order.
- Suit powers, immunity, Ace pairs, number combos, exact defeats, yielding, and defense are implemented.
- Hearts return shuffled discards under the Tavern. Diamonds follow room setting (official shared draw by default). Spades accumulate defense. Clubs double attack damage.
- Combat battlefield runs on **Phaser 3** with `public/asset/` pack v2 (12 bosses × idle/attack/hit/die, 4 heroes × idle/block/hit/die, FX strips). AnimationDirector + CombatOrchestrator sequence visuals; server remains rules-authoritative.
- Optional **room voice chat** (WebRTC mesh, 2–4 players): Join/Leave/Mute in the lobby bar and battle HUD. Signaling on `/ws` authenticated with room code + token; mic audio is peer-to-peer (not via the game server). Configure TURN with `TURN_URL`, `TURN_USER`, `TURN_PASS`. ICE list is served at `/ice-config`.
- After defeating a royal, the same player attacks the next royal.
- Solo Jester refreshes do not cancel enemy immunity and do not count as Diamond draws.

## Visuals
- Full illustrated deck faces live in `public/asset/art/` (`A`–`10` + `J/Q/K` per suit, plus solo `J1`/`J2` Jesters). Hand cards, played cards, and solo Jester tokens use these. Character poses live alongside in `public/asset/bosses` and `public/asset/players`. Replace any PNG to customize; pip/SVG fallbacks remain if a file is missing.
- Art sourced for private fan use from publicly posted Regicide card faces (Sketchgoblin / Badgers From Mars). Not affiliated with or endorsed by the publisher.
- Attacks, suit powers, kills and enemy strikes are animated for both players (server sends a small event log with each state). Sound effects are synthesised in the browser; use the 🔊 button to mute.

## Notes
- Rooms are in memory and reset when Node restarts.
- Player session lives in browser localStorage; the same browser tab can be reopened to resume.
- Server does not collect accounts or analytics.
- For two players, Jesters are not part of the official setup. Solo uses the two Jesters as set-aside refreshes only.
- Not affiliated with or endorsed by Badgers From Mars.

Official rulebook: https://www.regicidegame.com/site_files/33132/upload_files/RegicideRulesA4.pdf
