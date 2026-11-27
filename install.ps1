<#
.SYNOPSIS
  Installs the Herdr Natsumi layout and the Claude Code usage-bar mod from this repo onto this computer.

.DESCRIPTION
  Copies every file to where Herdr and Claude Code read it, fills in this computer's paths, and backs up
  any file it replaces under ~/.agent-harness-backup/<time>/. Run state (layouts/.state, issue-agent/state,
  the usage-bar store) is never touched. Safe to run again after a git pull.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1

.EXAMPLE
  .\install.ps1 -RepoFolder D:/code/MessengerApp -WhatIf
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  # The project the board works on: where agents start and where Sub-agents looks.
  [string]$RepoFolder = 'C:/Projects/Venueve/MessengerApp',
  [string]$HerdrAppHome,
  [string]$ClaudeHome
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/scripts/files.ps1"

if (-not $HerdrAppHome) { $HerdrAppHome = Get-DefaultHerdrAppHome }
if (-not $ClaudeHome) { $ClaudeHome = Get-DefaultClaudeHome }
$HerdrAppHome = ConvertTo-Slash $HerdrAppHome
$ClaudeHome = ConvertTo-Slash $ClaudeHome
$RepoFolder = ConvertTo-Slash $RepoFolder

$swap = @{ '{{HERDR_APP_HOME}}' = $HerdrAppHome; '{{REPO_FOLDER}}' = $RepoFolder }
$backup = Join-Path $HOME ('.agent-harness-backup/' + (Get-Date -Format 'yyyyMMdd-HHmmss'))

Write-Host "Herdr app folder:  $HerdrAppHome"
Write-Host "Claude folder:     $ClaudeHome"
Write-Host "Project folder:    $RepoFolder"
Write-Host ''

$copied = 0; $backedUp = 0
foreach ($part in Get-HarnessParts $HerdrAppHome $ClaudeHome) {
  $src = Join-Path $PSScriptRoot $part.Repo
  $files = @(Get-PartFiles $part $src)
  Write-Host ("{0,-28} {1} files -> {2}" -f $part.Name, $files.Count, $part.Live)
  foreach ($rel in $files) {
    $to = Join-Path $part.Live $rel
    if (-not $PSCmdlet.ShouldProcess($to, 'Install')) { continue }
    if (Test-Path -LiteralPath $to) {
      $keep = Join-Path $backup ($part.Repo + '/' + $rel)
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $keep) | Out-Null
      Copy-Item -LiteralPath $to -Destination $keep -Force
      $backedUp++
    }
    Copy-HarnessFile (Join-Path $src $rel) $to $swap
    $copied++
  }
}

# Editor typings for the mod: the same file Herdr ships in its own agents mod. Only for editor help.
$typings = "$HerdrAppHome/mods/issue-board/gpui-kit.d.ts"
$shipped = "$HerdrAppHome/mods/agents/gpui-kit.d.ts"
if (-not (Test-Path -LiteralPath $typings) -and (Test-Path -LiteralPath $shipped) -and $PSCmdlet.ShouldProcess($typings, 'Copy typings')) {
  Copy-Item -LiteralPath $shipped -Destination $typings
}

Write-Host ''
Write-Host "Installed $copied files."
if ($backedUp) { Write-Host "Replaced files were backed up to $backup" }

# What the panels need at run time. Missing tools are reported, never installed.
$missing = @('herdr-app', 'hc', 'gh', 'node', 'claude') | Where-Object { -not (Get-Command $_ -ErrorAction SilentlyContinue) }
if ($missing) {
  Write-Warning ("Not on the PATH: " + ($missing -join ', ') + '. See README.md, "What you need".')
}
if (-not (Test-Path -LiteralPath $RepoFolder)) {
  Write-Warning "The project folder $RepoFolder does not exist. Clone the repo there or run again with -RepoFolder."
}

Write-Host ''
Write-Host 'Next: restart Claude Code (it loads usage-bar on start), then press ctrl-shift-l in Herdr and pick natsumi.'
