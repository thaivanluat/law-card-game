/**
 * Async queue that turns authoritative combat events into AnimationDirector calls.
 * Does not compute damage / victory / turns — only presentation order.
 */
export class CombatOrchestrator {
  /**
   * @param {() => import('./AnimationDirector.js').AnimationDirector | null} getDirector
   * @param {object} hooks DOM helpers from app.js
   */
  constructor(getDirector, hooks = {}) {
    this.getDirector = getDirector;
    this.hooks = hooks;
    this.queue = [];
    this.playing = false;
    this.seen = new Set();
  }

  /** Deduped enqueue (polling-safe). */
  push(ev) {
    if (!ev || ev.seq == null) {
      this.queue.push(ev);
    } else if (this.seen.has(ev.seq)) {
      return;
    } else {
      this.seen.add(ev.seq);
      this.queue.push(ev);
    }
    this.pump();
  }

  clear() {
    this.queue = [];
    this.getDirector()?.cancel?.();
  }

  async pump() {
    if (this.playing) return;
    this.playing = true;
    const dir = () => this.getDirector();
    while (this.queue.length) {
      const ev = this.queue.shift();
      dir()?.resetCancel?.();
      try {
        await this.play(ev);
      } catch (e) {
        console.error('[CombatOrchestrator]', e);
      }
    }
    this.playing = false;
    this.hooks.onQueueIdle?.();
  }

  async play(ev) {
    if (!ev) return;
    const d = this.getDirector();
    const h = this.hooks;
    switch (ev.type) {
      case 'attack':
        await this._attack(ev, d, h);
        break;
      case 'defend':
        await this._defend(ev, d, h);
        break;
      case 'yield':
        await h.fxYield?.(ev);
        break;
      case 'jester':
        await h.fxJester?.(ev);
        break;
      case 'jesterPlay':
        // JESTER_PLAYED — strip suit immunity icon
        if (d) await d.jesterClearsImmunity();
        await h.fxJesterPlay?.(ev);
        break;
      default:
        break;
    }
  }

  async _attack(ev, d, h) {
    // Keep previous royal on stage until die animation completes
    if (ev.defeated) window.RegicideBattle?.holdBossSpawn?.(true);
    // DOM card flight + suit FX stay in hooks; Phaser attack after cards land
    await h.fxAttackCards?.(ev);
    if (d) {
      await d.playerLunge(ev.by);
      // BOSS_DAMAGED — hit FX + smooth HP bar
      await d.bossHit(ev.hpAfter, ev.enemyMax);
      // SPADES_APPLIED — refresh attack intent if shield grew
      if (ev.shieldAdded > 0) {
        d.applySpadesIntent(ev.enemyAtk, (ev.shieldBefore || 0) + (ev.shieldAdded || 0));
      }
    }
    await h.fxAttackAftermath?.(ev);
    if (!ev.defeated) return;

    // BOSS_DIED
    if (d) await d.bossDie();
    await h.fxBossDefeatedBanner?.(ev);
    if (ev.victory) {
      window.RegicideBattle?.holdBossSpawn?.(false);
      h.markEnd?.('won');
      return;
    }
    // BOSS_SPAWNED — fresh HP, intent, immunity (never reuse stale HUD)
    if (ev.next && d) {
      const st = h.statsOf?.(ev.next.rank) || { hp: 20, atk: 10 };
      await d.spawnBoss(ev.next, st.hp, st.hp, st.atk, 0, true);
      h.showNextEnemy?.(ev.next, st);
    } else {
      window.RegicideBattle?.holdBossSpawn?.(false);
    }
  }

  async _defend(ev, d, h) {
    const survived = ev.survived !== false && !ev.lost;
    const covered = ev.covered ?? ev.incoming;

    await h.fxDefendCards?.(ev);

    if (d) {
      if (survived) {
        // Discard value covers strike → block, boss hits shield, clear block
        await d.playerBlock(ev.by, covered);
        await d.bossAttack();
        await d.playerClearBlock(ev.by);
      } else {
        // Wrong / short discard → boss hits, player dies
        await d.bossAttack();
        await d.playerHit(ev.by);
        await d.darkenBattlefield(true);
        await d.playerDie(ev.by);
        h.markEnd?.('lost');
      }
    }
    await h.fxDefendAftermath?.(ev, survived);
  }
}
