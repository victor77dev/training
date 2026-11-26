'use strict';
/* =========================================================================
   Reaction Trainer
   - Setup screen (cues, timing, duration, presets)
   - Session engine (countdown, sets, rounds/time, rest, pause, stats)
   - Multi-device: one device = display, another = remote (via server.js relay)
   ========================================================================= */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const rand = (a, b) => a + Math.random() * (b - a);
const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];
const fmtTime = (sec) => { sec = Math.max(0, Math.round(sec)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };
const fmtMs = (ms) => `${Math.round(ms)}`;
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

/* ---------------------------- Cue catalogue ---------------------------- */
function polygon(n, r = 44, rot = -90, cx = 50, cy = 50) {
  return Array.from({ length: n }, (_, i) => {
    const a = ((rot + (360 / n) * i) * Math.PI) / 180;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
}
function starPoints(n = 5, ro = 46, ri = 19) {
  return Array.from({ length: n * 2 }, (_, i) => {
    const r = i % 2 ? ri : ro, a = ((-90 + (180 / n) * i) * Math.PI) / 180;
    return `${(50 + r * Math.cos(a)).toFixed(1)},${(52 + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
}
const ARROW_PATH = 'M50 6 L90 48 H64 V94 H36 V48 H10 Z';

const CATS = {
  colors: {
    label: 'Colours',
    items: [
      { id: 'red', label: 'Red', hex: '#ef2b2b' },
      { id: 'blue', label: 'Blue', hex: '#1f6fff' },
      { id: 'green', label: 'Green', hex: '#18c25a' },
      { id: 'yellow', label: 'Yellow', hex: '#ffd60a' },
      { id: 'purple', label: 'Purple', hex: '#9b30ff' },
      { id: 'orange', label: 'Orange', hex: '#ff7a00' },
      { id: 'pink', label: 'Pink', hex: '#ff4fa3' },
      { id: 'white', label: 'White', hex: '#ffffff' },
    ],
  },
  arrows: {
    label: 'Arrows',
    items: [
      { id: 'u', label: 'Up', angle: 0 }, { id: 'ur', label: 'Up right', angle: 45 },
      { id: 'r', label: 'Right', angle: 90 }, { id: 'dr', label: 'Down right', angle: 135 },
      { id: 'd', label: 'Down', angle: 180 }, { id: 'dl', label: 'Down left', angle: 225 },
      { id: 'l', label: 'Left', angle: 270 }, { id: 'ul', label: 'Up left', angle: 315 },
    ],
  },
  numbers: { label: 'Numbers', items: '123456789'.split('').map((c) => ({ id: c, label: c, text: c })) },
  letters: { label: 'Letters', items: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => ({ id: c, label: c, text: c })) },
  shapes: {
    label: 'Shapes',
    items: [
      { id: 'circle', label: 'Circle', svg: '<circle cx="50" cy="50" r="44"/>' },
      { id: 'triangle', label: 'Triangle', svg: `<polygon points="${polygon(3, 50, -90, 50, 58)}"/>` },
      { id: 'square', label: 'Square', svg: '<rect x="10" y="10" width="80" height="80" rx="4"/>' },
      { id: 'diamond', label: 'Diamond', svg: `<polygon points="${polygon(4, 46)}"/>` },
      { id: 'pentagon', label: 'Pentagon', svg: `<polygon points="${polygon(5, 47, -90, 50, 53)}"/>` },
      { id: 'hexagon', label: 'Hexagon', svg: `<polygon points="${polygon(6, 46, 0)}"/>` },
      { id: 'star', label: 'Star', svg: `<polygon points="${starPoints()}"/>` },
      { id: 'cross', label: 'Cross', svg: '<path d="M36 6H64V36H94V64H64V94H36V64H6V36H36Z"/>' },
    ],
  },
};
const itemOf = (cat, id) => CATS[cat].items.find((i) => i.id === id);

/* ------------------------------ Config -------------------------------- */
const DEFAULT_CONFIG = {
  sel: { colors: ['red', 'blue', 'green', 'yellow'], arrows: [], numbers: [], letters: [], shapes: [] },
  speak: { colors: false, arrows: false, numbers: false, letters: false, shapes: false },
  combine: false, noRepeat: true, beep: false, audioOnly: false,
  mode: 'timed',
  length: 1.0, randomLength: false, lengthMax: 2.0,
  delay: 1.0, randomDelay: false, delayMax: 2.0,
  durationType: 'rounds', rounds: 10, unlimited: false, time: 60,
  sets: 1, rest: 30, countdown: 3,
};
const STEPPERS = {
  length:    { t: 'Show cue for', s: 'Seconds on screen', min: 0.1, max: 10, step: 0.1, fmt: (v) => `${v.toFixed(1)} s` },
  lengthMax: { t: 'Up to', s: 'Random between min and this', min: 0.1, max: 15, step: 0.1, fmt: (v) => `${v.toFixed(1)} s` },
  delay:     { t: 'Gap between cues', s: 'Blank screen in between', min: 0, max: 10, step: 0.1, fmt: (v) => `${v.toFixed(1)} s` },
  delayMax:  { t: 'Up to', s: 'Random between min and this', min: 0, max: 15, step: 0.1, fmt: (v) => `${v.toFixed(1)} s` },
  rounds:    { t: 'Cues per set', s: 'How many cues appear', min: 1, max: 500, step: 1, fmt: (v) => `${v}` },
  time:      { t: 'Set length', s: 'Minutes : seconds', min: 5, max: 3600, step: 5, fmt: fmtTime },
  sets:      { t: 'Sets', s: 'Repeat the block', min: 1, max: 20, step: 1, fmt: (v) => `${v}` },
  rest:      { t: 'Rest between sets', s: 'Minutes : seconds', min: 5, max: 600, step: 5, fmt: fmtTime },
  countdown: { t: 'Start countdown', s: 'Get ready time', min: 0, max: 10, step: 1, fmt: (v) => `${v} s` },
};

let config = mergeConfig(store.get('rt.config', null));
function mergeConfig(c) {
  const base = structuredClone(DEFAULT_CONFIG);
  if (!c) return base;
  return { ...base, ...c, sel: { ...base.sel, ...(c.sel || {}) }, speak: { ...base.speak, ...(c.speak || {}) } };
}
function saveConfig() { store.set('rt.config', config); }

/* ------------------------------- Audio -------------------------------- */
const Sound = {
  ctx: null,
  unlock() {
    try {
      this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume();
      if ('speechSynthesis' in window && !this._spoke) { speechSynthesis.speak(new SpeechSynthesisUtterance(' ')); this._spoke = true; }
    } catch {}
  },
  beep(freq = 880, dur = 0.12, vol = 0.25) {
    if (!this.ctx) return;
    try {
      const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.frequency.value = freq; o.type = 'sine';
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + dur + 0.02);
    } catch {}
  },
  speak(text) {
    if (!('speechSynthesis' in window) || !text) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.15;
    speechSynthesis.speak(u);
  },
};

/* ---------------------------- Rendering ------------------------------- */
// stim = { cat, id, color? }  (color = colour id when combined)
function stimKey(s) { return `${s.color ? s.color + '+' : ''}${s.cat}:${s.id}`; }
function stimLabel(s, onlySpoken = null) {
  const parts = [];
  if (s.color && (!onlySpoken || onlySpoken.colors)) parts.push(itemOf('colors', s.color).label);
  if (!onlySpoken || onlySpoken[s.cat]) parts.push(itemOf(s.cat, s.id).label);
  return parts.join(' ');
}
function glyphSvg(cat, item, fill) {
  let inner = '';
  if (cat === 'arrows') inner = `<path d="${ARROW_PATH}" transform="rotate(${item.angle} 50 50)"/>`;
  else if (cat === 'shapes') inner = item.svg;
  else inner = `<text x="50" y="54" text-anchor="middle" dominant-baseline="middle" font-size="88" font-weight="800" font-family="system-ui,-apple-system,sans-serif">${item.text}</text>`;
  return `<svg viewBox="0 0 100 100" fill="${fill}" aria-hidden="true">${inner}</svg>`;
}
function renderStim(el, s) {
  el.style.background = '';
  if (s.cat === 'colors') { el.innerHTML = ''; el.style.background = itemOf('colors', s.id).hex; return; }
  const fill = s.color ? itemOf('colors', s.color).hex : '#ffffff';
  el.innerHTML = glyphSvg(s.cat, itemOf(s.cat, s.id), fill);
}
function renderBlank(el) { el.style.background = ''; el.innerHTML = ''; }
function renderMsg(el, html) { el.style.background = ''; el.innerHTML = `<div class="msg">${html}</div>`; }
function renderCount(el, n) { el.style.background = ''; el.innerHTML = `<div class="count-num">${n}</div>`; }
function renderPulse(el) { el.style.background = ''; el.innerHTML = '<div class="pulse"></div>'; }

/* ---------------------------- Cue picker ------------------------------ */
function makePicker(cfg) {
  const cats = Object.keys(CATS).filter((c) => cfg.sel[c]?.length);
  const colors = cfg.sel.colors || [];
  const symbolCats = cats.filter((c) => c !== 'colors');
  const combine = cfg.combine && colors.length && symbolCats.length;
  const poolCats = combine ? symbolCats : cats;
  let last = null;
  const one = () => {
    const cat = pickOne(poolCats);
    const s = { cat, id: pickOne(cfg.sel[cat]) };
    if (combine) s.color = pickOne(colors);
    return s;
  };
  const total = poolCats.reduce((n, c) => n + cfg.sel[c].length, 0) * (combine ? colors.length : 1);
  return () => {
    let s = one();
    if (cfg.noRepeat && total > 1) for (let i = 0; i < 30 && last && stimKey(s) === stimKey(last); i++) s = one();
    last = s;
    return s;
  };
}
function cueCount(cfg) { return Object.keys(CATS).reduce((n, c) => n + (cfg.sel[c]?.length || 0), 0); }

/* ---------------------------- Session engine -------------------------- */
const ABORT = Symbol('abort');
class Session {
  constructor(cfg, ui) {
    this.cfg = cfg; this.ui = ui;
    this.paused = false; this.aborted = false;
    this.timer = null; this.tapWaiter = null;
    this.pausedTotal = 0; this.pausedAt = 0;
    this.stats = { shown: 0, counts: {}, rts: [], setsDone: 0, mode: cfg.mode, completed: false, durationMs: 0 };
    this.pick = makePicker(cfg);
  }
  now() { return performance.now(); }
  activeNow() { return this.now() - this.pausedTotal - (this.paused ? this.now() - this.pausedAt : 0); }

  wait(ms) {
    if (ms <= 0) return Promise.resolve();
    return new Promise((res, rej) => {
      const t = { remaining: ms, start: 0, id: 0, res, rej };
      this.timer = t;
      this._arm();
    });
  }
  _arm() {
    const t = this.timer;
    if (!t || this.paused) return;
    t.start = this.now();
    t.id = setTimeout(() => { if (this.timer === t) this.timer = null; t.res(); }, t.remaining);
  }
  waitTap() {
    return new Promise((res, rej) => { this.tapWaiter = { res, rej }; });
  }
  tap() {
    if (this.paused || !this.tapWaiter) return;
    const w = this.tapWaiter; this.tapWaiter = null; w.res();
  }
  pause() {
    if (this.paused || this.aborted) return;
    this.paused = true; this.pausedAt = this.now();
    const t = this.timer;
    if (t) { clearTimeout(t.id); t.remaining -= this.now() - t.start; }
    window.speechSynthesis?.cancel();
    this.ui.paused(true);
  }
  resume() {
    if (!this.paused || this.aborted) return;
    this.pausedTotal += this.now() - this.pausedAt;
    this.paused = false;
    this._arm();
    this.ui.paused(false);
  }
  stop() {
    if (this.aborted) return;
    if (this.paused) { this.pausedTotal += this.now() - this.pausedAt; this.paused = false; }
    this.aborted = true;
    if (this.timer) { clearTimeout(this.timer.id); this.timer.rej(ABORT); this.timer = null; }
    if (this.tapWaiter) { this.tapWaiter.rej(ABORT); this.tapWaiter = null; }
  }

  async run() {
    const c = this.cfg, ui = this.ui;
    const t0 = this.activeNow();
    try {
      for (let n = c.countdown; n >= 1; n--) {
        ui.countdown(n); Sound.beep(660, 0.12);
        await this.wait(1000);
      }
      for (let set = 1; set <= c.sets; set++) {
        if (set > 1) {
          for (let s = c.rest; s >= 1; s--) {
            ui.rest(s, set);
            if (s <= 3) Sound.beep(660, 0.1);
            await this.wait(1000);
          }
        }
        Sound.beep(1046, 0.25);
        await this.runSet(set);
        this.stats.setsDone = set;
      }
      this.stats.completed = true;
    } catch (e) {
      if (e !== ABORT) throw e;
    }
    this.stats.durationMs = this.activeNow() - t0;
    ui.done(this.stats);
    return this.stats;
  }

  async runSet(set) {
    const c = this.cfg, ui = this.ui;
    const byTime = c.durationType === 'time';
    const unlimited = !byTime && c.unlimited;
    const limitMs = c.time * 1000;
    const setStart = this.activeNow();
    const left = () => limitMs - (this.activeNow() - setStart);
    const lenMs = () => 1000 * (c.randomLength ? rand(Math.min(c.length, c.lengthMax), Math.max(c.length, c.lengthMax)) : c.length);
    const gapMs = () => 1000 * (c.randomDelay ? rand(Math.min(c.delay, c.delayMax), Math.max(c.delay, c.delayMax)) : c.delay);

    for (let i = 0; ; i++) {
      if (byTime ? left() <= 50 : !unlimited && i >= c.rounds) break;
      const s = this.pick();
      this.stats.shown++;
      const k = stimKey(s);
      (this.stats.counts[k] ||= { stim: s, n: 0, rts: [] }).n++;
      ui.show(s, { set, round: i + 1, timeLeft: byTime ? left() / 1000 : null });
      if (c.beep) Sound.beep(988, 0.08);
      const spoken = stimLabel(s, c.speak);
      if (spoken) Sound.speak(spoken);

      if (c.mode === 'touch') {
        const shownAt = this.activeNow();
        if (byTime) {
          await Promise.race([this.waitTap(), this.wait(left())]);
          if (this.timer) { clearTimeout(this.timer.id); this.timer = null; }
        } else await this.waitTap();
        if (this.tapWaiter) { this.tapWaiter = null; } // timed out by set clock -> no RT
        else {
          const rt = this.activeNow() - shownAt;
          this.stats.rts.push(rt); this.stats.counts[k].rts.push(rt);
        }
      } else {
        await this.wait(byTime ? Math.min(lenMs(), left()) : lenMs());
      }
      ui.blank();
      const isLast = byTime ? left() <= 50 : !unlimited && i + 1 >= c.rounds;
      if (isLast) break;
      await this.wait(byTime ? Math.min(gapMs(), left()) : gapMs());
    }
  }
}

/* ------------------------------ Screens ------------------------------- */
function show(id) {
  for (const s of $$('.screen')) s.hidden = s.id !== id;
  window.scrollTo(0, 0);
}
let toastTimer;
function toast(text) {
  const t = $('#toast'); t.textContent = text; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

/* ------------------------------ Setup UI ------------------------------ */
function buildSetup() {
  // categories
  $('#cats').innerHTML = Object.entries(CATS).map(([cat, def]) => `
    <div class="cat" data-cat="${cat}">
      <div class="cat-head">
        <h3>${def.label}<span class="count"></span></h3>
        <button type="button" class="mini-btn" data-act="speak" aria-label="Speak ${def.label}">🔊</button>
        <button type="button" class="mini-btn" data-act="all">All</button>
        <button type="button" class="mini-btn" data-act="none">None</button>
      </div>
      <div class="chips">${def.items.map((it) => `
        <button type="button" class="chip" data-id="${it.id}" aria-label="${it.label}" title="${it.label}">${
          cat === 'colors' ? `<span class="swatch" style="background:${it.hex}"></span>`
          : cat === 'numbers' || cat === 'letters' ? it.text
          : glyphSvg(cat, it, 'currentColor')}</button>`).join('')}
      </div>
    </div>`).join('');

  $('#cats').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const cat = b.closest('.cat').dataset.cat;
    const sel = new Set(config.sel[cat]);
    if (b.classList.contains('chip')) { sel.has(b.dataset.id) ? sel.delete(b.dataset.id) : sel.add(b.dataset.id); }
    else if (b.dataset.act === 'all') CATS[cat].items.forEach((i) => sel.add(i.id));
    else if (b.dataset.act === 'none') sel.clear();
    else if (b.dataset.act === 'speak') { config.speak[cat] = !config.speak[cat]; if (config.speak[cat]) Sound.speak(CATS[cat].label); }
    config.sel[cat] = CATS[cat].items.map((i) => i.id).filter((id) => sel.has(id)); // keep catalogue order
    changed();
  });

  // steppers
  for (const el of $$('[data-stepper]')) {
    const k = el.dataset.stepper, d = STEPPERS[k];
    el.innerHTML = `<div class="lbl-wrap"><div class="lbl-t">${d.t}</div><div class="lbl-s">${d.s}</div></div>
      <div class="stepper"><button type="button" data-d="-1" aria-label="Decrease">−</button><output></output><button type="button" data-d="1" aria-label="Increase">+</button></div>`;
    let holdT, holdI;
    const bump = (dir) => {
      const v = Math.round((config[k] + dir * d.step) * 1000) / 1000;
      config[k] = Math.min(d.max, Math.max(d.min, v)); changed();
    };
    const stopHold = () => { clearTimeout(holdT); clearInterval(holdI); };
    el.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('button[data-d]'); if (!b) return;
      e.preventDefault();
      const dir = Number(b.dataset.d); bump(dir);
      holdT = setTimeout(() => (holdI = setInterval(() => bump(dir), 70)), 400);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => el.addEventListener(ev, stopHold));
  }

  // switches
  for (const el of $$('input[data-opt]')) el.addEventListener('change', () => { config[el.dataset.opt] = el.checked; changed(); });

  // segmented
  for (const seg of $$('[data-seg]')) seg.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    config[seg.dataset.seg] = b.dataset.val; changed();
  });

  $('#startBtn').addEventListener('click', start);
  $('#presetSaveBtn').addEventListener('click', savePreset);
  $('#presetName').addEventListener('keydown', (e) => { if (e.key === 'Enter') savePreset(); });
  $('#presetList').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const presets = store.get('rt.presets', []);
    const i = Number(b.dataset.i);
    if (b.dataset.act === 'load') { config = mergeConfig(presets[i].config); changed(); toast(`Loaded “${presets[i].name}”`); }
    if (b.dataset.act === 'del') { presets.splice(i, 1); store.set('rt.presets', presets); renderPresets(); }
  });
}

function evalCond(cond) {
  const m = cond.match(/^(\w+)(=|>)(.+)$/);
  if (!m) return !!config[cond];
  return m[2] === '=' ? String(config[m[1]]) === m[3] : config[m[1]] > Number(m[3]);
}

function changed() { saveConfig(); syncSetup(); }

function syncSetup() {
  for (const [cat] of Object.entries(CATS)) {
    const box = $(`.cat[data-cat="${cat}"]`);
    const sel = new Set(config.sel[cat]);
    for (const ch of $$('.chip', box)) ch.classList.toggle('on', sel.has(ch.dataset.id));
    $('.count', box).textContent = sel.size ? ` · ${sel.size}` : '';
    $('[data-act="speak"]', box).classList.toggle('on', !!config.speak[cat]);
  }
  for (const el of $$('[data-stepper]')) $('output', el).textContent = STEPPERS[el.dataset.stepper].fmt(config[el.dataset.stepper]);
  for (const el of $$('input[data-opt]')) el.checked = !!config[el.dataset.opt];
  for (const seg of $$('[data-seg]')) for (const b of $$('button', seg)) b.classList.toggle('on', config[seg.dataset.seg] === b.dataset.val);
  for (const el of $$('[data-show]')) el.hidden = !evalCond(el.dataset.show);
  for (const el of $$('[data-hide]')) if (!el.hidden) el.hidden = evalCond(el.dataset.hide);
  renderSummary();
  renderPresets();
}

function describe(cfg) {
  const cues = cueCount(cfg);
  const avgLen = cfg.randomLength ? (cfg.length + cfg.lengthMax) / 2 : cfg.length;
  const avgGap = cfg.randomDelay ? (cfg.delay + cfg.delayMax) / 2 : cfg.delay;
  let what, total = null;
  if (cfg.durationType === 'time') {
    what = `${cfg.sets > 1 ? cfg.sets + ' × ' : ''}${fmtTime(cfg.time)}`;
    total = cfg.sets * cfg.time + (cfg.sets - 1) * cfg.rest + cfg.countdown;
  } else if (cfg.unlimited) {
    what = 'Unlimited';
  } else {
    what = `${cfg.sets > 1 ? cfg.sets + ' × ' : ''}${cfg.rounds} cues`;
    if (cfg.mode === 'timed') total = cfg.sets * (cfg.rounds * avgLen + (cfg.rounds - 1) * avgGap) + (cfg.sets - 1) * cfg.rest + cfg.countdown;
  }
  return { cues, what, total };
}

function renderSummary() {
  const d = describe(config);
  $('#summary').innerHTML = d.cues
    ? `<b>${d.what}</b> · ${d.cues} cue type${d.cues > 1 ? 's' : ''}<br>${d.total != null ? `≈ ${fmtTime(d.total)} total` : config.mode === 'touch' ? 'Tap to advance' : 'Stop when you want'}`
    : '<b>Pick at least one cue</b>';
  $('#startBtn').disabled = !d.cues;
  $('#startBtn').textContent = Net.hasDisplay ? '📺 Start on display' : '▶ Start';
}

function savePreset() {
  const name = $('#presetName').value.trim() || `Drill ${new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
  const presets = store.get('rt.presets', []);
  const i = presets.findIndex((p) => p.name === name);
  const entry = { name, config: structuredClone(config) };
  if (i >= 0) presets[i] = entry; else presets.unshift(entry);
  store.set('rt.presets', presets);
  $('#presetName').value = '';
  renderPresets(); toast(`Saved “${name}”`);
}
function renderPresets() {
  const presets = store.get('rt.presets', []);
  $('#presetList').innerHTML = presets.length
    ? presets.map((p, i) => { const d = describe(mergeConfig(p.config)); return `<li>
        <button type="button" class="load" data-act="load" data-i="${i}">${escapeHtml(p.name)}<span class="meta">${d.what} · ${p.config.mode === 'touch' ? 'tap' : 'timed'}</span></button>
        <button type="button" class="mini-btn" data-act="del" data-i="${i}" aria-label="Delete">✕</button></li>`; }).join('')
    : '<li class="empty">No saved drills yet.</li>';
}
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ------------------------------ Running ------------------------------- */
let session = null;
let lastConfig = null;     // config of last run (for Repeat)
let wakeLock = null;

async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    else { await wakeLock?.release(); wakeLock = null; }
  } catch {}
}
document.addEventListener('visibilitychange', () => { if (session && document.visibilityState === 'visible') keepAwake(true); });

function start() {
  if (!cueCount(config)) return;
  Sound.unlock();
  lastConfig = structuredClone(config);
  if (Net.hasDisplay) { startRemote(lastConfig); return; }
  try { document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })?.catch(() => {}); } catch {}
  runLocal(lastConfig);
}

// Runs the session on THIS device (standalone, or as the remote-controlled display).
function runLocal(cfg, { remote = false } = {}) {
  session?.stop();
  const stage = $('#stage'), info = $('#hudInfo');
  const relay = (m) => { if (remote) Net.send(m); };
  const progress = (set, round, timeLeft) => {
    const p = [];
    if (cfg.sets > 1) p.push(`Set ${set}/${cfg.sets}`);
    if (cfg.durationType === 'time') p.push(fmtTime(timeLeft));
    else p.push(cfg.unlimited ? `#${round}` : `${round}/${cfg.rounds}`);
    return p.join(' · ');
  };
  const ui = {
    countdown(n) { renderCount(stage, n); info.textContent = ''; relay({ type: 'status', phase: 'countdown', n }); },
    rest(sec, set) { renderMsg(stage, `Rest<small>${fmtTime(sec)} · next: set ${set}/${cfg.sets}</small>`); info.textContent = ''; relay({ type: 'status', phase: 'rest', sec, set }); },
    show(s, p) {
      if (cfg.audioOnly) renderPulse(stage); else renderStim(stage, s);
      const txt = progress(p.set, p.round, p.timeLeft); info.textContent = txt;
      relay({ type: 'status', phase: 'stim', stim: s, info: txt });
    },
    blank() { renderBlank(stage); relay({ type: 'status', phase: 'blank' }); },
    paused(on) { $('#pausedOverlay').hidden = !on; $('#pauseBtn').textContent = on ? '▶' : '❚❚'; relay({ type: 'status', phase: on ? 'paused' : 'resumed' }); },
    done(stats) {
      keepAwake(false);
      if (document.fullscreenElement && !Net.isDisplay) document.exitFullscreen?.().catch(() => {});
      relay({ type: 'done', stats });
      showStats(stats, cfg, { remoteDisplay: remote });
    },
  };
  $('#pausedOverlay').hidden = true; $('#pauseBtn').textContent = '❚❚';
  renderBlank(stage); info.textContent = '';
  show('run');
  keepAwake(true);
  session = new Session(cfg, ui);
  const me = session;
  me.run().finally(() => { if (session === me) session = null; });
}

function bindRunControls() {
  const stage = $('#stage');
  stage.addEventListener('pointerdown', (e) => { e.preventDefault(); session?.tap(); });
  $('#pauseBtn').addEventListener('click', () => session && (session.paused ? session.resume() : session.pause()));
  $('#resumeBtn').addEventListener('click', () => session?.resume());
  $('#stopBtn').addEventListener('click', () => session?.stop());
  document.addEventListener('keydown', (e) => {
    if ($('#run').hidden || !session) return;
    if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); session.tap(); }
    if (e.code === 'KeyP') session.paused ? session.resume() : session.pause();
    if (e.code === 'Escape') session.stop();
  });
}

