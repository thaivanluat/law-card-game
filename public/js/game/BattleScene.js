import { BossActor } from './entities/BossActor.js';
import { KnightActor } from './entities/KnightActor.js';
import { registry } from './assets/AssetRegistry.js';
import { AnimationDirector } from './animations/AnimationDirector.js';

/**
 * Phaser combat stage. Rules stay on the server; this scene + AnimationDirector
 * only present authoritative state and queued combat FX.
 */
export class BattleScene extends Phaser.Scene {
  constructor() {
    super('Battle');
    this.boss = null;
    this.knights = [];
    this._state = null;
    this._ready = false;
    this.director = null;
    this._holdBossSpawn = false;
  }

  preload() {}

  async create() {
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor('#0b1210');
    this.add
      .text(width / 2, height / 2, 'Loading battlefield…', {
        fontFamily: 'Georgia, serif',
        fontSize: '18px',
        color: '#9fb3a8',
      })
      .setOrigin(0.5)
      .setName('loading');

    try {
      await registry.loadAll(this, (p) => {
        const t = this.children.getByName('loading');
        if (t?.setText) t.setText(`Loading battlefield… ${Math.round(p * 100)}%`);
      });
    } catch (e) {
      console.error('Asset load failed', e);
    }

    const loading = this.children.getByName('loading');
    if (loading) loading.destroy();

    const dungeonKey = this.textures.exists('dungeon') ? 'dungeon' : null;
    if (dungeonKey) {
      this.bg = this.add.image(width / 2, height / 2, dungeonKey).setDisplaySize(width, height).setDepth(0);
    } else {
      this.bg = this.add.rectangle(width / 2, height / 2, width, height, 0x0b1210).setDepth(0);
    }
    this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.2).setDepth(1);

    // Skip particle dust on phones — big win on A15-class Safari
    if (!this.lean && !this.bridge?.lean) {
      try {
        this._spawnAtmosphere();
      } catch (e) {
        console.warn('Atmosphere skipped', e);
      }
    }

    // Floor sits above the overlaid hand (~STS proportions)
    this.floorY = this._floorYFor(height);
    this.boss = new BossActor(this, width * 0.72, this.floorY);
    this.boss.root.setVisible(false);
    this.knights = [];
    this.director = new AnimationDirector(this);
    this._ready = true;

    this.scale.on('resize', (gs) => this._onResize(gs));
    this.events.on('shutdown', () => this._teardown());

