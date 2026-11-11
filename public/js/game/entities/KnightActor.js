import { Actor } from './Actor.js';
import { registry, PLAYER_ROLES } from '../assets/AssetRegistry.js';

/** Cosmetic hero — idle / block / hit / die + STS block badge + 1 HP. */
export class KnightActor extends Actor {
  /**
   * @param {Phaser.Scene} scene
   * @param {number} x
   * @param {number} y
   * @param {string} role
   * @param {string} name
   * @param {boolean} isYou
   */
  constructor(scene, x, y, role, name, isYou) {
    const safe = PLAYER_ROLES.includes(role) ? role : 'warrior';
    const key = scene.textures.exists(registry.heroKey(safe, 'idle'))
      ? registry.heroKey(safe, 'idle')
      : registry.fallbackHeroIdle();
    super(scene, x, y, key, {
      depth: 15,
      originY: 1,
      targetH: Math.min(scene.scale.height * 0.58, scene.scale.width * 0.38, 400),
    });
    this.role = safe;
    this.isYou = isYou;
    this._blockAmt = 0;
    this.hp = 1;

    this.nameTag = scene.add
      .text(0, 8, name, {
        fontFamily: 'Georgia, serif',
        fontSize: '13px',
        color: isYou ? '#ffe29a' : '#d6e0d8',
        stroke: '#000',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 0);

    this.roleTag = scene.add
      .text(0, 24, this.role, {
        fontFamily: 'Arial',
        fontSize: '10px',
        color: '#9fb3a8',
        stroke: '#000',
        strokeThickness: 2,
      })
      .setOrigin(0.5, 0);

    this.countTag = scene.add
      .text(0, 38, '', {
        fontFamily: 'Arial',
        fontSize: '11px',
        color: '#cfe3d6',
        stroke: '#000',
        strokeThickness: 2,
      })
      .setOrigin(0.5, 0);

    // No player HP in Regicide — defense is the temporary blockBadge during discard-defend
    this.hpTag = scene.add
      .text(0, -8, '', {
        fontFamily: 'Arial',
        fontSize: '11px',
        color: '#cfe3d6',
        fontStyle: 'bold',
        stroke: '#000',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setVisible(false);

    this.turnRing = scene.add.ellipse(0, -6, 78, 16, 0xe6c27a, 0).setStrokeStyle(2, 0xe6c27a, 0);

    this.blockBadge = scene.add.container(42, -40);
    this.blockBg = scene.add.circle(0, 0, 18, 0x3d6ea8, 0.95).setStrokeStyle(2, 0xb8dcff);
    this.blockIcon = scene.add.text(-1, -7, '🛡', { fontSize: '12px' }).setOrigin(0.5);
    this.blockNum = scene.add
      .text(0, 7, '0', {
        fontFamily: 'Arial',
        fontSize: '13px',
        color: '#e8f4ff',
        fontStyle: 'bold',
        stroke: '#0a2030',
        strokeThickness: 3,
      })
      .setOrigin(0.5);
    this.blockBadge.add([this.blockBg, this.blockIcon, this.blockNum]);
    this.blockBadge.setVisible(false);

    this.root.add([this.turnRing, this.hpTag, this.nameTag, this.roleTag, this.countTag, this.blockBadge]);
    this._layoutTags();
  }

  _layoutTags() {
    const top = -(this.sprite?.displayHeight || 160) - 4;
    this.hpTag.y = top;
    this.blockBadge.y = top + 8;
  }

  setRole(role) {
    if (!PLAYER_ROLES.includes(role) || role === this.role) return;
    this.role = role;
    this.roleTag.setText(role);
    this.setPose(registry.heroKey(role, this._blockAmt > 0 ? 'block' : 'idle'));
  }

  setMeta(name, handCount, isYou) {
    this.isYou = isYou;
    this.nameTag.setText(name + (isYou ? ' (You)' : ''));
    this.nameTag.setColor(isYou ? '#ffe29a' : '#d6e0d8');
    this.countTag.setText(`${handCount} cards`);
  }

  setHp(n) {
    this.hp = Math.max(0, n | 0);
  }

  setActiveTurn(on) {
    this.setActiveDim(on || this.isYou);
    this.turnRing.setFillStyle(0xe6c27a, on ? 0.25 : 0);
    this.turnRing.setStrokeStyle(2, 0xe6c27a, on ? 0.95 : 0);
    if (on) {
      this.scene.tweens.add({ targets: this.root, scale: 1.04, duration: 160, yoyo: true });
    }
  }

  gainBlock(amount) {
    this._blockAmt = Math.max(0, amount | 0);
    this._busy = true;
    this.stopIdle();
    const block = registry.heroKey(this.role, 'block');
    this.setPose(this.scene.textures.exists(block) ? block : registry.heroKey(this.role, 'idle'));
    this._layoutTags();
    this.blockNum.setText(String(this._blockAmt));
    this.blockBadge.setVisible(this._blockAmt > 0);
    this.blockBadge.setAlpha(1);
    this.scene.tweens.add({
      targets: this.blockBadge,
      scale: { from: 0.6, to: 1 },
      duration: 220,
      ease: 'Back.easeOut',
    });
  }

  clearBlock() {
    this._blockAmt = 0;
    this.scene.tweens.add({
      targets: this.blockBadge,
      alpha: 0,
      scale: 0.4,
      y: this.blockBadge.y - 28,
      duration: 380,
      ease: 'Quad.easeIn',
      onComplete: () => {
        this.blockBadge.setVisible(false);
        this.blockBadge.setScale(1);
        this.blockBadge.setAlpha(1);
        this._layoutTags();
      },
    });
    this.setPose(registry.heroKey(this.role, 'idle'));
    this._busy = false;
    this.startIdle();
  }

  playBlock(absorbed) {
    this.gainBlock(absorbed);
  }

  playDieAsync() {
    this.setHp(0);
    this.blockBadge.setVisible(false);
    this._busy = true;
    this.stopIdle();
    const anim = registry.heroAnim(this.role, 'die');
    const hit = registry.heroKey(this.role, 'hit');
    return this.playAnimAsync(anim, this.scene.textures.exists(hit) ? hit : registry.heroKey(this.role, 'idle')).then(
      () => {
        this.root.setAlpha(0.35);
        this._busy = false;
      }
    );
  }
}