/* ------------------------------ Stats --------------------------------- */
function showStats(stats, cfg, { remoteDisplay = false } = {}) {
  const rts = stats.rts;
  const avg = rts.length ? rts.reduce((a, b) => a + b, 0) / rts.length : 0;
  const best = rts.length ? Math.min(...rts) : 0, worst = rts.length ? Math.max(...rts) : 0;
  const tiles = [
    { v: stats.shown, k: 'Cues shown' },
    { v: fmtTime(stats.durationMs / 1000), k: 'Active time' },
    { v: `${stats.setsDone}<small>/${cfg.sets}</small>`, k: 'Sets done' },
  ];
  if (rts.length) {
    tiles.unshift({ v: `${fmtMs(avg)}<small>ms</small>`, k: 'Avg reaction', hl: true });
    tiles.push({ v: `${fmtMs(best)}<small>ms</small>`, k: 'Fastest' }, { v: `${fmtMs(worst)}<small>ms</small>`, k: 'Slowest' });
  } else if (stats.durationMs > 0) {
    tiles.push({ v: (stats.shown / (stats.durationMs / 60000)).toFixed(0), k: 'Cues / minute' });
  }

  const entries = Object.values(stats.counts).sort((a, b) => b.n - a.n);
  const body = $('#statsBody');
  body.innerHTML = `
    ${stats.completed ? '' : '<p class="stats-note">Stopped early — showing what was completed.</p>'}
    <div class="tiles">${tiles.map((t) => `<div class="tile${t.hl ? ' hl' : ''}"><div class="v">${t.v}</div><div class="k">${t.k}</div></div>`).join('')}</div>
    ${rts.length > 1 ? `<section class="card"><h2>Reaction time per cue</h2><p class="hint">Green = fastest, dashed line = average</p>${rtChart(rts, avg)}</section>` : ''}
    ${entries.length ? `<section class="card"><h2>Cue breakdown</h2><p class="hint">How often each cue appeared${rts.length ? ' and your average reaction' : ''}</p>
      <div class="breakdown">${entries.map((e) => `<div class="bd-item"><div class="stim" data-stim='${JSON.stringify(e.stim)}'></div>
        <div class="n">${e.n}×${e.rts.length ? `<small>${fmtMs(e.rts.reduce((a, b) => a + b, 0) / e.rts.length)} ms</small>` : ''}</div></div>`).join('')}</div></section>` : ''}
  `;
  for (const el of $$('[data-stim]', body)) renderStim(el, JSON.parse(el.dataset.stim));

  $('#statsActions').hidden = remoteDisplay;
  if (remoteDisplay) body.insertAdjacentHTML('beforeend', '<p class="stats-note">Controlled remotely — use the phone to repeat or change the drill.</p>');
  show('stats');
}

