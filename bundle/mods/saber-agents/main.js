// Agents in grouped or priority views; parents take their most urgent sub-agent's place.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, panes, focused, spaces, run, theme, shared, setShared, setAgentOrder, openOverlay, closeOverlay, props, window, layout, appHome, exec, hc, home, readTextFile } from "herdr";
import { stateMark, SECTION_NAMES, saberBar, saberTone, selectedEdge, contextLeft, hiltFor } from "./saber.js";
import { GLYPH, formatSession } from "./meters.js";

const TICK_MS = 30000;
import { bigModels, contextPercent } from "./usage.js";
import { helperFailure, helperReply, timed } from "./poll.js";
import { findSession, terminalFacts } from "./session.js";

// Per-agent meters: Oscar (prompt-cache countdown), Cookie (context %), Count (session time). Claude Code agents only.
// Polled here and published for saber-spaces, which shows them on the space; agent rows show none. A working agent's
// row shows its name only; the header sums states.
const POLL_MS = 15000;
// How far back to look for the tool call a working agent is on.
const DOING_WINDOW_MS = 30 * 60000;
// A "Needs you" wait turns red after this long.
const LONG_WAIT_MS = 10 * 60000;
const HC_MS = 8000;
const HELPER_MS = 20000;
const HELPER = () => `${appHome()}/mods/saber-agents/herd.py`;
const isClaude = (a) => a.program?.key === "claude" || a.app === "claude-code";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function leadPanes(all) {
  const leads = new Map();
  for (const p of all) {
    if (!p.terminal) continue;
    const current = leads.get(p.tab);
    // First agent, else first focused terminal, else first terminal in the tab.
    if (!current || (!current.program?.agent && (p.program?.agent || (!current.focused && p.focused)))) leads.set(p.tab, p);
  }
  return leads;
}

function title(tab, l) {
  const prog = l?.program?.name;
  const live = clean(l?.title);
  // clean() would strip a path's leading ~ or /: test the title with only its status glyph gone.
  const path = /^[~/]|^[A-Za-z]:\\/.test((l?.title ?? "").replace(/^[^\p{L}\p{N}~/]+/u, ""));
  const telling = live && live !== prog && !path && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
  return (tab.name === prog || !tab.named) && telling ? live : tab.name;
}
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// Docked (idle) rows are drawn faded so the active ones stand out; full again when focused or hovered.
const DOCKED_OPACITY = 0.5;
// How long a blade takes to extend from the hilt to its level when it ignites (hovering a row).
const IGNITE_MS = 800;
// How long a blade takes to slide back into its hilt (an agent leaves hyperspace, focus or the pointer leaves its row).
const RETRACT_MS = 350;
// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent, and the parent's done is the news.
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};
const SORTS = [
  { id: "priority", label: "Priority", icon: "clock" },
  { id: "grouped", label: "Grouped by space", icon: "layers" },
];
const sortOf = () => SORTS.find((s) => s.id === shared("agents.sort")) ?? SORTS[0];
const SECTION = SECTION_NAMES;
const SECTION_STATUS = { 4: "blocked", 3: "done", 2: "working" };
// States that keep a saber lit on their own: at work (humming) and awaiting orders (pulsing red).
const ACTIVE = new Set(["working", "blocked"]);

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// The row's leading mark is its state, by shape and color: a pulsing diamond
// needs you, a spinning arc is working, a dot is done, a ring is idle.
// Saber-spaces draws the same marks (keep the two in step).
export { stateMark };

