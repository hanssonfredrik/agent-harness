<#
.SYNOPSIS
  Copies the live Herdr layout and usage-bar mod from this computer into the repo, ready to commit.

.DESCRIPTION
  The reverse of install.ps1: this computer's paths become placeholders again, so the repo works on any
  computer. Files deleted on this computer are not deleted in the repo; remove those with git rm.
  Review with git diff before committing.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\export.ps1
#>
[CmdletBinding()]
param(
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

$swap = @{ $HerdrAppHome = '{{HERDR_APP_HOME}}'; $RepoFolder = '{{REPO_FOLDER}}' }

foreach ($part in Get-HarnessParts $HerdrAppHome $ClaudeHome) {
  $files = @(Get-PartFiles $part $part.Live)
  Write-Host ("{0,-28} {1} files <- {2}" -f $part.Name, $files.Count, $part.Live)
  foreach ($rel in $files) {
    Copy-HarnessFile (Join-Path $part.Live $rel) (Join-Path (Join-Path $PSScriptRoot $part.Repo) $rel) $swap
  }
}
Write-Host ''
Write-Host 'Done. Check git status and git diff, then commit.'
