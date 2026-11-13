# starwars-agents (herdr mod)

Personal herdr mod. Private on purpose: the Star Wars sprites belong to Lucasfilm,
so don't make this repo public or add the `herdr-mod` topic.

## Install on another machine (macOS)

```sh
git clone https://github.com/Hoosieman/herdr-starwars-agents.git ~/.config/herdr-app/mods/starwars-agents
herdr-app check ~/.config/herdr-app/mods/starwars-agents
```

Then:

1. Add the picker key to `~/.config/herdr-app/keys.json` (Option-Shift-S on a Mac):
   `"alt-shift-s": "starwars-agents.pick"`
2. Add the panel to your layout (or add the mod from herdr). The Windows layout uses
   `{ "id": "starwars-agents", "mod": "starwars-agents" }`.

## Update

```sh
git -C ~/.config/herdr-app/mods/starwars-agents pull
```

herdr hot-reloads mods, so the change shows up without a restart.
