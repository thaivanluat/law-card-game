/**
 * Base battlefield actor — Sprite (poses + die sheets), idle breathe tween.
 */
export class Actor {
  /**
   * @param {Phaser.Scene} scene
   * @param {number} x
   * @param {number} y
   * @param {string} textureKey
   * @param {{scale?:number, flipX?:boolean, depth?:number, originY?:number, targetH?:number}} [opts]
   */
  constructor(scene, x, y, textureKey, opts = {}) {
    this.scene = scene;
    this.root = scene.add.container(x, y).setDepth(opts.depth ?? 10);
    let key = textureKey;
    if (!scene.textures.exists(key)) {
      const keys =
        typeof scene.textures.getTextureKeys === 'function'
          ? scene.textures.getTextureKeys()
          : Object.keys(scene.textures.list || {});
      key = keys.find((k) => k !== '__DEFAULT' && k !== '__MISSING') || textureKey;
    }
    // Sprite supports both static poses and spritesheet anims
    this.sprite = scene.add.sprite(0, 0, key);
    this.sprite.setOrigin(0.5, opts.originY ?? 1);
    this.shadow = scene.add.ellipse(0, 6, 70, 16, 0x000000, 0.35);
    this.root.add([this.shadow, this.sprite]);
    this._baseScale = 1;
    this._targetH = opts.targetH || 220;
    this._fitHeight(this._targetH);
    if (opts.flipX) this.sprite.setFlipX(true);
    this._idle = null;
    this._busy = false;
    this.startIdle();
  }

  _fitHeight(h) {
    if (!this.sprite) return;
    this._targetH = h;
    const th = Math.max(1, this.sprite.height || 256);
    this._baseScale = h / th;
    this.sprite.setScale(this._baseScale);
    if (this.shadow) {
      this.shadow.setScale(Math.max(0.6, this.sprite.displayWidth / 90), 1);
    }
  }

  startIdle() {
    this.stopIdle();
    if (this._busy) return;
    // Breathe with Y only — scaleY-only tweens make sprites look "tall" on mobile
    this._idle = this.scene.tweens.add({
      targets: this.sprite,
      y: '-=5',
      duration: 1000 + Math.random() * 400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  stopIdle() {
    if (this._idle) {
      this._idle.stop();
      this._idle = null;
    }
    if (!this.sprite) return;
    this.sprite.y = 0;
    this.sprite.setScale(this._baseScale);
  }

  setPose(key) {
    if (!key || !this.scene.textures.exists(key) || !this.sprite) return;
    if (this.sprite.anims?.isPlaying) this.sprite.anims.stop();
    this.sprite.setTexture(key);
    this._fitHeight(this._targetH || this.sprite.displayHeight || 220);
  }

  setPosition(x, y) {
    this.root.setPosition(x, y);
  }

  setActiveDim(active) {
    this.root.setAlpha(active ? 1 : 0.55);
  }

  resetVisual() {
    this.stopIdle();
    if (this.sprite?.anims?.isPlaying) this.sprite.anims.stop();
    this.root.setAlpha(1);
    this.root.setScale(1);
    this.root.setRotation(0);
    this.sprite.setAlpha(1);
    this.sprite.setTint(0xffffff);
    this.sprite.setAngle(0);
    this.sprite.y = 0;
    this._busy = false;
  }

  hitFlash() {
    this.scene.tweens.add({
      targets: this.sprite,
      alpha: 0.35,
      duration: 55,
      yoyo: true,
      repeat: 3,
    });
    this.scene.tweens.add({
      targets: this.root,
      x: this.root.x + 12,
      duration: 45,
      yoyo: true,
      repeat: 3,
    });
  }

  attackLunge(dir = 1) {
    const base = this.root.x;
    this.scene.tweens.add({
      targets: this.root,
      x: base + dir * 40,
      duration: 160,
      yoyo: true,
      ease: 'Quad.easeOut',
    });
  }

  /**
   * Play a one-shot spritesheet anim on this actor; resolve when done.
   * @param {string} animKey
   * @param {string} [fallbackPose]
   */
  playAnimAsync(animKey, fallbackPose) {
    return new Promise((resolve) => {
      this.stopIdle();
      this._busy = true;
      if (!this.scene.anims.exists(animKey) || !this.sprite) {
        if (fallbackPose) this.setPose(fallbackPose);
        this.scene.time.delayedCall(500, () => {
          this._busy = false;
          resolve();
        });
        return;
      }
      const finish = () => {
        this.sprite.off(Phaser.Animations.Events.ANIMATION_COMPLETE, finish);
        this._busy = false;
        resolve();
      };
      this.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, finish);
      this.sprite.play(animKey);
      // Keep feet-aligned scale for sheet frames
      this._fitHeight(this._targetH);
    });
  }

  destroy() {
    this.stopIdle();
    if (this.sprite?.anims?.isPlaying) this.sprite.anims.stop();
    this.root.destroy(true);
  }
}
