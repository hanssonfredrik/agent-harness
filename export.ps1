<#
.SYNOPSIS
  Copies the live Herdr layout and usage-bar mod from this computer into the repo, ready to commit.

.DESCRIPTION
  The reverse of install.ps1: this computer's folders and the project from harness.config.json become
  placeholders again, so the repo works on any computer and for any project. Files deleted on this
  computer are not deleted in the repo; remove those with git rm. Review with git diff before committing.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\export.ps1
#>
[CmdletBinding()]
param(
  # Defaults to harness.config.json next to this script.
  [string]$Config,
  [string]$HerdrAppHome,
  [string]$ClaudeHome
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/scripts/files.ps1"
# Windows PowerShell 5.1 has no $PSScriptRoot in parameter defaults, so the default is set here.
if (-not $Config) { $Config = "$PSScriptRoot/harness.config.json" }

$cfg = Read-HarnessConfig $Config
if (-not $HerdrAppHome) { $HerdrAppHome = Get-DefaultHerdrAppHome }
if (-not $ClaudeHome) { $ClaudeHome = Get-DefaultClaudeHome }
$HerdrAppHome = ConvertTo-Slash $HerdrAppHome
$ClaudeHome = ConvertTo-Slash $ClaudeHome

# Each pair turned around, in reverse order: a value that holds another (a move command naming the
# Herdr folder) is replaced before the value it holds.
$forward = Get-HarnessPairs $cfg $HerdrAppHome
$pairs = @()
for ($i = $forward.Count - 1; $i -ge 0; $i--) {
  if ($forward[$i][0] -ne '"project": "{{PROJECT}}"') { $pairs += , @($forward[$i][1], $forward[$i][0]) }
}
# The project number is a JSON number on the computer and a string placeholder in the repo. The comma
# after it keeps project 3 from matching project 30.
$n = [int]$cfg.project
$pairs += , @(('"project": ' + $n + ','), '"project": "{{PROJECT}}",')
$pairs += , @(('"project": "' + $n + '",'), '"project": "{{PROJECT}}",')

foreach ($part in Get-HarnessParts $HerdrAppHome $ClaudeHome $cfg.layout) {
  $files = @(Get-PartFiles $part $part.Live -Live)
  Write-Host ("{0,-28} {1} files <- {2}" -f $part.Name, $files.Count, $part.Live)
  foreach ($rel in $files) {
    Copy-HarnessFile (Join-Path $part.Live (Get-LiveName $part $rel)) (Join-Path (Join-Path $PSScriptRoot $part.Repo) $rel) $pairs
  }
}

# Anything of the project left in the repo means a value the placeholders don't cover.
$left = Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'herdr'), (Join-Path $PSScriptRoot 'claude-code') -Recurse -File |
  Select-String -SimpleMatch -Pattern $cfg.repo, $cfg.folder, $HerdrAppHome -List
if ($left) {
  Write-Warning 'These files still name your project or folders:'
  $left | ForEach-Object { Write-Warning "  $($_.Path):$($_.LineNumber)" }
}
Write-Host ''
Write-Host 'Done. Check git status and git diff, then commit.'
