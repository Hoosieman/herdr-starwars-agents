# starwars-agents (herdr setup)

Personal herdr setup: the Star Wars sprites panel plus the saber-themed sidebar. Private on purpose:
the Star Wars sprites belong to Lucasfilm, so don't make this repo public or add the `herdr-mod` topic.

## What's in it

| Piece | Path in repo | Linked to (in `~/.config/herdr-app`) |
|-------|--------------|--------------------------------------|
| Sprites panel (this mod) | repo root | `mods/starwars-agents` (the clone itself) |
| Agents list with saber context bars | `bundle/mods/saber-agents` | `mods/saber-agents` |
| Spaces list | `bundle/mods/saber-spaces` | `mods/saber-spaces` |
| Title strip (Files toggle; window buttons on Windows) | `bundle/mods/window-controls` | `mods/window-controls` |
| Layout | `bundle/layouts/starwars.json` | `layouts/starwars.json` |
| Theme | `bundle/themes/saber-night.json` | `themes/saber-night.json` |

`saber-agents` and `saber-spaces` started as copies of Nolan Anderson's Sesame Street mods
(github.com/nolan-anderson/herdr-app). `herd.py`, `session.js` and `usage.js` come from his copy of a
third-party `herd` mod whose license isn't credited yet: another reason this repo stays private.
Nolan's status-bar mod is left out (it reads files only on his machine).

## Install on a Mac

```sh
# First time only (skip the clone if ~/.config/herdr-app/mods/starwars-agents already exists):
git clone https://github.com/Hoosieman/herdr-starwars-agents.git ~/.config/herdr-app/mods/starwars-agents
cd ~/.config/herdr-app/mods/starwars-agents && git pull && sh install.sh
```

`install.sh` symlinks everything under `bundle/` into the herdr home (moving any existing file aside as
`*.bak-<time>`), runs `herdr-app check`, and switches to the `starwars` layout.

Then add the sprite picker key to `~/.config/herdr-app/keys.json` (Option-Shift-S on a Mac):
`"alt-shift-s": "starwars-agents.pick"`

`saber-agents` reads context and cache times through `python3` (built into macOS).

## Update

```sh
git -C ~/.config/herdr-app/mods/starwars-agents pull
```

The links point into the repo, so a pull updates everything and herdr hot-reloads it. Re-run
`install.sh` only if a pull adds a new mod, layout or theme under `bundle/`.

## On Windows

Same layout, linked with junctions (folders) and hard links (files) instead of symlinks, so editing
`~/.config/herdr-app/mods/saber-agents/...` edits the repo copy directly.
