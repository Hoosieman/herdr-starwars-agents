# Windows: (re)links bundle/ into the herdr home and makes herdr reload the mods.
# Folders get junctions, files get hard links. herdr hot-reloads a mod only when its folder under mods/
# changes, and edits or pulls change the repo copy instead, so each mod junction is re-made.
# Run in PowerShell 7 (pwsh), not Windows PowerShell.
$repo = $PSScriptRoot
$home_ = if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME } else { "$env:USERPROFILE\.config\herdr-app" }
foreach ($d in Get-ChildItem "$repo\bundle\mods" -Directory) {
  $link = "$home_\mods\$($d.Name)"
  $item = Get-Item $link -Force -ErrorAction SilentlyContinue
  if ($item -and $item.LinkType -eq 'Junction') { cmd /c rmdir "$link" }
  elseif ($item) { Write-Warning "$link is a real folder, not a link: left alone"; continue }
  Start-Sleep -Milliseconds 500
  New-Item -ItemType Junction -Path $link -Target $d.FullName | Out-Null
  "linked  $link"
}
foreach ($kind in 'layouts', 'themes') {
  foreach ($f in Get-ChildItem "$repo\bundle\$kind" -File) {
    $dst = "$home_\$kind\$($f.Name)"
    if (Test-Path $dst) { Remove-Item $dst -Force }
    New-Item -ItemType HardLink -Path $dst -Target $f.FullName | Out-Null
    "linked  $dst"
  }
}