function rtChart(rts, avg) {
  const W = 600, H = 160, pad = 24, max = Math.max(...rts) * 1.1;
  const bw = (W - pad) / rts.length, best = Math.min(...rts);
  const y = (v) => H - 18 - (v / max) * (H - 30);
  const bars = rts.map((v, i) => `<rect class="bar${v === best ? ' best' : ''}" x="${pad + i * bw + bw * 0.15}" y="${y(v)}" width="${Math.max(1, bw * 0.7)}" height="${H - 18 - y(v)}" rx="2"><title>#${i + 1}: ${fmtMs(v)} ms</title></rect>`).join('');
  return `<svg class="rt-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Reaction times">
    <line class="avg" x1="${pad}" x2="${W}" y1="${y(avg)}" y2="${y(avg)}"/>
    <text x="0" y="${y(avg) + 4}">${fmtMs(avg)}</text>${bars}
    <text x="${pad}" y="${H - 2}">1</text><text x="${W - 4}" y="${H - 2}" text-anchor="end">${rts.length}</text></svg>`;
}

function bindStats() {
  $('#editBtn').addEventListener('click', () => show('setup'));
  $('#repeatBtn').addEventListener('click', () => {
    Sound.unlock();
    const cfg = lastConfig || config;
    if (Net.hasDisplay) startRemote(cfg);
    else { try { document.documentElement.requestFullscreen?.()?.catch(() => {}); } catch {} runLocal(cfg); }
  });
}

