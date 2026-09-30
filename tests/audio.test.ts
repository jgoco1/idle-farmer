import { describe, expect, it } from 'vitest';
import { AudioEngine, unlockOnFirstGesture, volumesOf } from '../src/audio/engine';
import { bindAudioEvents } from '../src/audio/events';
import { EventBus } from '../src/core/events';
import { LOOP_BEATS, Music, NIGHT_TEMPO, THEMES, loopNotes, themeKey } from '../src/audio/music';
import { coinSemitones, Sfx, SOUNDS, type SfxName } from '../src/audio/sfx';
import type { SeasonId } from '../src/data/ids';
import { asContext, FakeAudioContext } from './helpers-audio';

function engineWithFake(): { engine: AudioEngine; ctx: () => FakeAudioContext } {
  let last: FakeAudioContext | null = null;
  const engine = new AudioEngine(() => {
    last = new FakeAudioContext();
    return asContext(last);
  });
  return {
    engine,
    ctx: () => {
      if (!last) throw new Error('not unlocked');
      return last;
    },
  };
}

describe('audio unlock', () => {
  it('creates nothing and plays nothing before the first gesture', () => {
    const { engine } = engineWithFake();
    const sfx = new Sfx(engine);
    expect(engine.ready).toBe(false);
    expect(sfx.play('click')).toBe(false);
    expect(sfx.played).toEqual([]);
  });

  it('unlock() creates one context, resumes it, and is idempotent', () => {
    const before = FakeAudioContext.created;
    const { engine, ctx } = engineWithFake();
    expect(engine.unlock()).toBe(true);
    expect(engine.unlock()).toBe(true);
    expect(FakeAudioContext.created - before).toBe(1);
    expect(ctx().resumed).toBe(1); // resumed from 'suspended' once
    expect(engine.ready).toBe(true);
  });

  it('resumes a context the browser suspended again', () => {
    const { engine, ctx } = engineWithFake();
    engine.unlock();
    ctx().state = 'suspended';
    engine.unlock();
    expect(ctx().resumed).toBe(2);
  });

  it('stays silent, without throwing, when Web Audio is missing or throws', () => {
    expect(new AudioEngine(null).unlock()).toBe(false);
    const broken = new AudioEngine(() => {
      throw new Error('blocked');
    });
    expect(broken.unlock()).toBe(false);
    expect(new Sfx(broken).play('click')).toBe(false);
  });

  it('unlocks on the first pointer or key event, then stops listening', () => {
    const { engine } = engineWithFake();
    const target = new EventTarget();
    unlockOnFirstGesture(engine, target);
    expect(engine.ready).toBe(false);
    target.dispatchEvent(new Event('keydown'));
    expect(engine.ready).toBe(true);
    const made = FakeAudioContext.created;
    target.dispatchEvent(new Event('pointerdown'));
    expect(FakeAudioContext.created).toBe(made);
  });

  it('whenReady runs immediately after the unlock, or once at the unlock', () => {
    const { engine } = engineWithFake();
    let n = 0;
    engine.whenReady(() => n++);
    expect(n).toBe(0);
    engine.unlock();
    expect(n).toBe(1);
    engine.whenReady(() => n++);
    expect(n).toBe(2);
  });
});

describe('volumes', () => {
  it('master, effects and music set their own gain stage; mute zeroes the master', () => {
    const { engine } = engineWithFake();
    engine.unlock();
    engine.setVolumes({ master: 1, sfx: 0.5, music: 0.2, muted: false });
    expect(engine.master?.gain.value).toBe(1);
    expect(engine.sfxBus?.gain.value).toBeCloseTo(0.25);
    expect(engine.musicBus?.gain.value).toBeCloseTo(0.02);
    engine.setVolumes({ master: 1, sfx: 0.5, music: 0.2, muted: true });
    expect(engine.master?.gain.value).toBe(0);
  });

  it('volumes set before the unlock are applied at the unlock', () => {
    const { engine } = engineWithFake();
    engine.setVolumes({ master: 0.5, sfx: 1, music: 1, muted: false });
    engine.unlock();
    expect(engine.master?.gain.value).toBeCloseTo(0.25);
  });

  it('volumesOf picks the four audio prefs', () => {
    expect(volumesOf({ master: 0.1, sfx: 0.2, music: 0.3, muted: true })).toEqual({
      master: 0.1,
      sfx: 0.2,
      music: 0.3,
      muted: true,
    });
  });
});

