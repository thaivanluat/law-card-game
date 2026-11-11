import { Actor } from './Actor.js';
import { registry } from '../assets/AssetRegistry.js';

const SUIT_CH = { H: '♥', D: '♦', C: '♣', S: '♠' };
const SUIT_NAME = { H: 'Hearts', D: 'Diamonds', C: 'Clubs', S: 'Spades' };
const IMMUNITY_TIP = {
  S: {
    title: 'Spades Immunity',
    body: 'This royal ignores the Spades suit power. Spades cannot reduce its attack while immunity is active.',
  },
  H: {
    title: 'Hearts Immunity',
    body: 'This royal ignores the Hearts suit power. Hearts cannot restore cards from the Discard to the Tavern while immunity is active.',
  },
  D: {
    title: 'Diamonds Immunity',
    body: 'This royal ignores the Diamonds suit power. Diamonds cannot draw cards from the Tavern while immunity is active.',
  },
  C: {
    title: 'Clubs Immunity',
    body: 'This royal ignores the Clubs suit power. Clubs cannot deal double damage while immunity is active.',
  },
};

/**
 * Living royal + STS-style combat HUD:
 *   intent (sword) above → sprite → HP bar below → suit immunity buff
 */
export class BossActor extends Actor {
  constructor(scene, x, y) {
    const fallback = registry.fallbackBossIdle();
    super(scene, x, y, fallback, {
      depth: 20,
      originY: 1,
      // Art faces right; boss stands on the right, so flip to face the heroes.
      flipX: true,
      targetH: Math.min(scene.scale.height * 0.45, scene.scale.width * 0.4, 420),
    });
    this.enemy = null;
    this._defeatTween = null;
    this._baseY = y;
    this._hpShown = 0;
    this._hpMax = 1;
    this._atkBase = 0;
    this._shield = 0;
    this._immune = true;
    this._hpTween = null;
    this._tipOpen = false;

    this.hud = scene.add.container(0, 0);
    this.root.add(this.hud);

    this._buildIntent();
    this._buildHpBar();
    this._buildImmunity();
    this._buildTooltip();

    this.hud.add([this.intent, this.hpBar, this.immRoot]);
    this._layoutHud();
    this.setCombatHudVisible(false);
  }

  _buildIntent() {
    const scene = this.scene;
    this.intent = scene.add.container(0, 0);

    // Compact STS intent badge (bg keeps the number readable even if sword sheet is hard to see)
    this.intentBg = scene.add.rectangle(0, 0, 64, 72, 0x1a0808, 0.88).setStrokeStyle(2, 0xc8372f);

    if (scene.textures.exists('hud:sword')) {
      this.intentSword = scene.add.sprite(0, -12, 'hud:sword', 0).setOrigin(0.5);
      // Tall sheet cell — show as compact STS intent icon
      this.intentSword.setDisplaySize(42, 56);
      if (scene.anims.exists('anim:hud:sword')) this.intentSword.play('anim:hud:sword');
    } else {
      this.intentSword = scene.add
        .text(0, -12, '⚔', { fontSize: '26px', color: '#ff6b60' })
        .setOrigin(0.5);
    }

    this.intentDmg = scene.add
      .text(0, 24, '—', {
        fontFamily: 'Georgia, serif',
        fontSize: '24px',
        color: '#ffd0c8',
        fontStyle: 'bold',
        stroke: '#1a0505',
        strokeThickness: 6,
      })
      .setOrigin(0.5);

    this.intentShieldNote = scene.add
      .text(0, 42, '', {
        fontFamily: 'Arial',
        fontSize: '11px',
        color: '#9ec8ff',
        stroke: '#000',
        strokeThickness: 3,
      })
      .setOrigin(0.5);

    this.intent.add([this.intentBg, this.intentSword, this.intentDmg, this.intentShieldNote]);
    this.intent.setDepth(30);
  }

