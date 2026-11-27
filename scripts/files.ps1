# What the harness holds, and where each part lives on a computer. Dot-sourced by install.ps1 and
# export.ps1, so both always agree. Works in Windows PowerShell 5.1 and PowerShell 7.
#
# Anything specific to a computer or a project is kept in the repo as a placeholder. install.ps1 fills
# them in from harness.config.json, and export.ps1 puts the placeholders back:
#   {{HERDR_APP_HOME}}  Herdr app folder, forward slashes
#   {{REPO_FOLDER}}     config "folder": the project the board works on
#   {{TITLE}} {{OWNER}} {{PROJECT}} {{REPO}} {{LAYOUT}}  the config values of the same names
#   {{MOVE_COMMAND}}    config "moveCommand": how agents move their cards

function Get-HarnessParts([string]$HerdrAppHome, [string]$ClaudeHome, [string]$Layout) {
  @(
    # Kept as board.json in the repo; installed under the layout name from the config.
    @{ Name = 'Herdr layout'; Repo = 'herdr/layouts'; Live = "$HerdrAppHome/layouts"; Layout = $true
       Files = @('board.json', 'board.svg'); LiveNames = @{ 'board.json' = "$Layout.json"; 'board.svg' = "$Layout.svg" } },
    # gpui-kit.d.ts is the Herdr app's own editor typings (820 KB); install.ps1 copies Herdr's.
    @{ Name = 'Herdr mod issue-board'; Repo = 'herdr/mods/issue-board'; Live = "$HerdrAppHome/mods/issue-board"
       Exclude = @('gpui-kit.d.ts') },
    # state/ is written at run time by hook.mjs and is per computer.
    @{ Name = 'Board agent hooks'; Repo = 'herdr/issue-agent'; Live = "$HerdrAppHome/issue-agent"
       Files = @('hook.mjs', 'subagents.mjs', 'project-status.mjs', 'prompt.md', 'settings.json') },
    # .claude-plugin/types is Claude Code's API typings for the editor and tests (its own .gitignore says *).
    @{ Name = 'Claude Code mod usage-bar'; Repo = 'claude-code/usage-bar'; Live = "$ClaudeHome/skills/usage-bar"
       Exclude = @('.claude-plugin/types') }
  )
}

# The name a repo file has on the computer.
function Get-LiveName($Part, [string]$Rel) {
  if ($Part.LiveNames -and $Part.LiveNames.ContainsKey($Rel)) { return $Part.LiveNames[$Rel] }
  $Rel
}

# Repo-relative file names of a part that exist on one side. -Live lists the computer's copy.
function Get-PartFiles($Part, [string]$Root, [switch]$Live) {
  if ($Part.Files) {
    return $Part.Files | Where-Object {
      $name = if ($Live) { Get-LiveName $Part $_ } else { $_ }
      Test-Path -LiteralPath (Join-Path $Root $name)
    }
  }
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

# Copies one file, replacing each [from, to] pair in order in text files. Writes UTF-8 without a BOM
# and keeps line endings.
function Copy-HarnessFile([string]$From, [string]$To, [object[]]$Pairs) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $To) | Out-Null
  if ($TextExtensions -contains [IO.Path]::GetExtension($From).ToLower()) {
    $text = [IO.File]::ReadAllText($From)
    foreach ($pair in $Pairs) { if ($pair[0]) { $text = $text.Replace($pair[0], $pair[1]) } }
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

# Reads harness.config.json and checks that every value is there.
function Read-HarnessConfig([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "No $Path. Copy harness.config.example.json to harness.config.json and fill in your project (README.md, step 2)."
  }
  $c = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
  foreach ($key in 'layout', 'title', 'owner', 'project', 'repo', 'folder', 'moveCommand') {
    if (-not $c.$key) { throw "$Path has no ""$key""." }
  }
  if ($c.layout -notmatch '^[\w-]+$') { throw "$Path ""layout"" may hold only letters, digits, - and _." }
  $c.folder = ConvertTo-Slash $c.folder
  $c
}

# The placeholder of every value. Values that appear only inside the layout's JSON are matched with
# their key, so a short value such as a project number never replaces text elsewhere.
function Get-HarnessPairs($Config, [string]$HerdrAppHome) {
  @(
    , @('{{HERDR_APP_HOME}}', $HerdrAppHome)
    , @('{{REPO_FOLDER}}', $Config.folder)
    , @('{{MOVE_COMMAND}}', $Config.moveCommand)
    , @('"title": "{{TITLE}}"', ('"title": "' + $Config.title + '"'))
    , @('"owner": "{{OWNER}}"', ('"owner": "' + $Config.owner + '"'))
    , @('"repo": "{{REPO}}"', ('"repo": "' + $Config.repo + '"'))
    , @('"project": "{{PROJECT}}"', ('"project": ' + [int]$Config.project))
    , @('layouts/{{LAYOUT}}.svg', ('layouts/' + $Config.layout + '.svg'))
  )
}
