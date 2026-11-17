// Star Wars agents: every agent is a Star Wars character on a strip at the bottom of the window.
// Working ones march about and stop to fight (saber swings, blaster shots, roars, beeps),
// idle ones stroll and doze off, blocked ones stop and call for you. Working duellists that stop near
// a foe duel it (Jedi vs Sith or Grievous, Sith vs Sith). Hover one for its name and a move (a sleeper just stands up); drag one to move it.
// Click one to go to its agent; right-click to choose who it is.
// Sprites are local GIFs in sprites/<key>/ (tools/ rebuilds them): no downloads, no ImageMagick.
import { View, div, image } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { agents, spaces, theme, settings, run, props, shared, setShared, openOverlay, closeOverlay, nextCommand, notify } from "herdr";
import { CAST } from "./roster.js";
import { MASKS, CELL } from "./masks.js";

const MOD = "starwars-agents";
const KEY = "starwars-agents"; // shared state: { panes: { <pane id>: <cast key> } }
const DIR = `mods/${MOD}/sprites`;
const SLOT = 128; // width of one character's column
const LABEL_H = 18;
const DIM = 0.35; // opacity of sprites that are neither the active session nor hovered
const FEET = 24; // ground line, px above the strip's bottom
const SPEED = { working: 62, idle: 28 }; // px per second
const SLEEP_AFTER = 3 * 60 * 1000;
const ACT_MS = [1400, 2600]; // how long a working character fights between marches
const MIN_STOP = 1200; // a stop lasts at least this long; a quick attack then stands idle for the rest
const TAG_AHEAD = 400; // ms: labels about to collide hide this early (tick runs every 250 ms)
const BY_KEY = Object.fromEntries(CAST.map((c) => [c.key, c]));

// ---- who is who -------------------------------------------------------------------

const slotOf = (a) => a.pane || a.address;

function savedPicks() {
  const s = shared(KEY);
  return s && typeof s === "object" && s.panes && typeof s.panes === "object" ? s.panes : {};
}

