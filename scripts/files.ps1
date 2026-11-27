# What the harness holds, and where each part lives on a computer. Dot-sourced by install.ps1 and
# export.ps1, so both always agree. Works in Windows PowerShell 5.1 and PowerShell 7.

# Machine-specific values are kept in the repo as placeholders. install.ps1 fills them in for the
# computer it runs on, and export.ps1 puts the placeholders back.
#   {{HERDR_APP_HOME}}  Herdr app folder, forward slashes (C:/Users/<you>/.config/herdr-app)
#   {{REPO_FOLDER}}     the project the board works on, forward slashes (C:/Projects/Venueve/MessengerApp)

function Get-HarnessParts([string]$HerdrAppHome, [string]$ClaudeHome) {
  @(
    @{ Name = 'Herdr layout'; Repo = 'herdr/layouts'; Live = "$HerdrAppHome/layouts"
       Files = @('natsumi.json', 'natsumi.svg') },
    # gpui-kit.d.ts is the Herdr app's own editor typings (820 KB); Herdr writes it into the mod.
    @{ Name = 'Herdr mod issue-board'; Repo = 'herdr/mods/issue-board'; Live = "$HerdrAppHome/mods/issue-board"
       Exclude = @('gpui-kit.d.ts') },
    # state/ is written at run time by hook.mjs and is per computer.
    @{ Name = 'Board agent hooks'; Repo = 'herdr/issue-agent'; Live = "$HerdrAppHome/issue-agent"
       Files = @('hook.mjs', 'subagents.mjs', 'prompt.md', 'settings.json') },
    # .claude-plugin/types is Claude Code's API typings for the editor and tests (its own .gitignore says *).
    @{ Name = 'Claude Code mod usage-bar'; Repo = 'claude-code/usage-bar'; Live = "$ClaudeHome/skills/usage-bar"
       Exclude = @('.claude-plugin/types') }
  )
}

# Files of a part, relative and with forward slashes, listed from $Root.
function Get-PartFiles($Part, [string]$Root) {
  if ($Part.Files) { return $Part.Files | Where-Object { Test-Path -LiteralPath (Join-Path $Root $_) } }
  if (-not (Test-Path -LiteralPath $Root)) { return @() }
  $base = (Resolve-Path -LiteralPath $Root).Path.TrimEnd('\', '/')
  Get-ChildItem -LiteralPath $base -Recurse -File -Force | ForEach-Object {
    $_.FullName.Substring($base.Length + 1).Replace('\', '/')
  } | Where-Object {
    $rel = $_
    -not ($Part.Exclude | Where-Object { $rel -eq $_ -or $rel.StartsWith("$_/") })
  }
}

$TextExtensions = @('.json', '.js', '.mjs', '.ts', '.tsx', '.md', '.svg')

# Copies one file, swapping strings in text files. Writes UTF-8 without a BOM and keeps line endings.
function Copy-HarnessFile([string]$From, [string]$To, [hashtable]$Swap) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $To) | Out-Null
  if ($TextExtensions -contains [IO.Path]::GetExtension($From).ToLower()) {
    $text = [IO.File]::ReadAllText($From)
    foreach ($key in $Swap.Keys) { $text = $text.Replace($key, $Swap[$key]) }
    [IO.File]::WriteAllText($To, $text, (New-Object Text.UTF8Encoding $false))
  } else {
    Copy-Item -LiteralPath $From -Destination $To -Force
  }
}

function ConvertTo-Slash([string]$Path) { $Path.Replace('\', '/').TrimEnd('/') }

function Get-DefaultHerdrAppHome {
  if ($env:HERDR_APP_HOME) { return ConvertTo-Slash $env:HERDR_APP_HOME }
  ConvertTo-Slash (Join-Path $HOME '.config/herdr-app')
}

function Get-DefaultClaudeHome {
  if ($env:CLAUDE_CONFIG_DIR) { return ConvertTo-Slash $env:CLAUDE_CONFIG_DIR }
  ConvertTo-Slash (Join-Path $HOME '.claude')
}
