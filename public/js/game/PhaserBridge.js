import { BattleScene } from './BattleScene.js';

const isLeanDevice = () => {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)')?.matches;
  const narrow = window.matchMedia?.('(max-width: 900px)')?.matches;
  const short = window.matchMedia?.('(max-height: 500px)')?.matches;
  const ua = navigator.userAgent || '';
  const mobileUa = /iPhone|iPad|iPod|Android/i.test(ua);
  return !!(coarse || narrow || short || mobileUa);
};

/**
 * DOM ↔ Phaser façade + access to AnimationDirector.
 */
class PhaserBridge {
  constructor() {
    this.game = null;
    this.scene = null;
    this.host = null;
    this._pending = null;
    this._ro = null;
    this._resizeTimer = null;
    this.lean = isLeanDevice();
  }

  mount(host) {
    if (this.game) return;
    this.host = host;
    this.lean = isLeanDevice();
    const w = host.clientWidth || 900;
    const h = host.clientHeight || 380;

    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: host,
      width: w,
      height: h,
      backgroundColor: '#0b1210',
      scene: [BattleScene],
      banner: false,
      audio: { noAudio: true },
      fps: {
        target: this.lean ? 30 : 60,
        smoothStep: true,
      },
      render: {
        antialias: !this.lean,
        roundPixels: true,
        powerPreference: this.lean ? 'low-power' : 'high-performance',
        pixelArt: false,
        transparent: false,
      },
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        autoRound: true,
        zoom: 1,
      },
    });
    this.game.scene.start('Battle');
    this.scene = this.game.scene.getScene('Battle');
    if (this.scene) {
      this.scene.bridge = this;
      this.scene.lean = this.lean;
    }

    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this.scheduleResize());
      this._ro.observe(host);
    }
    requestAnimationFrame(() => {
      this.resize();
      requestAnimationFrame(() => this.flush());
    });
  }

  scheduleResize() {
    if (this._resizeTimer) cancelAnimationFrame(this._resizeTimer);
    this._resizeTimer = requestAnimationFrame(() => {
      this._resizeTimer = null;
      this.resize();
    });
  }

  resize() {
    if (!this.game || !this.host) return;
    const w = Math.round(this.host.clientWidth);
    const h = Math.round(this.host.clientHeight);
    if (w < 2 || h < 2) return;
    // Match buffer size to CSS box 1:1 — avoids tall/squashed sprites on mobile
    this.game.scale.resize(w, h);
    const canvas = this.game.canvas;
    if (canvas) {
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
  }

  onSceneReady() {
    this.flush();
  }

  flush() {
    if (!this.scene) this.scene = this.game?.scene?.getScene('Battle') || null;
    const state = this._pending;
    if (state != null) this.scene?.sync(state);
  }

  sync(state) {
    this._pending = state;
    if (!this.scene) this.scene = this.game?.scene?.getScene('Battle') || null;
    this.resize();
    this.scene?.sync(state);
  }

  getDirector() {
    if (!this.scene) this.scene = this.game?.scene?.getScene('Battle') || null;
    return this.scene?.director || null;
  }

  holdBossSpawn(on) {
    this.scene?.holdBossSpawn?.(on);
  }

  // Legacy sync hooks
  fxAttack(byIndex) {
    return this.getDirector()?.playerLunge(byIndex);
  }
  fxBossStrike() {
    return this.getDirector()?.bossAttack();
  }
  fxBlock(byIndex, amount) {
    return this.getDirector()?.playerBlock(byIndex, amount);
  }
  fxClearBlock(byIndex) {
    return this.getDirector()?.playerClearBlock(byIndex);
  }
  fxDefeat() {
    return this.getDirector()?.bossDie();
  }
  fxPlayerDie(byIndex) {
    return this.getDirector()?.playerDie(byIndex);
  }
  fxPlayerHit(byIndex) {
    return this.getDirector()?.playerHit(byIndex);
  }
  fxDarken(on) {
    return this.getDirector()?.darkenBattlefield(on);
  }
  fxSpawnBoss(enemy, hp, max, atk, shield, immune) {
    return this.getDirector()?.spawnBoss(enemy, hp, max, atk, shield, immune);
  }

  destroy() {
    this._ro?.disconnect();
    this._ro = null;
    if (this._resizeTimer) cancelAnimationFrame(this._resizeTimer);
    this._resizeTimer = null;
    this.game?.destroy(true);
    this.game = null;
    this.scene = null;
    this._pending = null;
  }
}

window.RegicideBattle = new PhaserBridge();