/* ------------------------------ Remote side --------------------------- */
let remoteMode = null;
function startRemote(cfg) {
  remoteMode = cfg.mode;
  Net.send({ type: 'start', config: cfg });
  renderMsg($('#mirror'), 'Starting…');
  $('#remoteInfo').textContent = '';
  $('#remoteTap').hidden = cfg.mode !== 'touch';
  $('#remotePause').textContent = '❚❚ Pause';
  show('remote');
  syncConnUi();
}
function bindRemote() {
  $('#remotePause').addEventListener('click', (e) => {
    const paused = e.currentTarget.dataset.paused === '1';
    Net.send({ type: paused ? 'resume' : 'pause' });
  });
  $('#remoteStop').addEventListener('click', () => {
    if (Net.hasDisplay) Net.send({ type: 'stop' });
    else show('setup'); // display gone — just go back
  });
  $('#remoteTap').addEventListener('pointerdown', (e) => { e.preventDefault(); Net.send({ type: 'tap' }); });
}
function onRemoteStatus(m) {
  if ($('#remote').hidden) { if (!$('#stats').hidden || !$('#setup').hidden) show('remote'); }
  const mirror = $('#mirror');
  if (m.phase === 'countdown') { renderCount(mirror, m.n); $('#remoteInfo').textContent = 'Get ready'; }
  else if (m.phase === 'rest') { renderMsg(mirror, `Rest<small>${fmtTime(m.sec)}</small>`); $('#remoteInfo').textContent = `Next: set ${m.set}`; }
  else if (m.phase === 'stim') { renderStim(mirror, m.stim); $('#remoteInfo').textContent = m.info; }
  else if (m.phase === 'blank') renderBlank(mirror);
  else if (m.phase === 'paused' || m.phase === 'resumed') {
    const p = m.phase === 'paused';
    const b = $('#remotePause'); b.dataset.paused = p ? '1' : '0'; b.textContent = p ? '▶ Resume' : '❚❚ Pause';
    if (p) renderMsg(mirror, 'Paused');
  }
}

