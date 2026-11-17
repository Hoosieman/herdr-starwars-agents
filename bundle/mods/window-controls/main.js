// A thin title strip for layouts whose tab bar is drawn by another mod (starwars-chat, where
// Flockbook draws the tabs): the Files panel toggle and, where the system draws none (Windows,
// Linux), minimize / maximize / close. The rest of the strip drags the window (window_drag).
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { run, theme, window } from "herdr";

const stop = (_e, cx) => cx.stop_propagation();

export default class WindowControls extends View {
  render() {
    const t = theme(), w = window();
    const button = (id, child, action, title) => div().id(id).h(26).px(8).flex_none().flex().items_center().justify_center()
      .gap(6).rounded(6).text_size(12.5).text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(child);
    const icon = (name) => svg(`mods/tabs/${name}.svg`).size(16);
    return h_flex().size_full().px(8).gap(2).items_center().justify_end().bg(t.chrome)
      .child(button("files", h_flex().gap(6).items_center().child(svg("mods/files/file.svg").size(14)).child("Files"),
        () => { run("layout.select", { stack: "panel-body", child: "files" }); run("layout.toggle", { id: "panel" }); }))
      .when(w?.buttons, (el) => el
        .child(button("minimize", w.platform === "windows" ? icon("win-min") : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? icon(w.maximized ? "win-restore" : "win-max") : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? icon("win-close") : "×", () => run("window.close"))));
  }
}
