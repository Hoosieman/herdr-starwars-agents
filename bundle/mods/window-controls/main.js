// A thin title strip for layouts whose tab bar is drawn by another mod (starwars-chat, where
// Flockbook draws the tabs): the Claude usage saberstaff in the middle, then the Files panel toggle and, where the
// system draws none (Windows, Linux), minimize / maximize / close. The rest of the strip drags the window
// (window_drag).
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { run, theme, window, home, readTextFile } from "herdr";
import { LIMITS_FILE, parseLimits } from "./limits.js";
import { usageStaff } from "./usage-saber.js";

const stop = (_e, cx) => cx.stop_propagation();
const POLL_MS = 30000;
// Same as an agent row's context saber (saber-agents/main.js): out of the hilt in IGNITE_MS easing out, back in
// RETRACT_MS easing in.
const IGNITE_MS = 800;
const RETRACT_MS = 350;

export default class WindowControls extends View {
  init(_props, cx) {
    this.limits = null;
    this.hover = false;
    this.lit = null; // { at, dir }: the blades igniting (dir 1) or retracting (dir -1), while in motion
    this.load(cx);
    cx.timer.every(POLL_MS, (cx) => this.load(cx));
  }

  // Re-read and re-parse every poll even when the file is unchanged: the countdowns move and a passed reset refills
  // the window.
  load(cx) {
    cx.spawn(async (cx) => {
      let raw = null;
      try { raw = await readTextFile(`${home()}/${LIMITS_FILE}`); } catch (e) { console.log(`window-controls usage: ${e?.message ?? e}`); }
      this.limits = raw ? parseLimits(raw, Date.now()) : null;
      cx.notify();
    });
  }

  // The pointer enters or leaves the staff: start the blades moving from wherever they are now, and redraw about
  // every 30 ms until they settle.
  setHover(on, cx) {
    if (on === this.hover) return;
    const from = this.reach(), dir = on ? 1 : -1, ms = on ? IGNITE_MS : RETRACT_MS;
    // Start part-way along the new curve so a quick in-out doesn't jump: solve the curve for the current reach.
    const done = on ? 1 - Math.cbrt(1 - from) : Math.cbrt(1 - from);
    this.hover = on;
    this.lit = { at: Date.now() - done * ms, dir };
    const step = (cx) => {
      if (this.lit && Date.now() - this.lit.at >= (this.lit.dir > 0 ? IGNITE_MS : RETRACT_MS)) this.lit = null;
      cx.notify();
      if (this.lit) cx.timer.after(30, step);
      else this.ticking = false;
    };
    cx.notify();
    if (!this.ticking) { this.ticking = true; cx.timer.after(30, step); }
  }

  // How far the blades are out of the hilt, 0 to 1 (the same curves as saber-agents' reach()).
  reach() {
    const m = this.lit;
    if (!m) return this.hover ? 1 : 0;
    const f = Math.min(1, (Date.now() - m.at) / (m.dir > 0 ? IGNITE_MS : RETRACT_MS));
    return m.dir > 0 ? 1 - Math.pow(1 - f, 3) : 1 - Math.pow(f, 3);
  }

  render() {
    const t = theme(), w = window();
    const button = (id, child, action, title) => div().id(id).h(26).px(8).flex_none().flex().items_center().justify_center()
      .gap(6).rounded(6).text_size(12.5).text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(child);
    const icon = (name) => svg(`mods/tabs/${name}.svg`).size(16);
    // Two equal flex sides keep the staff centred in the strip whatever the buttons on the right take.
    return h_flex().size_full().px(8).gap(2).items_center().bg(t.chrome)
      .child(div().flex_1().min_w(0))
      .child(usageStaff(t, this.limits, this.reach(), (on, cx) => this.setHover(on, cx)))
      .child(h_flex().flex_1().min_w(0).gap(2).items_center().justify_end()
        .child(button("files", h_flex().gap(6).items_center().child(svg("mods/files/file.svg").size(14)).child("Files"),
          () => { run("layout.select", { stack: "panel-body", child: "files" }); run("layout.toggle", { id: "panel" }); }))
        .when(w?.buttons, (el) => el
          .child(button("minimize", w.platform === "windows" ? icon("win-min") : "−", () => run("window.minimize")))
          .child(button("maximize", w.platform === "windows" ? icon(w.maximized ? "win-restore" : "win-max") : "□", () => run("window.maximize")))
          .child(button("close-window", w.platform === "windows" ? icon("win-close") : "×", () => run("window.close")))));
  }
}