  /**
   * Compact fantasy HP bar via Graphics (sheet is visual reference —
   * full 543×724 cells distort if stretched as the bar).
   */
  _buildHpBar() {
    const scene = this.scene;
    this.hpBar = scene.add.container(0, 0);
    this._hpW = 168;
    this._hpH = 16;

    this.hpTrack = scene.add.graphics();
    this.hpFillG = scene.add.graphics();
    this._drawHpTrack();
    this._drawHpFill(1);

    this.hpText = scene.add
      .text(0, 0, '', {
        fontFamily: 'Arial',
        fontSize: '12px',
        color: '#fff8f0',
        fontStyle: 'bold',
        stroke: '#1a0808',
        strokeThickness: 3,
      })
      .setOrigin(0.5);

    // Optional crest gem from ornate sheet (frame 0) as tiny ornament — not the bar itself
    if (scene.textures.exists('hud:health')) {
      this.hpGem = scene.add.sprite(0, -14, 'hud:health', 0).setOrigin(0.5, 1).setAlpha(0.95);
      this.hpGem.setDisplaySize(28, 22);
      this.hpBar.add([this.hpTrack, this.hpFillG, this.hpGem, this.hpText]);
    } else {
      this.hpGem = null;
      this.hpBar.add([this.hpTrack, this.hpFillG, this.hpText]);
    }
  }