export default class Agents extends View {
  init(_props, cx) {
    if (props()?.sortMenu) return;
    this.folded = new Set();
    // Each agent's last state and when it changed (ms), kept across restarts.
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    this.pendingPins = JSON.parse(localStorage.getItem("pins") ?? "[]");
    if (!this.pendingPins.length) localStorage.removeItem("pins");
    this.migratingPins = new Set();
    // Blades in motion: address -> { at, dir }. dir 1 ignites (grows from the hilt over IGNITE_MS), dir -1
    // retracts (slides back in over RETRACT_MS; drawn lit until it is gone).
    this.igniting = new Map();
    this.igniteTicking = false;
    // Meters: { address: { space, last, pct, started } }, published for saber-spaces as shared "saber.meters".
    this.meters = {};
    this.reading = false;
    this.pollMeters(cx);
    cx.timer.every(POLL_MS, (cx) => this.pollMeters(cx));
    // A data timer: every 30 s, enough for the times on the rows (no cache countdown is shown).
    const tick = (cx) => {
      cx.notify();
      cx.timer.after(TICK_MS, tick);
    };
    cx.timer.after(TICK_MS, tick);
  }

  pollMeters(cx) {
    if (this.reading) return;
    this.reading = true;
    cx.spawn(async (cx) => {
      try { await this.loadMeters(cx); } catch (e) { console.log(`saber-agents meters: ${e?.message ?? e}`); } finally { this.reading = false; }
    });
  }

  async loadMeters(cx) {
    const sleep = (ms) => cx.sleep(ms);
    const mine = agents().filter((a) => isClaude(a) && !a.address.includes("/"));
    const hcTimed = (args) => timed(hc(args), HC_MS, `hc ${args[0]}`, sleep);
    const found = {};
    const created = {};
    await Promise.all(mine.map(async (a) => {
      const facts = await terminalFacts({ hc: hcTimed }, a.address);
      created[a.address] = facts?.created_ms;
      found[a.address] = await findSession({ readTextFile, home, exec }, facts);
    }));
    const sessions = Object.entries(found).filter(([, s]) => s).map(([key, s]) => ({ key, dir: s.dir, id: s.sessionId, from: s.startedAt ?? 0 }));
    let reply = {};
    if (sessions.length) {
      const args = ["-I", "-S", HELPER(), "--since", String(Date.now() - DOING_WINDOW_MS)];
      for (const s of sessions) args.push("--session", JSON.stringify(s));
      try {
        const r = await timed(exec("python3", args), HELPER_MS, "herd.py", sleep);
        const out = helperReply(r, "herd.py", "sessions");
        if (out.error) console.log(`saber-agents: ${out.error}`);
        reply = out.value && typeof out.value === "object" ? out.value : {};
      } catch (e) { console.log(`saber-agents: ${helperFailure(e, "herd.py")}`); }
    }
    const big = bigModels(Object.values(reply).map((r) => r.context).filter(Boolean));
    const next = {};
    for (const a of mine) {
      const r = reply[a.address];
      if (!r) continue;
      const started = found[a.address]?.startedAt || created[a.address] || r.first || null;
      // events: [[started, code, length or null while running, label], ...], oldest first. The running one, else the last.
      const events = Array.isArray(r.events) ? r.events : [];
      const doing = ([...events].reverse().find((e) => e?.[2] == null) ?? events[events.length - 1])?.[3] ?? null;
      next[a.address] = { space: a.space, last: Number.isFinite(r.request) ? r.request : null, pct: contextPercent(r.context, big), tokens: Number(r.context?.tokens) || null, started, doing };
    }
    if (JSON.stringify(next) === JSON.stringify(this.meters)) return;
    this.meters = next;
    setShared("saber.meters", { terminals: next });
    cx.notify();
  }