/* ------------------------------ Display side -------------------------- */
function enterDisplayMode(mode) {
  Net.start(mode, 'display', randomCode(TRANSPORTS[mode].codeLength));
  showDisplayWait();
}
function showDisplayWait() {
  session?.stop();
  show('display');
  syncConnUi();
}
function bindDisplay() {
  $('#displayExit').addEventListener('click', () => { Net.disconnect(); show('setup'); });
  $('#displayPairBtn').addEventListener('click', () => Pair.startDisplay());
  $('#unlockBtn').addEventListener('click', () => {
    Sound.unlock(); Sound.beep(880, 0.15);
    try { document.documentElement.requestFullscreen?.()?.catch(() => {}); } catch {}
    keepAwake(true);
    $('#unlockBtn').textContent = '✓ Sound on';
  });
}

/* ------------------------------ Net events ---------------------------- */
function onNetMessage(m) {
  if (Net.isDisplay) {
    if (m.type === 'start') { lastConfig = m.config; runLocal(mergeConfig(m.config), { remote: true }); }
    else if (m.type === 'pause') session?.pause();
    else if (m.type === 'resume') session?.resume();
    else if (m.type === 'stop') { if (session) session.stop(); else showDisplayWait(); }
    else if (m.type === 'tap') session?.tap();
  } else if (Net.isController) {
    if (m.type === 'status') onRemoteStatus(m);
    else if (m.type === 'done') { showStats(m.stats, lastConfig || config); }
  }
}

