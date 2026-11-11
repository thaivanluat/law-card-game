/**
 * Loads Regicide combat pack v2 from /asset/manifest.json.
 * Poses = load.image; die/fx strips = load.spritesheet.
 */
const RANK_WORD = { J: 'jack', Q: 'queen', K: 'king' };
const SUIT_WORD = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };
export const PLAYER_ROLES = ['warrior', 'ranger', 'mage', 'cleric'];
const BUST = 'v=8';
/** HUD sheets: 2172×724 → four columns of 543×724 (see regicide_hud_assets/README). */
export const HUD_FRAME_W = 543;
export const HUD_FRAME_H = 724;
export const HUD_SHEETS = {
  sword: 'hud/four_frame_red_sword_pulse.png',
  immunity: 'hud/glowing_fantasy_suit_immunity_icons.png',
  health: 'hud/ornate_fantasy_health_bar_sprite_sheet.png',
};
/** Sheet column order: Spades, Hearts, Diamonds, Clubs */
export const IMMUNITY_FRAME = { S: 0, H: 1, D: 2, C: 3 };

export class AssetRegistry {
  constructor() {
    this.manifest = null;
    this._loaded = false;
    this.missing = [];
  }

  /** Absolute URLs used by the boot loader (browser HTTP cache → faster Phaser load). */
  async listWarmUrls() {
    const res = await fetch(`/asset/manifest.json?${BUST}`);
    this.manifest = await res.json();
    const urls = [`/asset/manifest.json?${BUST}`, `/asset/dungeon-bg.jpg?${BUST}`];
    const add = (rel) => {
      if (!rel) return;
      urls.push(`/asset/${rel}?${BUST}`);
    };
    for (const poses of Object.values(this.manifest.bosses || {})) {
      for (const pose of ['idle', 'attack', 'hit', 'die']) add(poses[pose]);
    }
    for (const poses of Object.values(this.manifest.players || {})) {
      for (const pose of ['idle', 'block', 'hit', 'die']) add(poses[pose]);
    }
    for (const def of Object.values(this.manifest.fx || {})) add(def.path);
    for (const rel of Object.values(HUD_SHEETS)) add(rel);
    return [...new Set(urls)];
  }