function savePicks(update) {
  const next = { ...savedPicks(), ...update };
  const keys = Object.keys(next);
  for (let i = 0; i < keys.length - 300; i++) delete next[keys[i]];
  setShared(KEY, { panes: next });
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function assign(list) {
  const saved = savedPicks();
  const keys = {};
  const fresh = {};
  const used = new Set();
  for (const a of list) {
    const k = saved[slotOf(a)];
    if (BY_KEY[k]) { keys[a.address] = k; used.add(k); }
  }
  for (const a of list) {
    if (keys[a.address]) continue;
    let i = hash(slotOf(a)) % CAST.length;
    for (let n = 0; n < CAST.length && used.has(CAST[i].key); n++) i = (i + 1) % CAST.length;
    keys[a.address] = CAST[i].key;
    if (a.pane) fresh[a.pane] = CAST[i].key;
    used.add(CAST[i].key);
  }
  return { keys, fresh };
}

function tabsById() {
  const out = {};
  for (const s of spaces()) for (const t of s.tabs) out[t.id] = { ...t, space_name: s.name };
  return out;
}

function tagOf(a, tabs) {
  const t = tabs[a.tab];
  if (t?.named) return t.name;
  return a.space_name || a.tab_name || a.address;
}

function moodOf(a, tabs, now) {
  if (a.status === "blocked") return "blocked";
  if (a.status === "done") return "done";
  if (a.status === "working") return "working";
  const changed = tabs[a.tab]?.changed_at;
  return changed == null || now - changed > SLEEP_AFTER ? "sleep" : "idle";
}

// Picker order only: Jedi, then Sith, then troopers, droids and everyone else. CAST's own order
// stays as it is, because the default character for each agent is picked by position in CAST.
const PICKER_ORDER = [
  "obiwan", "anakin", "quigon", "mace", "luke", "kota",
  "dooku", "maul", "fallen", "starkiller",
  "clone", "commander", "cody", "grievous", "magnaguard", "battledroid", "superdroid", "destroyer",
  "assault", "padme",
];
const pickerRank = (k) => (PICKER_ORDER.includes(k) ? PICKER_ORDER.indexOf(k) : PICKER_ORDER.length);
const PICKER_CAST = [...CAST].sort((a, b) => pickerRank(a.key) - pickerRank(b.key));

function matches(query) {
  const f = query.trim().toLowerCase();
  return PICKER_CAST.filter((c) => !f || c.name.toLowerCase().includes(f) || c.key.includes(f));
}

// Duels: Jedi vs Sith, Sith vs Sith, and Jedi vs General Grievous. Never Jedi vs Jedi, never Grievous
// vs his Sith masters, and never troopers, droids or Padmé.
const SIDE = {
  obiwan: "jedi", anakin: "jedi", quigon: "jedi", mace: "jedi", luke: "jedi", kota: "jedi",
  dooku: "sith", maul: "sith", fallen: "sith", starkiller: "sith",
  grievous: "grievous",
};
const FOES = { jedi: ["sith", "grievous"], sith: ["jedi", "sith"], grievous: ["jedi"] };
const canDuel = (ka, kb) => !!SIDE[ka] && !!SIDE[kb] && FOES[SIDE[ka]].includes(SIDE[kb]);
const DUEL_RANGE = [50, 190]; // px between them: close enough to cross blades, not on top of each other
const DUEL_ROUNDS = 2;
const SEEK_CHANCE = 0.35; // share of a working Jedi/Sith's marches that head for an enemy

// Pick one of the character's attack sequences and start it; returns its length in ms (or undefined).
function startAct(m, c, now) {
  m.acting = true;
  m.actRoll = Math.random();
  m.actDur = c?.durs?.[`act${Math.floor(m.actRoll * (c?.acts || 1))}`];
  m.actStart = now;
  return m.actDur;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const zoom = () => (Number(settings()?.zoom) > 0 ? Number(settings().zoom) : 1);

// ---- the view -----------------------------------------------------------------------

export default class StarWarsAgents extends View {
  init(_p, cx) {
    this.picker = !!props()?.picker;
    if (this.picker) return this.initPicker(cx);
    this.width = 900;
    this.height = 120;
    this.chars = {}; // address -> { x, from, target, dir, moving, start, dur, pauseUntil, acting, saying, mood }
    this.hover = null;
    this.duels = []; // { a, b, round, next }: Jedi vs Sith exchanges in progress
    this.drag = null; // { address, sx, x0 } while a character is pressed
    cx.timer.every(250, (cx) => this.tick(cx));
    cx.spawn(async () => {
      for (;;) {
        const c = await nextCommand();
        if (c === "duel") { this.startDemoDuel(); continue; }
        if (c !== "pick") continue;
        const list = agents();
        const a = list.find((x) => x.focused) ?? list[0];
        if (a) this.openPicker(a, assign(list).keys[a.address], tagOf(a, tabsById()));
      }
    });
  }

  tick(cx) {
    const now = Date.now();
    const list = agents();
    const tabs = tabsById();
    const { keys, fresh } = assign(list);
    if (Object.keys(fresh).length) savePicks(fresh);

    const lo = SLOT / 2;
    const hi = Math.max(lo, this.width - SLOT / 2);
    let changed = false;
    const live = new Set();
    list.forEach((a, i) => {
      live.add(a.address);
      let m = this.chars[a.address];
      if (!m) {
        const x = clamp(((i + 0.5) / list.length) * this.width + rand(-20, 20), lo, hi);
        m = this.chars[a.address] = { x, from: x, target: x, dir: Math.random() < 0.5 ? "l" : "r", moving: false, start: 0, dur: 0, pauseUntil: now + rand(300, 2500), acting: false, saying: false, mood: null };
        changed = true;
      }
      if (m.paused) {
        // hovered: frozen until the pointer leaves (resume() picks it up); its hover move plays once, then idle
        if (m.acting && now >= m.actUntil) { m.acting = false; changed = true; }
        return;
      }
      const mood = moodOf(a, tabs, now);
      if (mood !== m.mood) { m.mood = mood; m.acting = false; m.saying = false; changed = true; }
      if (m.acting && now >= m.actUntil) { m.acting = false; changed = true; } // attack played once: hold in idle
      if (m.moving) {
        const f = clamp((now - m.start) / m.dur, 0, 1);
        if (m.target < lo || m.target > hi) {
          m.x = m.target = clamp(m.from + (m.target - m.from) * f, lo, hi);
          m.moving = false; m.dur = 150; m.pauseUntil = now + rand(1000, 3000); changed = true;
        } else if (f >= 1) {
          m.moving = false;
          m.x = m.target;
          // Arrived: drop the march's duration. Left in place, it becomes the slide time of the next
          // position change, so a strip that skipped renders (window hidden or minimised) would glide
          // a standing or sleeping character across at walking pace, away from where hitAt looks for it.
          m.dur = 150;
          if (mood === "working") {
            // A working character stops to fight before marching on.
            m.saying = false; // the name pill is for hover only (hoverAct)
            // Stop for exactly one play of the chosen attack, so it never loops.
            const dur = startAct(m, BY_KEY[keys[a.address]], now);
            m.actUntil = dur ? now + dur : Infinity;
            m.pauseUntil = now + (dur ? Math.max(dur, MIN_STOP) : rand(...ACT_MS));
            // Stopping near a working foe (see FOES) starts a duel instead.
            const foe = list.find((o) => o.address !== a.address && canDuel(keys[a.address], keys[o.address])
              && this.duelReady(this.chars[o.address], m.x));
            if (foe) this.duels.push({ a: a.address, b: foe.address, round: 0, next: now });
          } else {
            m.pauseUntil = now + rand(4000, 12000);
          }
          changed = true;
        } else if (mood !== "working" && mood !== "idle") {
          m.x = m.target = m.from + (m.target - m.from) * f;
          m.moving = false; m.dur = 150; changed = true;
        }
      } else if ((mood === "working" || mood === "idle") && now >= m.pauseUntil && hi > lo) {
        m.acting = false;
        m.saying = false;
        let target = rand(lo, hi);
        if (Math.abs(target - m.x) < 60) target = m.x + (target >= m.x ? 60 : -60);
        // Now and then a working duellist seeks out a working foe, stopping within reach on its near side.
        if (mood === "working" && SIDE[keys[a.address]] && Math.random() < SEEK_CHANCE) {
          const foes = list.filter((o) => o.address !== a.address && canDuel(keys[a.address], keys[o.address])
            && this.chars[o.address]?.mood === "working" && !this.chars[o.address].paused && !this.inDuel(this.chars[o.address]));
          const foe = foes.length && this.chars[foes[Math.floor(Math.random() * foes.length)].address];
          if (foe && Math.abs(foe.x - m.x) > DUEL_RANGE[1]) {
            const fx = foe.moving ? foe.target : foe.x; // meet it where it will stop
            target = fx + (m.x < fx ? -1 : 1) * rand(90, 140);
          }
        }
        target = clamp(target, lo, hi);
        if (Math.abs(target - m.x) >= 8) {
          m.from = m.x; m.target = target; m.dir = target > m.x ? "r" : "l"; m.walkRoll = Math.random();
          m.start = now; m.dur = (Math.abs(target - m.x) / SPEED[mood]) * 1000; m.moving = true;
        } else {
          m.pauseUntil = now + rand(1000, 3000);
        }
        changed = true;
      }
      if (!m.moving && (m.x < lo || m.x > hi)) { m.x = m.target = clamp(m.x, lo, hi); m.dur = 150; changed = true; }
    });
    for (const k of Object.keys(this.chars)) if (!live.has(k)) { delete this.chars[k]; changed = true; }
    if (this.duels.length && this.runDuels(keys, now)) changed = true;
    // A resting pointer never starts a hover (a character walking under it just walks on), but the
    // hovered one is let go if it's no longer under the pointer (its pose changed, or it was dropped away).
    if (this.pointer && this.hover && !this.drag && !this.hitAt(this.pointer, this.scale ?? 1, this.hover)) this.setHover(null, cx);
    const tags = [...this.placeTags(list, tabs, keys, now)].sort().join("|");
    if (tags !== this.tags) { this.tags = tags; changed = true; }
    if (changed) cx.notify();
  }

  // ---- duels: a Jedi and a Sith, both working, both standing within reach ----------------

  duelReady(o, x) {
    const d = o ? Math.abs(o.x - x) : 0;
    return !!o && o.mood === "working" && !o.moving && !o.paused && !this.inDuel(o) && d >= DUEL_RANGE[0] && d <= DUEL_RANGE[1];
  }

  inDuel(m) {
    return this.duels.some((d) => this.chars[d.a] === m || this.chars[d.b] === m);
  }

  // Both face each other and swing at the same moment, DUEL_ROUNDS times, then march on.
  // A duel ends early if either one stops working, is hovered or dragged, or leaves.
  runDuels(keys, now) {
    let changed = false;
    this.duels = this.duels.filter((d) => {
      const ma = this.chars[d.a];
      const mb = this.chars[d.b];
      // a called duel (the `duel` command) lets anyone awake fight, and waits while they walk together
      const fit = (m) => m && (d.called ? m.mood !== "sleep" : m.mood === "working") && !m.paused;
      if (d.called && d.round === 0 && fit(ma) && fit(mb) && (ma.moving || mb.moving)) return true;
      const on = (m) => fit(m) && !m.moving;
      if (!on(ma) || !on(mb) || d.round >= DUEL_ROUNDS) {
        if (now < d.next && on(ma) && on(mb)) return true; // last exchange still playing
        // send both on (Infinity would leave one that stopped working mid-duel standing forever)
        for (const m of [ma, mb]) if (m && (m.mood === "working" || m.pauseUntil === Infinity)) m.pauseUntil = now + rand(400, 900);
        return false;
      }
      if (now < d.next) return true;
      ma.dir = mb.x > ma.x ? "r" : "l";
      mb.dir = ma.x > mb.x ? "r" : "l";
      const da = startAct(ma, BY_KEY[keys[d.a]], now) || rand(...ACT_MS);
      const db = startAct(mb, BY_KEY[keys[d.b]], now) || rand(...ACT_MS);
      ma.actUntil = now + da;
      mb.actUntil = now + db;
      d.next = now + Math.max(da, db, MIN_STOP);
      ma.pauseUntil = mb.pauseUntil = Infinity; // runDuels sends them on when it ends
      d.round++;
      changed = true;
      return true;
    });
    return changed;
  }

  // `herdr-app do starwars-agents.duel`: the nearest awake pair of foes (see FOES) meet and duel now,
  // whatever their agents are doing. The one that can walk (working or idle) walks over; otherwise it slides.
  startDemoDuel() {
    const list = agents();
    const { keys } = assign(list);
    const now = Date.now();
    const awake = (a) => { const m = this.chars[a.address]; return m && m.mood !== "sleep" && !m.paused && !this.inDuel(m); };
    const ready = list.filter((a) => SIDE[keys[a.address]] && awake(a));
    let best = null;
    for (const j of ready) for (const s of ready) {
      if (j === s || !canDuel(keys[j.address], keys[s.address])) continue;
      const d = Math.abs(this.chars[j.address].x - this.chars[s.address].x);
      if (!best || d < best.d) best = { j: j.address, s: s.address, d };
    }
    if (!best) {
      notify({ title: "No duel", body: "Needs two awake foes on the strip: a Jedi and a Sith or Grievous, or two Sith.", level: "info", timeout: 3000 });
      return;
    }
    const walks = (m) => m.mood === "working" || m.mood === "idle";
    const [ma, mb] = [this.chars[best.j], this.chars[best.s]];
    const [mover, stay] = walks(ma) || !walks(mb) ? [ma, mb] : [mb, ma];
    const sx = stay.moving ? stay.from + (stay.target - stay.from) * clamp((now - stay.start) / stay.dur, 0, 1) : stay.x;
    if (stay.moving) { stay.x = stay.target = sx; stay.moving = false; stay.dur = 150; }
    stay.acting = mover.acting = false;
    const lo = SLOT / 2;
    const hi = Math.max(lo, this.width - SLOT / 2);
    let target = sx + (mover.x < sx ? -1 : 1) * 120;
    if (target < lo || target > hi) target = sx - (mover.x < sx ? -1 : 1) * 120;
    target = clamp(target, lo, hi);
    const mx = mover.moving ? mover.from + (mover.target - mover.from) * clamp((now - mover.start) / mover.dur, 0, 1) : mover.x;
    if (walks(mover) && Math.abs(target - mx) >= 8) {
      mover.from = mx; mover.target = target; mover.dir = target > mx ? "r" : "l"; mover.walkRoll = Math.random();
      mover.start = now; mover.dur = (Math.abs(target - mx) / SPEED.working) * 1000; mover.moving = true;
    } else {
      mover.x = mover.from = mover.target = target; mover.moving = false; mover.dur = 700; // slide over
    }
    ma.pauseUntil = mb.pauseUntil = Infinity;
    this.duels.push({ a: best.j, b: best.s, round: 0, next: now + (mover.moving ? 0 : 750), called: true });
  }

  // ---- dragging: press on a character and move it; a press without moving still clicks ----

  startDrag(address, e) {
    const m = this.chars[address];
    this.dragMoved = false;
    this.drag = m ? { address, sx: e.position.x, x0: m.x } : null;
  }

  dragMove(e, cx) {
    const d = this.drag;
    const m = d && this.chars[d.address];
    if (!m) return;
    const dx = (e.position.x - d.sx) / zoom();
    if (!this.dragMoved && Math.abs(dx) < 4) return;
    if (!this.dragMoved) {
      this.dragMoved = true;
      this.pause(m, Date.now());
      m.acting = false;
      m.saying = false;
      this.duels = this.duels.filter((x) => x.a !== d.address && x.b !== d.address);
    }
    const lo = SLOT / 2;
    const x = clamp(d.x0 + dx, lo, Math.max(lo, this.width - SLOT / 2));
    if (Math.abs(x - m.x) > 0.5) m.dir = x > m.x ? "r" : "l";
    m.x = m.from = m.target = x;
    m.dur = 1;
    cx.notify();
  }

  // Dropped: it stays there, stands a moment, then carries on from the new spot.
  endDrag(cx) {
    const d = this.drag;
    this.drag = null;
    const m = d && this.chars[d.address];
    if (!m || !this.dragMoved) return;
    if (m.paused) {
      m.paused.moving = false;
      m.paused.left = 0;
      m.pauseUntil = m.paused.at + rand(1500, 3000); // resume() shifts this by the hover/drag time
    }
    m.dur = 150;
    cx.notify();
  }

  // Hover freeze: stop where it stands (mid-march included) and stand idle; on leave, carry on
  // with the same march (direction, walk/run, target) or the same stop, its timers shifted by the pause.
  pause(m, now) {
    if (!m || m.paused) return;
    const p = { at: now, moving: m.moving, left: 0 };
    if (m.moving) {
      const f = clamp((now - m.start) / m.dur, 0, 1);
      m.x = m.from + (m.target - m.from) * f;
      p.left = m.dur * (1 - f);
      m.moving = false;
    }
    m.dur = 100; // settle the slide transition on the frozen spot
    m.paused = p;
  }

  resume(m, now) {
    const p = m?.paused;
    if (!p) return;
    m.paused = null;
    const d = now - p.at;
    m.pauseUntil += d;
    // the hover move replaced whatever was playing: carry on idle (or marching) without it
    m.acting = false;
    m.saying = false;
    if (p.moving && p.left > 0) {
      m.from = m.x; m.start = now; m.dur = p.left; m.moving = true;
    } else {
      m.dur = 150;
    }
  }

  setHover(next, cx) {
    if (next === this.hover || this.drag) return; // the dragged one keeps the hover until it's dropped
    const now = Date.now();
    this.resume(this.chars[this.hover], now);
    this.hover = next;
    this.pause(this.chars[next], now);
    this.hoverAct(next, now);
    cx.notify();
  }

  // Each hover plays one of the character's moves once (same pick as a stop), always with its line.
  hoverAct(address, now) {
    const m = this.chars[address];
    if (!m?.paused) return;
    const a = agents().find((x) => x.address === address);
    const c = a && BY_KEY[assign(agents()).keys[a.address]];
    m.saying = true;
    if (m.mood === "sleep") return; // a sleeper just stands up while hovered: no move
    const dur = startAct(m, c, now);
    m.actUntil = now + (dur || rand(...ACT_MS));
  }

  // What a character shows right now and where its image sits inside its SLOT-wide column.
  spriteOf(address, c, m, mood, scale) {
    const ground = this.height - FEET;
    const hoverActing = !!m.paused && m.acting;
    const anim = hoverActing ? "act" : mood === "sleep" && !m.paused ? "sleep" : m.paused ? "idle" : m.moving ? "walk" : m.acting ? "act" : "idle";
    // each stop picks one of the character's attack sequences, each march a walk or a run
    const seq = anim === "act" ? `act${Math.floor((m.actRoll ?? 0) * (c.acts || 1))}`
      : anim === "walk" ? `walk${Math.floor((m.walkRoll ?? 0) * (c.walks || 1))}` : anim;
    const path = anim === "sleep" ? `${DIR}/${c.key}/sleep.gif` : `${DIR}/${c.key}/${seq}-${m.dir}.gif`;
    const [w, h, cx] = c.dims?.[seq] ?? [c.w, c.h, c.cx]; // each animation has its own canvas
    const flip = m.dir !== "r" && anim !== "sleep"; // -l GIFs are mirrored -r ones
    const left = SLOT / 2 - (flip ? w - cx : cx) * scale;
    const lifted = this.dragMoved && this.drag?.address === address;
    const top = ground + 2 - h * scale - (lifted ? 10 : 0); // picked up while dragged
    return { hoverActing, anim, seq, path, w, h, left, top, flip };
  }

  // Whose sprite pixels are under the point (strip coordinates), topmost first: { address, seq } or null.
  // Masks combine an animation's frames, so a move's mask includes its whole saber sweep. A hover
  // therefore only starts on the body pose (walk, idle or sleep; a character mid-move counts by its
  // idle pose). The hovered one keeps the hover over its current pose (the hover move, sweep and all)
  // and the pose it was hovered on, so a move ending can't make the hover flicker on and off.
  // `only`: test just that character (to check the hovered one is still under the pointer).
  hitAt(p, scale, only) {
    if (!p) return null;
    const now = Date.now();
    const list = agents();
    const tabs = tabsById();
    const { keys } = assign(list);
    const at = (m) => (m.moving ? m.from + (m.target - m.from) * clamp((now - m.start) / m.dur, 0, 1) : m.x);
    const order = [...list].sort((a, b) => (this.chars[a.address]?.x ?? 0) - (this.chars[b.address]?.x ?? 0));
    for (const a of order.reverse()) {
      if (only && a.address !== only) continue;
      const m = this.chars[a.address];
      const c = BY_KEY[keys[a.address]];
      if (!m || !c) continue;
      const mood = m.mood ?? moodOf(a, tabs, now);
      const s = this.spriteOf(a.address, c, m, mood, scale);
      const rest = mood === "sleep" ? "sleep" : "idle";
      const seqs = this.hover === a.address ? [s.seq, this.hoverSeq ?? rest] : [s.anim === "act" ? rest : s.seq];
      const lift = this.dragMoved && this.drag?.address === a.address ? 10 : 0;
      for (const seq of seqs) {
        const mask = MASKS[c.key]?.[seq];
        if (!mask) continue;
        const [w, h, rows] = mask;
        const dims = c.dims?.[seq] ?? [c.w, c.h, c.cx];
        const flip = seq !== "sleep" && m.dir !== "r"; // -l GIFs are mirrored -r ones
        // every pose stands on the same feet, centred on its own body x (as spriteOf places it)
        const bx = at(m) - (flip ? dims[0] - dims[2] : dims[2]) * scale;
        const by = this.height - FEET + 2 - dims[1] * scale - lift;
        let x = Math.floor((p.x - bx) / scale);
        const y = Math.floor((p.y - by) / scale);
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        if (flip) x = w - 1 - x;
        const run = rows[Math.floor(y / CELL)];
        const cell = Math.floor(x / CELL);
        for (let i = 0; i < run.length; i += 2) if (cell >= run[i] && cell < run[i + 1]) return { address: a.address, seq };
      }
    }
    return null;
  }

  // Pointer moved: hover whatever is under it now (only a moving pointer starts a hover).
  pointAt(cx) {
    // the hovered one keeps it while still under the pointer, even with another character overlapping it
    if (this.hover && this.hitAt(this.pointer, this.scale ?? 1, this.hover)) return;
    const hit = this.hitAt(this.pointer, this.scale ?? 1);
    const next = hit?.address ?? null;
    if (next === this.hover) return;
    this.hoverSeq = hit?.seq;
    this.setHover(next, cx);
  }

  // Which name labels fit without overlapping, most important first. Checked at `now` and a little
  // ahead, so a label hides before two marching characters meet rather than after; tick() re-runs it
  // and redraws only when the set changes.
  placeTags(list, tabs, keys, now) {
    const at = (m, t) => (m.moving ? m.from + (m.target - m.from) * clamp((t - m.start) / m.dur, 0, 1) : m.x);
    const rank = (a) => (this.hover === a.address ? 0 : a.status === "blocked" ? 1 : a.status === "done" ? 2 : a.focused ? 3 : 4);
    const placed = [];
    const show = new Set();
    for (const a of [...list].sort((x, y) => rank(x) - rank(y))) {
      const m = this.chars[a.address];
      const xs = m ? [at(m, now), at(m, now + TAG_AHEAD)] : [this.width / 2, this.width / 2];
      const c = BY_KEY[keys[a.address]];
      const text = tagOf(a, tabs); // the label is always the agent's title; the name shows in the pill
      const half = Math.min(SLOT - 8, text.length * 6 + 18) / 2;
      const clear = (p) => xs.every((x, i) => x + half + 6 < p[i] - p[2] || x - half - 6 > p[i] + p[2]);
      if (placed.every(clear)) {
        placed.push([...xs, half]);
        show.add(a.address);
      }
    }
    return show;
  }

  openPicker(a, key, tag) {
    openOverlay({ mod: MOD, kind: "dialog", width: 640, height: 560, props: { picker: true, slot: slotOf(a), current: key, tag } });
  }

  render(cx) {
    return this.picker ? this.renderPicker(cx) : this.renderStrip(cx);
  }

  renderStrip(cx) {
    const t = theme();
    const configured = props()?.scale;
    const scale = Number.isFinite(configured) && configured > 0 ? configured : 1;
    this.scale = scale;
    const now = Date.now();
    const list = agents();
    const tabs = tabsById();
    const { keys } = assign(list);
    const ground = this.height - FEET;

    const root = div()
      .id("starwars-strip")
      .relative()
      .size_full()
      .overflow_hidden()
      .bg(t.chrome)
      .on_size_change((size, cx) => {
        const width = size.width / zoom();
        const height = size.height / zoom();
        if (Math.abs(width - this.width) > 1 || Math.abs(height - this.height) > 1) {
          this.width = width;
          this.height = height;
          cx.notify();
        }
      })
      // Pointer handling lives here, not on the characters' columns: a character is hovered,
      // clicked or dragged only where its sprite actually has pixels (see hitAt).
      .on_mouse_move((e, cx) => {
        this.pointer = { x: e.local_position.x / zoom(), y: e.local_position.y / zoom() };
        if (this.drag) this.dragMove(e, cx);
        if (!this.dragMoved || !this.drag) this.pointAt(cx);
      })
      .on_mouse_up("left", (_e, cx) => this.endDrag(cx))
      .on_hover((h, cx) => {
        if (h) return;
        this.pointer = null;
        this.endDrag(cx); // released outside the strip: drop it where it was last seen
        this.setHover(null, cx);
      })
      .when(!!this.hover, (el) => el.cursor_pointer())
      .on_mouse_down("left", (e) => { if (this.hover) this.startDrag(this.hover, e); })
      .on_click(() => {
        const a = !this.dragMoved && list.find((x) => x.address === this.hover);
        if (a) a.pane ? run("pane.focus", { pane: a.pane }) : run("agent.focus", { terminal: a.address });
      })
      .on_mouse_down("right", (_e, cx) => {
        const a = list.find((x) => x.address === this.hover);
        if (!a) return;
        cx.stop_propagation();
        this.openPicker(a, keys[a.address], tagOf(a, tabs));
      })
      .child(div().absolute().left(0).right(0).top(ground + 4).h(1).bg(t.border));

    if (list.length === 0) {
      return root.child(
        div().absolute().inset_0().flex().items_center().justify_center()
          .text_size(12).text_color(t.dim)
          .child("No agents yet. Each agent you start joins the battle here."),
      );
    }

    const order = [...list].sort((a, b) => (this.chars[a.address]?.x ?? 0) - (this.chars[b.address]?.x ?? 0));
    const showTag = this.placeTags(list, tabs, keys, now);

    for (const a of order) {
      const c = BY_KEY[keys[a.address]];
      const m = this.chars[a.address] ?? { x: this.width / 2, target: this.width / 2, dir: "r", moving: false, dur: 0 };
      const mood = m.mood ?? moodOf(a, tabs, now);
      const tag = tagOf(a, tabs);
      const hovered = this.hover === a.address;
      const x = m.moving ? m.target : m.x;

      const { hoverActing, anim, path, w, h, left, top } = this.spriteOf(a.address, c, m, mood, scale);
      const headY = ground - (anim === "sleep" ? 24 : c.tall) * scale;
      const shadowW = 34 * scale;
      // Only the active session and the hovered one are in full colour; the rest fade back
      // (the sprite and its shadow only, so a blocked ! or done ✓ above them stays loud).
      const lit = hovered || a.focused || this.drag?.address === a.address;
      const body = div().id(`sw-body-${a.address}`)
        .opacity(lit ? 1 : DIM)
        .transition("opacity", { duration: 180, easing: "ease-out" })
        .child(div().absolute().left(SLOT / 2 - shadowW / 2).top(ground - 1).w(shadowW).h(5 * scale).rounded_full().bg("#00000026"))
        .child(image(path).absolute().left(left).top(top).w(w * scale).h(h * scale));

      const bubble =
        hoverActing || (m.paused && m.saying && mood === "sleep") ? div().px(6).rounded(7).bg(t.popover).border_1().border_color(t.border)
            .text_color(t.foreground).text_size(10.5).child(c.name)
        : mood === "blocked" ? div().px(6).rounded(7).bg(t.blocked).text_color("#ffffff").font_bold().child("!")
            .loop("opacity", { from: 0.7, to: 1, period: 900 })
        : mood === "done" ? div().px(6).rounded(7).bg(t.done).text_color("#ffffff").font_bold().child("✓")
        : mood === "sleep" ? div().text_color(t.muted).frames(["z", "zZ", "zZz", "zZ"], 700)
        : m.saying ? div().px(6).rounded(7).bg(t.popover).border_1().border_color(t.border)
            .text_color(t.foreground).text_size(10.5).child(c.name)
        : null;

      const name = tag;
      root.child(
        div()
          .id(`sw-${a.address}`)
          .absolute().top(0).h_full().w(SLOT).left(x - SLOT / 2)
          // a march slides for the time it has LEFT, so a late render (strip hidden mid-march) catches up
          // with the model instead of replaying the whole march from a stale spot
          .transition("left", { duration: Math.max(1, Math.round(m.moving ? m.start + m.dur - now : m.dur || 150)), easing: "linear" })
          .child(body)
          .when(!!bubble, (el) =>
            el.child(h_flex().absolute().left(0).w(SLOT).top(Math.max(2, headY - 22)).justify_center().text_size(12.5).child(bubble)))
          .when(showTag.has(a.address), (el) => el.child(
            h_flex()
              .absolute().left(4).w(SLOT - 8).top(ground + 6).h(LABEL_H)
              .justify_center().items_center().gap(4)
              .child(div().flex_none().size(6).rounded_full().bg(t[a.status] ?? t.idle))
              .child(div().min_w(0).truncate().text_size(10.5).text_color(hovered || a.focused ? t.foreground : t.muted).child(name)),
          )),
      );
    }
    return root;
  }

  // ---- the picker (a dialog with props { picker, slot, current, tag }) ----------------

  initPicker(cx) {
    this.filter = "";
    this.input = InputState.new({ placeholder: "Search by name…" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); cx.notify(); });
    this.input.on("submit", () => {
      const shown = matches(this.input.value());
      if (shown.length === 1) this.choose(shown[0].key);
    });
    this.input.focus();
    cx.timer.after(300, () => this.input.focus());
  }

  choose(key) {
    const p = props();
    savePicks({ [p.slot]: key });
    closeOverlay(p.overlay);
  }

  renderPicker(cx) {
    const t = theme();
    const p = props() ?? {};
    const cur = BY_KEY[p.current];
    return v_flex()
      .id("starwars-picker")
      .size_full().min_h(0).p(18).gap(12).bg(t.popover)
      .child(
        h_flex().items_center().justify_between()
          .child(
            v_flex().min_w(0).gap(2)
              .child(div().text_size(15).font_semibold().text_color(t.foreground).child("Choose a character"))
              .child(div().text_size(11.5).text_color(t.muted).truncate().child(`for ${p.tag ?? "this agent"} · now ${cur?.name ?? "—"}`)),
          )
          .child(div().text_size(11).text_color(t.dim).child("Esc")),
      )
      .child(
        Input.new(this.input).h(34).flex_none().px(10).rounded(8).border_1().border_color(t.accent)
          .bg(t.background).text_size(12.5).text_color(t.foreground),
      )
      .child(
        div().flex_1().min_h(0).overflow_y_scrollbar().child(
          h_flex().flex_wrap().gap(6).children(
            matches(this.filter).map((c) => {
              const current = c.key === p.current;
              // icon.png is cropped to the character: shown at most 96x84, in proportion, centred.
              const k = Math.min(1, 84 / c.ih, 96 / c.iw);
              return v_flex()
                .id(`pick-${c.key}`)
                .w(110).h(116).flex_none().items_center().justify_end().gap(4).pb(6)
                .rounded(8).border_1()
                .border_color(current ? t.accent : "#00000000")
                .bg(current ? t.selected : "#00000000")
                .hover((s) => s.bg(t.hover))
                .cursor_pointer()
                .on_click(() => this.choose(c.key))
                .child(div().relative().w(100).h(84).flex_none().overflow_hidden().child(
                  image(`${DIR}/${c.key}/icon.png`).absolute().left(50 - c.iw * k / 2).top(84 - c.ih * k).w(c.iw * k).h(c.ih * k)))
                .child(div().w_full().px(2).text_center().truncate().text_size(11).text_color(t.foreground).child(c.name));
            }),
          ),
        ),
      );
  }
}
