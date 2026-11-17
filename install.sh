#!/bin/sh
# Links the whole Star Wars herdr setup from this repo into the herdr home, so a later `git pull` updates it live:
#   bundle/mods/*     -> <home>/mods/<name>      (saber-agents, saber-spaces, window-controls)
#   bundle/layouts/*  -> <home>/layouts/<file>   (starwars.json)
#   bundle/themes/*   -> <home>/themes/<file>    (saber-night.json)
# Anything already there that isn't our link is moved aside to <name>.bak-<timestamp>, never deleted.
# Run again after a pull only if a NEW file appeared under bundle/. Safe to re-run.
set -eu

repo=$(cd "$(dirname "$0")" && pwd)
home=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
stamp=$(date +%Y%m%d-%H%M%S)

link() { # link <source in repo> <destination in herdr home>
  src=$1 dst=$2
  if [ -L "$dst" ] && [ "$(readlink "$dst")" = "$src" ]; then echo "ok      $dst"; return; fi
  if [ -e "$dst" ] || [ -L "$dst" ]; then mv "$dst" "$dst.bak-$stamp"; echo "backup  $dst.bak-$stamp"; fi
  mkdir -p "$(dirname "$dst")"
  ln -s "$src" "$dst"
  echo "linked  $dst"
}

for d in "$repo"/bundle/mods/*/; do
  name=$(basename "$d")
  link "$repo/bundle/mods/$name" "$home/mods/$name"
done
for kind in layouts themes; do
  for f in "$repo"/bundle/$kind/*; do
    [ -f "$f" ] && link "$f" "$home/$kind/$(basename "$f")"
  done
done

if command -v herdr-app >/dev/null 2>&1; then
  for d in "$repo" "$repo"/bundle/mods/*/; do herdr-app check "${d%/}" || true; done
  herdr-app do layout.switch '{"name":"starwars"}' >/dev/null 2>&1 && echo "switched to the starwars layout" || true
else
  echo "herdr-app not on PATH: switch layouts in herdr with ctrl-shift-l (or Cmd-Shift-L)."
fi