describe('sound effects', () => {
  it('every named sound builds nodes without throwing', () => {
    const { engine, ctx } = engineWithFake();
    engine.unlock();
    const sfx = new Sfx(engine);
    for (const name of Object.keys(SOUNDS) as SfxName[]) {
      const before = ctx().nodes.length;
      ctx().currentTime += 1; // clear the throttle between sounds
      expect(sfx.play(name, { amount: 500 })).toBe(true);
      expect(ctx().nodes.length).toBeGreaterThan(before);
    }
  });

  it('covers every sound the phase asks for', () => {
    for (const n of [
      'hoe',
      'plant',
      'water',
      'harvest',
      'coin',
      'purchase',
      'cast',
      'bite',
      'reel',
      'catch',
      'escape',
      'sizzle',
      'dishReady',
      'eat',
      'buff',
      'levelUp',
      'goal',
      'panelOpen',
      'panelClose',
      'click',
    ])
      expect(SOUNDS).toHaveProperty(n);
  });

  it('throttles the same sound inside its minimum gap', () => {
    const { engine, ctx } = engineWithFake();
    engine.unlock();
    const sfx = new Sfx(engine);
    expect(sfx.play('hoe')).toBe(true);
    expect(sfx.play('hoe')).toBe(false);
    ctx().currentTime += 0.2;
    expect(sfx.play('hoe')).toBe(true);
  });

  it('coin pitch rises with the amount and is capped', () => {
    expect(coinSemitones(1)).toBeLessThan(coinSemitones(100));
    expect(coinSemitones(100)).toBeLessThan(coinSemitones(10_000));
    expect(coinSemitones(1e12)).toBe(14);
    expect(coinSemitones(0)).toBeGreaterThanOrEqual(0);
  });
});

describe('events → sound', () => {
  it('plays the right sound for each event and stays quiet while replaying', () => {
    const { engine, ctx } = engineWithFake();
    engine.unlock();
    const sfx = new Sfx(engine);
    const bus = new EventBus();
    let quiet = false;
    bindAudioEvents(bus, sfx, () => quiet);
    const step = (): void => void (ctx().currentTime += 1);
    bus.emit({ type: 'tilled', plots: [0] });
    step();
    bus.emit({ type: 'watered', plots: [0] });
    step();
    bus.emit({ type: 'planted', crop: 'turnip', plots: [0] });
    step();
    bus.emit({ type: 'sold', item: 'turnip', qty: 1, gold: 50, via: 'market' });
    step();
    bus.emit({ type: 'levelUp', skill: 'farming', level: 2 });
    step();
    expect(sfx.played).toEqual(['hoe', 'water', 'plant', 'coin', 'levelUp']);
    quiet = true;
    bus.emit({ type: 'levelUp', skill: 'farming', level: 3 });
    expect(sfx.played.at(-1)).toBe('levelUp');
    expect(sfx.played).toHaveLength(5);
  });

  it('automation is silent: a farmhand harvest makes no sound', () => {
    const { engine } = engineWithFake();
    engine.unlock();
    const sfx = new Sfx(engine);
    const bus = new EventBus();
    bindAudioEvents(bus, sfx, () => false);
    bus.emit({ type: 'harvested', crop: 'turnip', qty: 1, plot: 0, auto: true, shipped: 0 });
    expect(sfx.played).toEqual([]);
  });
});

describe('music', () => {
  it('has a day theme per season and a softer, sparser night variation', () => {
    for (const season of Object.keys(THEMES) as SeasonId[]) {
      const theme = THEMES[season];
      const day = loopNotes(theme, false, 0);
      const night = loopNotes(theme, true, 0);
      expect(day.length).toBeGreaterThan(night.length);
      const peak = (ns: typeof day): number => Math.max(...ns.map((n) => n.vol));
      expect(peak(night)).toBeLessThan(peak(day));
      for (const n of [...day, ...night]) {
        expect(n.beat).toBeGreaterThanOrEqual(0);
        expect(n.beat).toBeLessThan(LOOP_BEATS);
      }
    }
    expect(NIGHT_TEMPO).toBeLessThan(1);
  });

  it('loops vary: consecutive loops differ, equal loops repeat exactly', () => {
    const t = THEMES.spring;
    expect(JSON.stringify(loopNotes(t, false, 0))).not.toEqual(JSON.stringify(loopNotes(t, false, 1)));
    expect(loopNotes(t, false, 2)).toEqual(loopNotes(t, false, 2));
  });

  it('picks the theme from the season and the local night', () => {
    expect(themeKey('autumn', false)).toBe('autumn-day');
    expect(themeKey('winter', true)).toBe('winter-night');
  });

  it('plays nothing before the unlock, then schedules notes and crossfades on a change', () => {
    const { engine, ctx } = engineWithFake();
    const music = new Music(engine);
    music.setTheme('spring-day');
    expect(music.history).toEqual([]);
    engine.unlock();
    music.update();
    expect(music.history).toEqual(['spring-day']);
    expect(ctx().count('osc')).toBeGreaterThan(0);
    const oscs = ctx().count('osc');
    ctx().currentTime += 5;
    music.update();
    expect(ctx().count('osc')).toBeGreaterThan(oscs); // keeps scheduling ahead
    music.setTheme('spring-night');
    expect(music.history).toEqual(['spring-day', 'spring-night']);
    music.setTheme('spring-night');
    expect(music.history).toHaveLength(2); // same theme: no restart
  });
});