function onNetChange() { syncConnUi(); renderSummary(); Pair.sync(); }

const MODE_NAMES = { relay: 'local server', online: 'online code', qr: 'QR pairing' };

function syncConnUi() {
  const btn = $('#connBtn'), label = $('#connLabel');
  const name = Net.mode === 'qr' ? 'QR display' : `Display ${Net.code}`;
  btn.classList.remove('on', 'wait');
  if (!Net.role) label.textContent = 'Connect';
  else if (Net.isDisplay) {
    label.textContent = Net.mode === 'qr' ? 'QR display' : `Display ${Net.code}`;
    btn.classList.add(Net.hasController || (Net.online && Net.mode !== 'qr') ? 'on' : 'wait');
  } else {
    label.textContent = Net.hasDisplay ? name : 'Finding display…';
    btn.classList.add(Net.hasDisplay ? 'on' : 'wait');
  }
  const rc = $('#remoteConn');
  rc.className = `pill ${Net.hasDisplay ? 'on' : 'wait'}`;
  rc.innerHTML = `<span class="dot"></span>${Net.hasDisplay ? name : 'Display offline'}`;

  if (Net.isDisplay) syncDisplayScreen();

  // dialog state
  $('#connIdle').hidden = !!Net.role; $('#connActive').hidden = !Net.role;
  $('#dispRelay').hidden = !Net.relayAvailable;
  $('#codeInput').placeholder = Net.relayAvailable ? '6-digit or local 4-digit code' : '123456';
  $('#connActiveText').innerHTML = !Net.role ? ''
    : Net.isDisplay ? `This device is the <b>big screen</b> (${MODE_NAMES[Net.mode]}${Net.mode === 'qr' ? '' : ` · code ${Net.code}`}) — ${Net.hasController ? 'remote connected ✓' : 'no remote yet'}.`
    : `Remote for ${Net.mode === 'qr' ? 'the QR-paired display' : `display <b>${Net.code}</b>`} (${MODE_NAMES[Net.mode]}) — ${Net.hasDisplay ? 'connected ✓' : 'looking for the display…'}`;
}