    if (this._state) this.sync(this._state);
    this.bridge?.onSceneReady?.();
    this.time.delayedCall(0, () => this.bridge?.flush?.());
    this.time.delayedCall(50, () => {
      this.bridge?.resize?.();
      this.bridge?.flush?.();
    });
    this.time.delayedCall(200, () => {
      this.bridge?.resize?.();
      this.bridge?.flush?.();
    });
  }

  _spawnAtmosphere() {
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0xffe29a, 1);
    g.fillCircle(2, 2, 2);
    g.generateTexture('dust', 4, 4);
    g.destroy();
    this.add
      .particles(0, 0, 'dust', {
        x: { min: 0, max: this.scale.width },
        y: { min: 40, max: this.scale.height * 0.7 },
        speedY: { min: -12, max: -4 },
        speedX: { min: -6, max: 6 },
        lifespan: 4000,
        quantity: 1,
        frequency: 220,
        alpha: { start: 0.35, end: 0 },
        scale: { start: 0.6, end: 0.1 },
        blendMode: 'ADD',
      })
      .setDepth(2);
  }

  _floorYFor(height) {
    // Leave ~28–34% of the canvas for the floating hand overlay
    if (height < 380) return height * 0.52;
    if (height < 520) return height * 0.55;
    return height * 0.58;
  }

  _actorHeights() {
    const { width, height } = this.scale;
    // Prefer big readable fighters on phones — lean used to shrink them too much
    const bossH = Math.min(height * 0.7, width * 0.5, 560);
    const heroH = Math.min(height * 0.58, width * 0.38, 400);
    return { bossH, heroH };
  }

  _onResize(gameSize) {
    const { width, height } = gameSize;
    if (width < 2 || height < 2) return;
    if (this.bg?.setPosition) this.bg.setPosition(width / 2, height / 2);
    if (this.bg?.setDisplaySize) this.bg.setDisplaySize(width, height);
    this.floorY = this._floorYFor(height);
    if (this._state) this.sync(this._state);
  }

  _teardown() {
    this.director?.cancel();
    this.boss?.destroy();
    this.knights.forEach((k) => k.destroy());
    this.knights = [];
    this.boss = null;
    this.director = null;
    this._ready = false;
  }

  _formation(n, width) {
    const fy = this.floorY;
    if (n === 1) return [{ x: width * 0.22, y: fy }];
    if (n === 2)
      return [
        { x: width * 0.16, y: fy },
        { x: width * 0.3, y: fy - 18 },
      ];
    if (n === 3)
      return [
        { x: width * 0.14, y: fy },
        { x: width * 0.24, y: fy - 28 },
        { x: width * 0.34, y: fy },
      ];
    return [
      { x: width * 0.12, y: fy - 8 },
      { x: width * 0.22, y: fy - 28 },
      { x: width * 0.3, y: fy - 8 },
      { x: width * 0.18, y: fy + 10 },
    ];
  }

  /** Hold boss id swaps during death→spawn sequence (orchestrator owns spawn). */
  holdBossSpawn(on) {
    this._holdBossSpawn = !!on;
  }

  sync(state) {
    this._state = state;
    if (!this._ready) return;
    if (!state || !state.enemy || ['lobby', 'won', 'lost'].includes(state.phase)) {
      if (state?.phase !== 'lost') {
        this.boss?.root.setVisible(false);
        this.knights.forEach((k) => k.root.setVisible(false));
      }
      return;
    }

    const { width } = this.scale;
    const { bossH, heroH } = this._actorHeights();
    if (!this._holdBossSpawn) {
      this.boss.reviveAt(width * 0.72, this.floorY);
      this.boss.sync(state.enemy, state.enemyHP, state.enemyMax, state.enemyAttack, state.shield, state.immune);
      if (this.boss.sprite) {
        this.boss._fitHeight(bossH);
        this.boss._layoutHud?.();
      }
    }

    const want = state.players.length;
    const slots = this._formation(want, width);
    while (this.knights.length < want) {
      const i = this.knights.length;
      const s = slots[i] || slots[0];
      const role = state.players[i].role || 'warrior';
      this.knights.push(new KnightActor(this, s.x, s.y, role, state.players[i].name, i === state.me));
    }
    while (this.knights.length > want) this.knights.pop().destroy();

    this.knights.forEach((k, i) => {
      const s = slots[i];
      const role = state.players[i].role || 'warrior';
      if (k.role !== role) {
        k.destroy();
        this.knights[i] = new KnightActor(this, s.x, s.y, role, state.players[i].name, i === state.me);
        k = this.knights[i];
      }
      k.root.setVisible(true);
      k.setPosition(s.x, s.y);
      k._fitHeight?.(heroH);
      k._layoutTags?.();
      k.setMeta(state.players[i].name, state.players[i].count, i === state.me);
      if (k.hp > 0) k.setHp(1);
      k.setActiveTurn(state.turn === i && (state.phase === 'attack' || state.phase === 'defend'));
    });
  }

  // —— Legacy bridge hooks (orchestrator preferred) ——
  playAttack(byIndex) {
    this.director?.playerLunge(byIndex);
  }
  playBossStrike() {
    this.director?.bossAttack();
  }
  playBlock(byIndex, amount) {
    this.director?.playerBlock(byIndex, amount);
  }
  clearBlock(byIndex) {
    this.director?.playerClearBlock(byIndex);
  }
  playDefeat() {
    this.director?.bossDie();
  }
}