  /** @param {Phaser.Scene} scene */
  async loadAll(scene, onProgress) {
    if (this._loaded && scene.textures.exists('dungeon')) {
      onProgress?.(1);
      return;
    }
    this.missing = [];

    if (!this.manifest) {
      const res = await fetch(`/asset/manifest.json?${BUST}`);
      this.manifest = await res.json();
    }

    const bosses = this.manifest.bosses || {};
    for (const [id, poses] of Object.entries(bosses)) {
      for (const pose of ['idle', 'attack', 'hit']) {
        if (!poses[pose]) continue;
        scene.load.image(`boss:${id}:${pose}`, `/asset/${poses[pose]}?${BUST}`);
      }
      if (poses.die) {
        const fw = poses.dieFrameWidth || 384;
        scene.load.spritesheet(`boss:${id}:die`, `/asset/${poses.die}?${BUST}`, {
          frameWidth: fw,
          frameHeight: fw,
        });
      }
    }

    const players = this.manifest.players || {};
    for (const [role, poses] of Object.entries(players)) {
      for (const pose of ['idle', 'block', 'hit']) {
        if (!poses[pose]) continue;
        scene.load.image(`hero:${role}:${pose}`, `/asset/${poses[pose]}?${BUST}`);
      }
      if (poses.die) {
        const fw = poses.dieFrameWidth || 384;
        scene.load.spritesheet(`hero:${role}:die`, `/asset/${poses.die}?${BUST}`, {
          frameWidth: fw,
          frameHeight: fw,
        });
      }
    }

    const fx = this.manifest.fx || {};
    for (const [name, def] of Object.entries(fx)) {
      scene.load.spritesheet(`fx:${name}`, `/asset/${def.path}?${BUST}`, {
        frameWidth: def.frameWidth || 256,
        frameHeight: def.frameHeight || 256,
      });
    }

    scene.load.image('dungeon', `/asset/dungeon-bg.jpg?${BUST}`);

    // Combat HUD sheets (sword pulse · suit immunity · ornate bar reference)
    scene.load.spritesheet('hud:sword', `/asset/${HUD_SHEETS.sword}?${BUST}`, {
      frameWidth: HUD_FRAME_W,
      frameHeight: HUD_FRAME_H,
    });
    scene.load.spritesheet('hud:immunity', `/asset/${HUD_SHEETS.immunity}?${BUST}`, {
      frameWidth: HUD_FRAME_W,
      frameHeight: HUD_FRAME_H,
    });
    scene.load.spritesheet('hud:health', `/asset/${HUD_SHEETS.health}?${BUST}`, {
      frameWidth: HUD_FRAME_W,
      frameHeight: HUD_FRAME_H,
    });

    await new Promise((resolve) => {
      const report = (value) => {
        try { onProgress?.(value); } catch (_) {/* ignore */}
      };
      scene.load.on(Phaser.Loader.Events.PROGRESS, report);
      scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
        scene.load.off(Phaser.Loader.Events.PROGRESS, report);
        report(1);
        resolve();
      });
      scene.load.once(Phaser.Loader.Events.FILE_LOAD_ERROR, (file) => {
        console.warn('[AssetRegistry] load error', file?.key || file);
      });
      scene.load.start();
    });

    this._validate(scene);
    this._createAnims(scene);
    this._loaded = true;
  }

  _validate(scene) {
    const missing = [];
    for (const id of Object.keys(this.manifest.bosses || {})) {
      for (const pose of ['idle', 'attack', 'hit', 'die']) {
        const key = `boss:${id}:${pose}`;
        if (!scene.textures.exists(key)) missing.push(key);
      }
    }
    for (const role of Object.keys(this.manifest.players || {})) {
      for (const pose of ['idle', 'block', 'hit', 'die']) {
        const key = `hero:${role}:${pose}`;
        if (!scene.textures.exists(key)) missing.push(key);
      }
    }
    for (const name of Object.keys(this.manifest.fx || {})) {
      if (!scene.textures.exists(`fx:${name}`)) missing.push(`fx:${name}`);
    }
    if (!scene.textures.exists('dungeon')) missing.push('dungeon');
    for (const key of ['hud:sword', 'hud:immunity', 'hud:health']) {
      if (!scene.textures.exists(key)) missing.push(key);
    }
    this.missing = missing;
    if (missing.length) console.warn('[AssetRegistry] missing textures:', missing);
    else console.info('[AssetRegistry] all combat textures present');
  }

  _createAnims(scene) {
    const ensure = (key, textureKey, frameCount, frameRate = 10, repeat = 0) => {
      if (!scene.textures.exists(textureKey) || scene.anims.exists(key)) return;
      const end = Math.max(0, (frameCount || 7) - 1);
      scene.anims.create({
        key,
        frames: scene.anims.generateFrameNumbers(textureKey, { start: 0, end }),
        frameRate,
        repeat,
      });
    };

    for (const [id, poses] of Object.entries(this.manifest.bosses || {})) {
      ensure(`anim:boss:${id}:die`, `boss:${id}:die`, poses.dieFrames || 7, 11);
    }
    for (const [role, poses] of Object.entries(this.manifest.players || {})) {
      ensure(`anim:hero:${role}:die`, `hero:${role}:die`, poses.dieFrames || 7, 11);
    }
    for (const [name, def] of Object.entries(this.manifest.fx || {})) {
      ensure(`anim:fx:${name}`, `fx:${name}`, def.frames || 7, 14);
    }
    // Soft STS-style attack-intent pulse
    ensure('anim:hud:sword', 'hud:sword', 4, 5, -1);
  }

  immunityFrame(suit) {
    return IMMUNITY_FRAME[suit] ?? 0;
  }

  /** @param {{rank:string,suit:string}} enemy */
  bossKey(enemy, pose = 'idle') {
    const id = `${RANK_WORD[enemy.rank]}_of_${SUIT_WORD[enemy.suit]}`;
    return `boss:${id}:${pose}`;
  }

  bossId(enemy) {
    return `${RANK_WORD[enemy.rank]}_of_${SUIT_WORD[enemy.suit]}`;
  }

  bossAnim(enemy, pose = 'die') {
    return `anim:boss:${this.bossId(enemy)}:${pose}`;
  }

  /** @param {string|number} roleOrSeat */
  heroKey(roleOrSeat, pose = 'idle') {
    const role = this.roleOf(roleOrSeat);
    return `hero:${role}:${pose}`;
  }

  heroAnim(roleOrSeat, pose = 'die') {
    return `anim:hero:${this.roleOf(roleOrSeat)}:${pose}`;
  }

  roleOf(roleOrSeat) {
    if (typeof roleOrSeat === 'number') return PLAYER_ROLES[roleOrSeat] || PLAYER_ROLES[0];
    return PLAYER_ROLES.includes(roleOrSeat) ? roleOrSeat : PLAYER_ROLES[0];
  }

  fallbackBossIdle() {
    return 'boss:jack_of_clubs:idle';
  }

  fallbackHeroIdle() {
    return 'hero:warrior:idle';
  }
}

export const registry = new AssetRegistry();