function syncDisplayScreen() {
  const st = $('#displayStatus');
  const codeMode = Net.mode !== 'qr';
  $('#displayCode').hidden = !codeMode;
  $('#displayCode').textContent = Net.code || '----';
  $('#displayHint').innerHTML = Net.mode === 'relay'
    ? 'On your phone, open this same address, tap <b>Connect</b> and enter:'
    : Net.mode === 'online' ? 'On your phone, open this app, tap <b>Connect</b> and enter:'
    : 'Paired with QR code.';
  $('#displayPairBtn').hidden = Net.mode !== 'qr' || Net.hasController;
  if (Net.hasController) { st.textContent = '✓ Remote connected — waiting for a drill'; st.className = 'status ok'; }
  else if (codeMode && !Net.online) { st.textContent = Net.mode === 'online' ? 'Connecting to the pairing service…' : 'Connecting to the local server…'; st.className = 'status'; }
  else { st.textContent = 'Waiting for a remote…'; st.className = 'status'; }
}

function showConnError(text) { $('#connError').textContent = text; $('#connError').hidden = !text; }

function bindConnect() {
  const dlg = $('#connDialog');
  $('#connBtn').addEventListener('click', () => {
    showConnError(location.protocol === 'file:' ? 'Open the app over http(s) — e.g. GitHub Pages or npm start — to connect devices.' : '');
    syncConnUi(); dlg.showModal();
  });
  $('#dispOnline').addEventListener('click', () => { dlg.close(); enterDisplayMode('online'); });
  $('#dispRelay').addEventListener('click', () => { dlg.close(); enterDisplayMode('relay'); });
  $('#dispQr').addEventListener('click', () => { dlg.close(); Pair.startDisplay(); });
  $('#ctrlQr').addEventListener('click', () => { dlg.close(); Pair.startController(); });
  const join = () => {
    const code = $('#codeInput').value.replace(/\D/g, '');
    let mode = null;
    if (code.length === TRANSPORTS.online.codeLength) mode = 'online';
    else if (code.length === TRANSPORTS.relay.codeLength && Net.relayAvailable) mode = 'relay';
    if (!mode) {
      showConnError(code.length === 4 ? '4-digit codes only work when the app is opened from the local server (npm start).'
        : 'Enter the code shown on the big screen.');
      return;
    }
    Net.start(mode, 'controller', code);
    dlg.close();
    toast(`Connecting to display ${code}…`);
    if (mode === 'relay') setTimeout(() => { if (Net.isController && !Net.hasDisplay) toast(`No display with code ${code} found yet`); }, 3000);
  };
  $('#joinBtn').addEventListener('click', join);
  $('#codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); join(); } });
  $('#disconnectBtn').addEventListener('click', () => {
    const wasDisplay = Net.isDisplay;
    Net.disconnect(); dlg.close();
    if (wasDisplay || !$('#remote').hidden) show('setup');
  });
}

/* -------------------------------- Init -------------------------------- */
buildSetup();
bindRunControls();
bindStats();
bindRemote();
bindDisplay();
bindConnect();
Pair.bind();
syncSetup();

Net.onMessage = onNetMessage;
Net.onChange = onNetChange;
Net.onError = toast;
syncConnUi();

// Offline support (service workers need HTTPS or localhost)
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker not registered', e));
}

// Detect the local relay, then restore a previous connection (e.g. after a reload)
Net.detectRelay().then(() => {
  const prev = Net.restore();
  if (prev?.role === 'display') showDisplayWait();
  syncConnUi();
});