  _drawHpTrack() {
    const g = this.hpTrack;
    const w = this._hpW;
    const h = this._hpH;
    g.clear();
    g.fillStyle(0x140a0a, 0.92);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 3);
    g.lineStyle(2, 0x8a6a28, 1);
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, 3);
    g.lineStyle(1, 0xd4b45a, 0.55);
    g.strokeRoundedRect(-w / 2 + 1, -h / 2 + 1, w - 2, h - 2, 2);
  }

  _drawHpFill(pct) {
    const g = this.hpFillG;
    const w = this._hpW - 6;
    const h = this._hpH - 6;
    const fillW = Math.max(0, w * Math.max(0, Math.min(1, pct)));
    g.clear();
    if (fillW <= 0.5) return;
    const color = pct > 0.35 ? 0xc8372f : 0xff6b60;
    g.fillStyle(color, 1);
    g.fillRoundedRect(-w / 2, -h / 2, fillW, h, 2);
    g.fillStyle(0xffb0a0, 0.28);
    g.fillRoundedRect(-w / 2, -h / 2, fillW, Math.max(2, h * 0.35), 2);
  }

  _buildImmunity() {
    const scene = this.scene;
    this.immRoot = scene.add.container(0, 0);

    if (scene.textures.exists('hud:immunity')) {
      this.immIcon = scene.add.sprite(0, 0, 'hud:immunity', 0).setOrigin(0.5);
      this.immIcon.setDisplaySize(40, 52);
      this.immIcon.setInteractive({ useHandCursor: true });
      this.immIcon.on('pointerover', () => this._showTip(true));
      this.immIcon.on('pointerout', () => this._showTip(false));
      this.immIcon.on('pointerdown', () => this._toggleTip());
    } else {
      this.immIcon = scene.add
        .text(0, 0, '♠', {
          fontSize: '22px',
          color: '#ffe5ae',
          stroke: '#000',
          strokeThickness: 4,
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      this.immIcon.on('pointerover', () => this._showTip(true));
      this.immIcon.on('pointerout', () => this._showTip(false));
      this.immIcon.on('pointerdown', () => this._toggleTip());
    }

    this.immRoot.add(this.immIcon);
    this.immRoot.setVisible(false);
  }

  _buildTooltip() {
    const scene = this.scene;
    this.tipBg = scene.add.rectangle(0, 0, 220, 78, 0x0c1210, 0.94).setStrokeStyle(1, 0xe6c27a88);
    this.tipTitle = scene.add
      .text(0, -24, '', {
        fontFamily: 'Georgia, serif',
        fontSize: '13px',
        color: '#ffe29a',
        fontStyle: 'bold',
        wordWrap: { width: 200 },
      })
      .setOrigin(0.5, 0);
    this.tipBody = scene.add
      .text(0, -6, '', {
        fontFamily: 'Arial',
        fontSize: '11px',
        color: '#cfe3d6',
        wordWrap: { width: 200 },
        lineSpacing: 2,
      })
      .setOrigin(0.5, 0);
    this.tip = scene.add.container(0, 0, [this.tipBg, this.tipTitle, this.tipBody]);
    this.tip.setVisible(false);
    this.tip.setDepth(60);
    // World-space tip attached to scene (not flipped with boss)
    scene.add.existing(this.tip);
  }

  _tipContent() {
    const suit = this.enemy?.suit;
    return IMMUNITY_TIP[suit] || { title: 'Immunity', body: 'This royal ignores its suit power.' };
  }

  _showTip(on) {
    if (!this._immune || !this.immRoot.visible) {
      this.tip.setVisible(false);
      this._tipOpen = false;
      return;
    }
    this._tipOpen = !!on;
    if (!on) {
      this.tip.setVisible(false);
      return;
    }
    const c = this._tipContent();
    this.tipTitle.setText(c.title);
    this.tipBody.setText(c.body);
    const world = this.root.getWorldTransformMatrix();
    const wx = world.tx;
    const wy = world.ty + this.immRoot.y - 56;
    this.tip.setPosition(wx, wy);
    this.tip.setVisible(true);
  }

  _toggleTip() {
    this._showTip(!this._tipOpen);
  }

  _layoutHud() {
    const h = this.sprite?.displayHeight || 220;
    const w = this.sprite?.displayWidth || 160;
    // Keep ⚔ + damage fully on-screen (was clipped above the canvas)
    const intentHalf = 40;
    const topSafe = 52;
    const rootY = this.root?.y || this._baseY || 300;
    const minLocalY = -rootY + topSafe + intentHalf;
    const preferY = -h - 44;
    this.intent.y = Math.max(preferY, minLocalY);
    // If clamped down onto the body, park badge left of the torso (STS-style)
    if (this.intent.y > -h * 0.72) {
      this.intent.x = -Math.max(72, w * 0.42);
      this.intent.y = Math.min(-h * 0.55, minLocalY + 8);
    } else {
      this.intent.x = -Math.min(56, w * 0.28);
    }
    // HP + immunity BELOW the character (feet at y=0)
    this.hpBar.y = 18;
    this.immRoot.y = 48;
  }

  setCombatHudVisible(on) {
    this.hud.setVisible(!!on);
    if (!on) {
      this.tip.setVisible(false);
      this._tipOpen = false;
    }
  }

  _stopDefeatTween() {
    if (this._defeatTween) {
      this._defeatTween.stop();
      this._defeatTween = null;
    }
  }

  reviveAt(x, y) {
    this._stopDefeatTween();
    this._busy = false;
    this._baseY = y;
    this.root.setAlpha(1);
    this.root.setVisible(true);
    this.root.setScale(1);
    this.setPosition(x, y);
    this.setCombatHudVisible(true);
  }

  /**
   * @param {{id:string,rank:string,suit:string}} enemy
   * @param {boolean} [force] force texture swap even if same id
   */
  sync(enemy, hp, max, atk, shield, immune, force = false) {
    const changed = force || !this.enemy || this.enemy.id !== enemy.id;
    this.enemy = enemy;
    this._hpMax = Math.max(1, max | 0);
    this._atkBase = atk | 0;
    this._shield = shield | 0;
    this._immune = !!immune;

    if (changed) {
      this._stopDefeatTween();
      if (this._hpTween) {
        this._hpTween.stop();
        this._hpTween = null;
      }
      this.resetVisual();
      this.root.setVisible(true);
      this.root.y = this._baseY || this.root.y;
      const idle = registry.bossKey(enemy, 'idle');
      const key = this.scene.textures.exists(idle) ? idle : registry.fallbackBossIdle();
      this.setPose(key);
      this._layoutHud();
      this.startIdle();
      this._hpShown = Math.max(0, hp);
      this._applyHpDisplay(this._hpShown, this._hpMax, false);
      this.setCombatHudVisible(true);
    }

    this._applyIntent(atk, shield);
    this._applyImmunity(immune, enemy.suit);

    if (changed) {
      this._applyHpDisplay(hp, max, false);
    } else if (!this._busy && !this._hpTween) {
      // Snap while idle — damage tweens are owned by AnimationDirector (BOSS_DAMAGED)
      this._applyHpDisplay(hp, max, false);
    }
  }

  _applyIntent(atk, shield) {
    const now = Math.max(0, (atk | 0) - (shield | 0));
    this.intentDmg.setText(String(now));
    if (shield > 0) {
      this.intentShieldNote.setText(`${atk} − ${shield}`);
      this.intentDmg.setColor('#cfe8ff');
    } else {
      this.intentShieldNote.setText('');
      this.intentDmg.setColor('#ffd0c8');
    }
    this.intent.setVisible(true);
  }

  _applyImmunity(immune, suit) {
    if (!immune) {
      this.immRoot.setVisible(false);
      this.tip.setVisible(false);
      this._tipOpen = false;
      return;
    }
    this.immRoot.setVisible(true);
    this.immRoot.setAlpha(1);
    if (this.immIcon?.setFrame && this.scene.textures.exists('hud:immunity')) {
      this.immIcon.setFrame(registry.immunityFrame(suit));
    } else if (this.immIcon?.setText) {
      this.immIcon.setText(SUIT_CH[suit] || '?');
    }
  }

  /** Clear suit immunity (Jester) with a short cancel tween. */
  clearImmunity() {
    this._immune = false;
    if (!this.immRoot.visible) return;
    this.tip.setVisible(false);
    this._tipOpen = false;
    this.scene.tweens.add({
      targets: this.immRoot,
      alpha: 0,
      scale: 0.4,
      duration: 280,
      ease: 'Quad.easeIn',
      onComplete: () => {
        this.immRoot.setVisible(false);
        this.immRoot.setScale(1);
        this.immRoot.setAlpha(1);
      },
    });
  }

  _applyHpDisplay(hp, max, fromTween) {
    const pct = Math.max(0, Math.min(1, hp / Math.max(1, max)));
    this._drawHpFill(pct);
    this.hpText.setText(`${Math.max(0, Math.round(hp))}/${max}`);
    if (!fromTween) this._hpShown = hp;
  }

  setHpDisplay(hp, max) {
    this._applyHpDisplay(hp, max, false);
  }

  /** Smooth HP reduction for BOSS_DAMAGED presentation. */
  animateHpTo(hp, max) {
    const target = Math.max(0, hp);
    const m = Math.max(1, max | 0);
    this._hpMax = m;
    if (this._hpTween) {
      this._hpTween.stop();
      this._hpTween = null;
    }
    const from = this._hpShown;
    if (Math.abs(from - target) < 0.05) {
      this._applyHpDisplay(target, m, false);
      return Promise.resolve();
    }
    const state = { v: from };
    return new Promise((resolve) => {
      this._hpTween = this.scene.tweens.add({
        targets: state,
        v: target,
        duration: 420,
        ease: 'Quad.easeOut',
        onUpdate: () => this._applyHpDisplay(state.v, m, true),
        onComplete: () => {
          this._hpShown = target;
          this._applyHpDisplay(target, m, false);
          this._hpTween = null;
          resolve();
        },
      });
    });
  }

  /** Pulse sword before the royal strikes. */
  pulseIntent() {
    if (!this.intent.visible) return;
    this.scene.tweens.add({
      targets: this.intent,
      scale: { from: 1, to: 1.14 },
      duration: 180,
      yoyo: true,
      ease: 'Sine.easeInOut',
    });
  }

  playAttack() {
    this.playAttackAsync();
  }

  playAttackAsync() {
    if (!this.enemy) return Promise.resolve();
    this._busy = true;
    this.stopIdle();
    this.pulseIntent();
    const atk = registry.bossKey(this.enemy, 'attack');
    this.setPose(this.scene.textures.exists(atk) ? atk : registry.bossKey(this.enemy, 'idle'));
    this.attackLunge(-1);
    return new Promise((resolve) => {
      this.scene.time.delayedCall(420, () => {
        if (this.enemy) this.setPose(registry.bossKey(this.enemy, 'idle'));
        this._busy = false;
        this.startIdle();
        resolve();
      });
    });
  }

  playHit() {
    this.playHitAsync();
  }

  playHitAsync() {
    if (!this.enemy) return Promise.resolve();
    this._busy = true;
    this.stopIdle();
    const hit = registry.bossKey(this.enemy, 'hit');
    this.setPose(this.scene.textures.exists(hit) ? hit : registry.bossKey(this.enemy, 'idle'));
    this.hitFlash();
    return new Promise((resolve) => {
      this.scene.time.delayedCall(380, () => {
        if (this.enemy) this.setPose(registry.bossKey(this.enemy, 'idle'));
        this._busy = false;
        this.startIdle();
        resolve();
      });
    });
  }

  /** Full 7-frame die strip; hides sprite when finished. */
  playDieAsync() {
    if (!this.enemy) return Promise.resolve();
    this._busy = true;
    this.stopIdle();
    this.setCombatHudVisible(false);
    const anim = registry.bossAnim(this.enemy, 'die');
    const hit = registry.bossKey(this.enemy, 'hit');
    return this.playAnimAsync(anim, hit).then(() => {
      this.root.setVisible(false);
      this.root.setAlpha(0);
      this._busy = false;
    });
  }

  /** Legacy fade used only if die sheet missing mid-flow. */
  defeat() {
    this.playDieAsync();
  }

  destroy() {
    this.tip?.destroy?.(true);
    this.tip = null;
    super.destroy();
  }
}