  // Stamps agents whose state changed. Done and idle count as one: looking at a
  // finished agent turns done into idle, and looking isn't the agent doing anything.
  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    // Gone and old: the list alone is empty right after a start.
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  // Keep offline pins until their terminal returns, and keep each pending until
  // core echoes the label so a failed write doesn't erase the old pin.
  migratePins(all) {
    const listed = new Map(all.filter((t) => t.state === "live").map((t) => [t.address, t]));
    const pending = this.pendingPins.filter((address) => {
      const terminal = listed.get(address);
      if (!terminal) return true;
      if (terminal.labels?.["herdr.pinned"]) return false;
      if (!this.migratingPins.has(address)) {
        this.migratingPins.add(address);
        run("terminal.pin", { terminal: address, pinned: true });
      }
      return true;
    });
    if (pending.length === this.pendingPins.length) return;
    this.pendingPins = pending;
    if (pending.length) localStorage.setItem("pins", JSON.stringify(pending));
    else localStorage.removeItem("pins");
  }

  since(a) {
    return this.changed[a.address]?.at ?? 0;
  }

  // Starts a blade igniting (dir 1) or retracting (dir -1) and redraws about every 30 ms until every one is done.
  ignite(address, cx, dir = 1) {
    this.igniting.set(address, { at: Date.now(), dir });
    if (this.igniteTicking) return;
    this.igniteTicking = true;
    const step = (cx) => {
      const now = Date.now();
      for (const [k, m] of this.igniting) if (now - m.at >= (m.dir > 0 ? IGNITE_MS : RETRACT_MS)) this.igniting.delete(k);
      cx.notify();
      if (this.igniting.size) cx.timer.after(30, step);
      else this.igniteTicking = false;
    };
    cx.timer.after(30, step);
  }

  // How far a blade has extended, 0 to 1. Igniting eases out (shoots from the hilt, settles at its level);
  // retracting eases in (starts slow, then snaps into the hilt).
  reach(address) {
    const m = this.igniting.get(address);
    if (m == null) return 1;
    if (m.dir > 0) return 1 - Math.pow(1 - Math.min(1, (Date.now() - m.at) / IGNITE_MS), 3);
    return 1 - Math.pow(Math.min(1, (Date.now() - m.at) / RETRACT_MS), 3);
  }

  // A blade sliding back into its hilt: still drawn until it is in.
  retracting(address) {
    return this.igniting.get(address)?.dir < 0;
  }

  rank(a) {
    return RANK[a.status] ?? 0;
  }

