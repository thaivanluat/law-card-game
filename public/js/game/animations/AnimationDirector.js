import { registry } from '../assets/AssetRegistry.js';

/**
 * Single place for sequential Phaser combat presentation.
 * Never computes rules — only plays visuals against the scene actors.
 */
export class AnimationDirector {
  /** @param {import('../BattleScene.js').BattleScene} scene */
  constructor(scene) {
    this.scene = scene;
    this._cancelled = false;
  }

  cancel() {
    this._cancelled = true;
  }

  resetCancel() {
    this._cancelled = false;
  }

  _sleep(ms) {
    return new Promise((resolve) => this.scene.time.delayedCall(ms, resolve));
  }

  _alive() {
    return !this._cancelled && this.scene && this.scene.sys?.isActive();
  }

  /**
   * Play a one-shot FX spritesheet at world position.
   * @param {'slash'|'hit'|'block'} kind
   */
  playFx(kind, x, y, scale = 1) {
    if (!this._alive()) return Promise.resolve();
    const tex = `fx:${kind}`;
    const anim = `anim:fx:${kind}`;
    if (!this.scene.textures.exists(tex)) return Promise.resolve();
    return new Promise((resolve) => {
      const spr = this.scene.add.sprite(x, y, tex, 0).setDepth(40).setScale(scale);
      spr.setOrigin(0.5, 0.5);
      const finish = () => {
        spr.destroy();
        resolve();
      };
      if (this.scene.anims.exists(anim)) {
        spr.once(Phaser.Animations.Events.ANIMATION_COMPLETE, finish);
        spr.play(anim);
      } else {
        this.scene.time.delayedCall(280, finish);
      }
    });
  }

  async playerLunge(byIndex) {
    if (!this._alive()) return;
    const k = this.scene.knights[byIndex];
    if (!k) return;
    k.stopIdle();
    k._busy = true;
    await new Promise((resolve) => {
      const base = k.root.x;
      this.scene.tweens.add({
        targets: k.root,
        x: base + 44,
        duration: 140,
        yoyo: true,
        ease: 'Quad.easeOut',
        onComplete: resolve,
      });
    });
    const bx = this.scene.boss?.root.x ?? k.root.x + 120;
    const by = this.scene.boss?.root.y - (this.scene.boss?.sprite?.displayHeight || 180) * 0.45;
    await this.playFx('slash', (k.root.x + bx) / 2, by || k.root.y - 80, 1.1);
    k._busy = false;
    k.startIdle();
  }

  async bossHit(hpAfter, hpMax) {
    if (!this._alive()) return;
    const boss = this.scene.boss;
    if (!boss?.enemy) return;
    const jobs = [
      boss.playHitAsync?.() || this._legacyHit(boss),
      this.playFx('hit', boss.root.x, boss.root.y - (boss.sprite?.displayHeight || 200) * 0.5, 1.15),
    ];
    if (hpAfter != null && hpMax != null) jobs.push(boss.animateHpTo?.(hpAfter, hpMax));
    await Promise.all(jobs);
  }

  /** Pulse attack intent (BOSS_ATTACK_PREPARE). */
  async bossAttackPrepare() {
    if (!this._alive()) return;
    this.scene.boss?.pulseIntent?.();
    await this._sleep(160);
  }

  /** Update intent number after Spades (SPADES_APPLIED). */
  applySpadesIntent(atk, shield) {
    if (!this._alive()) return;
    this.scene.boss?._applyIntent?.(atk, shield);
  }

  /** Remove immunity icon after Jester (JESTER_PLAYED). */
  async jesterClearsImmunity() {
    if (!this._alive()) return;
    this.scene.boss?.clearImmunity?.();
    await this._sleep(280);
  }

  _legacyHit(boss) {
    return new Promise((resolve) => {
      boss.playHit();
      this.scene.time.delayedCall(400, resolve);
    });
  }

  /** Full die strip — waits until complete before resolving. */
  async bossDie() {
    if (!this._alive()) return;
    const boss = this.scene.boss;
    if (!boss) return;
    await boss.playDieAsync();
  }

  /**
   * Spawn / swap to a new royal only AFTER previous death finished.
   * Resets transform state; never reuses previous texture keys.
   */
  async spawnBoss(enemy, hp, max, atk, shield, immune) {
    if (!this._alive()) return;
    const scene = this.scene;
    const { width } = scene.scale;
    const x = width * 0.72;
    const y = scene.floorY;
    const { bossH } = scene._actorHeights?.() || {
      bossH: Math.min(scene.scale.height * 0.7, width * 0.5, 560),
    };
    scene.boss.reviveAt(x, y);
    scene.boss.resetVisual();
    scene.boss.sync(enemy, hp, max, atk, shield, immune, true);
    scene.boss._fitHeight(bossH);
    scene.boss._layoutHud?.();
    scene.boss.setCombatHudVisible(true);
    scene.boss.root.setAlpha(0);
    scene.boss.root.setScale(0.85);
    await new Promise((resolve) => {
      scene.tweens.add({
        targets: scene.boss.root,
        alpha: 1,
        scale: 1,
        duration: 420,
        ease: 'Back.easeOut',
        onComplete: resolve,
      });
    });
    scene.boss.startIdle();
  }

  async bossAttack() {
    if (!this._alive()) return;
    const boss = this.scene.boss;
    if (!boss) return;
    await this.bossAttackPrepare();
    await boss.playAttackAsync?.() || new Promise((r) => {
      boss.playAttack();
      this.scene.time.delayedCall(450, r);
    });
  }

  async playerBlock(byIndex, amount) {
    if (!this._alive()) return;
    const k = this.scene.knights[byIndex];
    if (!k) return;
    k.gainBlock(amount);
    await this.playFx('block', k.root.x + 10, k.root.y - (k.sprite?.displayHeight || 160) * 0.45, 0.95);
    await this._sleep(200);
  }

  async playerClearBlock(byIndex) {
    if (!this._alive()) return;
    this.scene.knights[byIndex]?.clearBlock();
    await this._sleep(280);
  }

  async playerHit(byIndex) {
    if (!this._alive()) return;
    const k = this.scene.knights[byIndex];
    if (!k) return;
    k.stopIdle();
    k._busy = true;
    k.setPose(registry.heroKey(k.role, 'hit'));
    k.hitFlash();
    await this.playFx('hit', k.root.x, k.root.y - (k.sprite?.displayHeight || 160) * 0.5, 1);
    await this._sleep(320);
    k.setHp(0);
    k._busy = false;
  }

  async playerDie(byIndex) {
    if (!this._alive()) return;
    const k = this.scene.knights[byIndex];
    if (!k) return;
    await k.playDieAsync();
  }

  darkenBattlefield(on = true) {
    if (!this.scene._veil) {
      const { width, height } = this.scene.scale;
      this.scene._veil = this.scene.add
        .rectangle(width / 2, height / 2, width * 2, height * 2, 0x000000, 0)
        .setDepth(50)
        .setScrollFactor(0);
    }
    return new Promise((resolve) => {
      this.scene.tweens.add({
        targets: this.scene._veil,
        alpha: on ? 0.72 : 0,
        duration: 500,
        onComplete: resolve,
      });
    });
  }
}