  sortMenu(t) {
    const on = sortOf().id;
    return v_flex()
      .w_full()
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).child("Sort agents"))
      .children(SORTS.map((s) => h_flex()
        .id(`sort-${s.id}`)
        .h(31)
        .px(8)
        .gap(9)
        .rounded(7)
        .items_center()
        .text_color(t.foreground)
        .hover((el) => el.bg(t.hover))
        .on_click(() => {
          setShared("agents.sort", s.id);
          closeOverlay(props().overlay);
        })
        .child(svg(`mods/workspace-chrome/${s.icon}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().child(s.label))
        .when(s.id === on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14).flex_none().text_color(t.foreground)))));
  }

  peek(addr) {
    run("terminal.peek", { terminal: addr });
  }

  // Live sub-agents of `addr`, depth first, each with the tree lines in front of it.
  tree(all, addr, lead = []) {
    const kids = all.filter((k) => k.parent === addr && k.state === "live");
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [
        { t: k, lines: [...lead, last ? "└" : "├"] },
        ...this.tree(all, k.address, [...lead, last ? "" : "│"]),
      ];
    });
  }

  subRow(t, s, shown, compact) {
    const k = s.t;
    const st = kidStatus(k, this.listed);
    const on = k.address === shown;
    return h_flex()
      .id(`sub-${k.address}`)

      .when(st === "idle" && !on, (el) => el.opacity(DOCKED_OPACITY))
      .pl(39)
      .pr(8)
      .rounded(8)
      .h(26)
      .flex_none()
      .gap(0)
      .items_center()
      .text_size(12.5)
      .when(on, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(() => (this.listed.has(k.address) ? run("pane.focus", { terminal: k.address }) : this.peek(k.address)))
      .children(s.lines.map(l => div().self_start().mt(-4).w(9).h(17).mr(4).flex_none()
        .when(Boolean(l), el => el.border_l(1.5).border_color(t.input))
        .when(l === "└" || l === "├", el => el.border_b(1.5).rounded_bl(6))))
      .child(div().mr(8).child(stateMark(t, st)))
      .child(div().flex_1().truncate().text_color(on ? t.foreground : t.muted).child(k.name || k.template || k.program?.name || k.address));
  }

  // The state mark; folded headers and the narrow rail use it too.
  status(t, a) {
    return stateMark(t, a.status);
  }

  render(cx) {
    const t = theme();
    if (props()?.sortMenu) return this.sortMenu(t);
    const collapsed = narrow();
    const sort = sortOf();
    let list = agents();
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    const all = terminals();
    this.migratePins(all);
    const shown = focused()?.agent;
    const now = Date.now();
    this.track(list, now);
    // Sabers follow work and focus. Going into hyperspace (working) or awaiting orders (blocked) ignites an agent's
    // saber, focused or not; leaving both retracts it unless the row is still focused or hovered. When focus moves,
    // the row it leaves retracts (unless that agent is working or blocked) and the row it lands on ignites.
    const working = new Set(list.filter((a) => ACTIVE.has(a.status)).map((a) => a.address));
    const focusedNow = list.find((a) => a.focused)?.address ?? null;
    const first = this.wasWorking === undefined;
    for (const a of list) {
      const was = this.wasWorking?.has(a.address);
      const held = a.focused || this.hovered === a.address;
      if (working.has(a.address) && !was && !held) this.ignite(a.address, cx);
      if (!first && was && !working.has(a.address) && !held) this.ignite(a.address, cx, -1);
    }
    if (!first && focusedNow !== this.wasFocused) {
      const left = this.wasFocused;
      if (left && !working.has(left) && this.hovered !== left && list.some((a) => a.address === left)) this.ignite(left, cx, -1);
      if (focusedNow && !working.has(focusedNow) && this.hovered !== focusedNow) this.ignite(focusedNow, cx);
    }
    this.wasWorking = working;
    this.wasFocused = focusedNow;
    // A kept sub-agent (one with a pane) is in agents() too: where a tree shows
    // it, it gets no row of its own, unless it's pinned.
    const nested = new Set(collapsed ? [] : list.flatMap((a) => this.tree(all, a.address).map((s) => s.t.address)));
    list = list.filter((a) => a.pinned || !nested.has(a.address));
    const tabCounts = new Map();
    for (const a of list) tabCounts.set(a.tab, (tabCounts.get(a.tab) ?? 0) + 1);
    const byPriority = sort.id === "priority";
    const urgency = new Map(list.map((a) => [a.address, Math.max(this.rank(a), ...this.tree(all, a.address).map((s) => RANK[kidStatus(s.t, this.listed)] ?? 0))]));
    const rankOf = (a) => urgency.get(a.address);
    if (byPriority) list = [...list].sort((x, y) => rankOf(y) - rankOf(x) || this.since(y) - this.since(x) || y.seq - x.seq);
    const pinned = list.filter((a) => a.pinned);
    const rest = list.filter((a) => !a.pinned);
    list = [...pinned, ...rest];
    setAgentOrder(list.map((a) => a.address));

    const withKids = (a, i) => {
      const subs = collapsed ? [] : this.tree(all, a.address);
      const r = row(a, i, subs);
      if (this.folded.has(a.address)) return [r];
      return [r, ...subs.map((s) => this.subRow(t, s, shown, byPriority))];
    };

    // The fold chevron; folded, the count too, colored by the most urgent one.
    const fold = (a, subs) => {
      const sts = subs.map((s) => kidStatus(s.t, this.listed));
      const top = sts.reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);
      const open = !this.folded.has(a.address);
      return div()
        .id(`fold-${a.address}`)
        .h(18)
        .px(3)
        .gap(3)
        .flex()
        .items_center()
        .rounded(4)
        .text_size(11)
        .text_color(open ? t.dim : (t[top] ?? t.dim))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          open ? this.folded.add(a.address) : this.folded.delete(a.address);
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
        .when(!open, (el) => el.child(String(subs.length)));
    };

    // A row reads "space \u00b7 detail": the detail is a tab someone named or the
    // agent's own title, never an automatic tab number unless two rows would
    // otherwise read the same.
    // Read the pane snapshot once: every host read copies the whole list into JS.
    const leads = leadPanes(panes());
    const tabs = new Map(spaces().flatMap(s => s.tabs).map(tab => [tab.id, tab]));
    const labels = new Map(list.map(a => {
      const tab = tabs.get(a.tab);
      const many = tabCounts.get(a.tab) > 1;
      return [a.address, tab ? title(many ? { ...tab, named: false } : tab, many ? a : leads.get(a.tab)) : (a.title || a.program?.name || "")];
    }));
    const label = (a) => labels.get(a.address);
    const detail = new Map(list.map(a => [a.address, /^\d+$/.test(label(a)) ? null : label(a)]));
    const seen = {};
    for (const a of list) { const k = `${a.space_name}\u0000${detail.get(a.address) ?? ""}`; seen[k] = (seen[k] ?? 0) + 1; }
    for (const a of list) {
      if (detail.get(a.address) == null && seen[`${a.space_name}\u0000`] > 1) detail.set(a.address, label(a));
    }

    const row = (a, i, subs = []) => {
      const more = detail.get(a.address);
      // An agent on another machine (`vps/t7`) says which.
      const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
      if (collapsed) {
        return h_flex()
          .id(`ag-${a.address}`)

          .when(a.status === "idle" && !a.focused && this.hovered !== a.address, (el) => el.opacity(DOCKED_OPACITY))
          .h(26)
          .px(8)
          .flex_none()
          .items_center()
          .gap(4)
          .hover((s) => s.bg(t.hover))
          .on_click(() => run("pane.focus", { pane: a.pane }))
          .child(div().flex_1().min_w(0).whitespace_nowrap().text_right().text_color(t.muted).child(String(i + 1)))
          .child(h_flex().w(14).flex_none().items_center().justify_center().child(this.status(t, a)));
      }
      const when = this.since(a);
      const idle = a.status === "idle" && !a.focused;
      // How long it has waited on you: orange, red past 10 minutes.
      const waitColor = a.status === "blocked" ? (now - when >= LONG_WAIT_MS ? t.ansi1 : t.blocked) : t.dim;
      const isPinned = a.pinned;
      const pin = div()
        .id(`pin-${a.address}`)
        .flex_none()
        .p(2)
        .rounded(4)
        .text_color(t.dim)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(isPinned ? "Unpin" : "Pin to the top")
        .on_click((_e, cx) => {
          cx.stop_propagation();
          run("terminal.pin", { terminal: a.address, pinned: !isPinned });
          // The row moves away from under the pointer, and no hover-out comes.
          this.hovered = null;
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/${isPinned ? "pin-off" : "pin"}.svg`).size(13));
      // Under a space header the space goes without saying; an automatic tab number says nothing.
      // Without a space header above (priority, pinned) the row names its space.
      const full = byPriority || isPinned;
      // This agent's own meters, under its name. The saber is lit for the focused agent and every agent in
      // hyperspace (working); the others show the hilt and the faint track, and hovering one ignites it to its level. The context left shows small beside every blade.
      const m = this.meters[a.address];
      const lit = a.focused || this.hovered === a.address || ACTIVE.has(a.status) || this.retracting(a.address);
      const meterParts = [];
      // A Claude Code agent with no context reading yet (a new session, before its first answer) has its whole
      // context left: it shows a full blade at 100% rather than nothing.
      const pct = m?.pct ?? (isClaude(a) ? 0 : null);
      if (pct != null) {
        const left = contextLeft(pct);
        const color = t[saberTone(left)] ?? saberTone(left);
        // Awaiting orders: the blade is red and pulses. The percentage keeps the context colour either way.
        const blocked = a.status === "blocked";
        meterParts.push(saberBar(t, left, blocked ? t.blocked : color, lit, hiltFor(a.address), { reach: this.reach(a.address), hum: a.status === "working", pulse: blocked }));
        // A fixed, right-aligned slot so every row's percentage lines up, whatever the number ("5%" to "100%").
        meterParts.push(div().w(24).flex_none().text_right().whitespace_nowrap().text_size(9).text_color(color).opacity(0.8).child(`${left}%`));
      }
      const meterRow = !collapsed && meterParts.length ? h_flex().min_w(0).gap(6).items_center().children(meterParts) : null;
      // Just the agent's title (the tab name Auto Title gives it), never the space's folder path. A leading
      // "3 · " tab number is dropped; an untitled tab falls back to the program name.
      const raw = String(label(a) ?? "").replace(/^\d+\s*·\s*/, "").trim();
      const name = raw && !/^\d+$/.test(raw) ? raw : a.program?.name || a.title || raw;
      return h_flex()
        .id(`ag-${a.address}`)

        .when(a.status === "idle" && !a.focused && this.hovered !== a.address, (el) => el.opacity(DOCKED_OPACITY))
        .px(8)
        .h(meterRow ? 46 : 30)
        .flex_none()
        .rounded(8)
        .items_center()
        .gap(9)
        .relative()
        .when(a.focused, (el) => el.child(selectedEdge(t, SECTION_STATUS[rankOf(a) || RANK.idle] ?? "idle")))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_hover((on, cx) => {
          if (on && this.hovered !== a.address) {
            if (!a.focused && !ACTIVE.has(a.status)) this.ignite(a.address, cx);
          }
          if (on) this.hovered = a.address;
          else {
            // The pointer leaves: a blade lit only by the hover slides back in. Moving down a list, the row below
            // reports its hover-in before this row reports its hover-out, so this row may no longer be the
            // hovered one by now; it retracts either way, and only clears the hover if it still holds it.
            if (this.hovered === a.address) this.hovered = null;
            if (!a.focused && !ACTIVE.has(a.status)) this.ignite(a.address, cx, -1);
          }
          cx.notify();
        })
        .on_click(() => run("pane.focus", { pane: a.pane }))
        .child(div().id(`agent-fold-${a.address}`)
          .when(subs.length > 0, el => el.on_click((_e, cx) => {
            cx.stop_propagation();
            this.folded.has(a.address) ? this.folded.delete(a.address) : this.folded.add(a.address);
            cx.notify();
          })).child(stateMark(t, a.status)))
        .child(v_flex().flex_1().min_w(0).gap(2).justify_center()
          .child(h_flex().min_w(0).gap(5).items_center()
            .child(div().min_w(0).truncate().tooltip(name).text_color(a.focused ? t.foreground : t.muted).child(name)))
          .when(Boolean(meterRow), el => el.child(meterRow)))
        .when(Boolean(machine), el => el.child(div().text_size(10).text_color(t.dim).child(machine)))
        .when(subs.length > 0, el => el.child(fold(a, subs)))
        // One fixed slot for the time (or the pin button while hovered), so the saber and its percentage line up
        // on every row whatever the time reads ("1m", "48m") and don't move on hover.
        .child(h_flex().w(30).flex_none().justify_end().items_center()
          .when(this.hovered === a.address, el => el.child(pin))
          .when(this.hovered !== a.address && Boolean(when), el => el.child(div().flex_none().whitespace_nowrap().text_size(11).text_color(waitColor).when(a.status === "blocked", d => d.font_bold()).child(duration(now - when)))));
    };

    // Groups in list order: spaces (grouped) or priority sections. Agents of a
    // space are next to each other in agents(), so neighbours make a group.
    const groups = pinned.length ? [{ id: "pinned", label: "Pinned", status: null, members: pinned }] : [];
    for (const a of rest) {
      const r = rankOf(a) || RANK.idle;
      const id = byPriority ? `sec-${r}` : `sp-${a.space}`;
      if (groups.at(-1)?.id === id) groups.at(-1).members.push(a);
      else groups.push({ id, label: byPriority ? SECTION[r] : a.space_name || "", status: byPriority ? SECTION_STATUS[r] : null, members: [a] });
    }

    // A group's header; it folds the group. Folded, it says how many and the most urgent state.
    const header = (g) => {
      const open = !this.folded.has(g.id);
      const top = g.members.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);
      return h_flex()
        .id(g.id)
        .px(8)
        .mt(10)
        .pt(8)
        .h(34)
        .flex_none()
        .gap(6)
        .items_center()
        .text_size(13)
        .font_semibold()
        .cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => {
          open ? this.folded.add(g.id) : this.folded.delete(g.id);
          cx.notify();
        })
        .child(div().truncate().text_color(t[g.status] ?? t.dim).child(g.label))
        .when(byPriority || !open, (el) => el.child(div().text_color(t.dim).child(String(g.members.length))))
        .child(div().flex_1())
        .when(!open, (el) => el
          .when(!byPriority && top && top !== "idle", (el) => el.child(this.status(t, { status: top })))
          .child(svg("mods/workspace-chrome/chevron-right.svg").size(11).flex_none().text_color(t.dim)));
    };
    // The header's summary: how many agents in each state.
    const counts = {};
    for (const a of list) counts[a.status] = (counts[a.status] ?? 0) + 1;
    const summary = h_flex().gap(8).items_center()
      .children(["blocked", "working", "done", "idle"].filter((s) => counts[s]).map((s) => h_flex().gap(3).items_center()
        .child(stateMark(t, s))
        .child(div().text_size(11.5).text_color(s === "idle" ? t.dim : t[s]).child(String(counts[s])))));
    const rows = collapsed
      ? list.flatMap(withKids)
      : groups.flatMap((g) => [header(g), ...(this.folded.has(g.id) ? [] : g.members.flatMap(withKids))]);

    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(13)
      .when(!collapsed, (el) =>
        el.child(
          h_flex()
            .px(16)
            .h(41)
            .pt(14)
            .pb(5)
            .flex_none()
            .items_center()
            .justify_between()
            .child(div().text_size(11.5).font_medium().text_color(t.dim).child("Agents"))
            .child(h_flex().gap(10).items_center().child(summary).child(
              // New agent: the same menu the tab bar's + opened (terminal or any installed agent), as the
              // tab bar is gone from this layout. Sized like the Spaces header's +.
              div()
                .id("ag-new")
                .size(26)
                .flex_none()
                .flex()
                .items_center()
                .justify_center()
                .rounded(6)
                .text_color(t.dim)
                .hover((s) => s.bg(t.hover).text_color(t.foreground))
                .on_click(() => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 }))
                .tooltip("New agent")
                .child(svg("mods/workspace-chrome/plus.svg").size(14)),
            )),
        ),
      )
      .when(list.length === 0 && !collapsed, (el) =>
        el.child(div().px(12).text_size(12).text_color(t.dim).child("No agent status yet. Agents show up here when they report their status. Older versions and agents inside tmux may not.")),
      )
      .child(v_flex().id("ag-list").flex_1().min_h(0).px(collapsed ? 0 : 8).overflow_y_scrollbar().mode("always").children(rows))
      .when(collapsed, (el) =>
        el.child(
          h_flex()
            .h(28)
            .items_center()
            .justify_center()
            .child(
              div()
                .id("collapse")
                .text_size(13)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click(toggleSidebar)
                .child("»"),
            ),
        ),
      );
  }
}
