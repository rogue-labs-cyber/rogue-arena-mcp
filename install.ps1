# Rogue Arena MCP Server + Skills Installer (Windows)
# Usage: irm https://raw.githubusercontent.com/rogue-labs-cyber/rogue-arena-mcp/main/install.ps1 | iex

$ErrorActionPreference = "Stop"

$RepoUrl = "https://github.com/rogue-labs-cyber/rogue-arena-mcp.git"
$InstallDir = Join-Path $env:USERPROFILE ".rogue-arena-mcp"
$NodeMinVersion = 18

Write-Host ""
Write-Host "  Rogue Arena MCP Server Installer"
Write-Host "  ================================="
Write-Host ""

# -- Helper: prompt y/n ----------------------------------------------
function Confirm-Action {
    param([string]$Message)
    $answer = Read-Host "  $Message [y/N]"
    return ($answer -match '^[yY]')
}

# -- Helper: refresh PATH --------------------------------------------
function Refresh-Path {
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machinePath;$userPath"
}

# -- Check for git ---------------------------------------------------
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "  git is not installed."
    if (Confirm-Action "Download and install Git for Windows?") {
        Write-Host "  Downloading Git for Windows..."
        $gitInstaller = Join-Path $env:TEMP "git-installer.exe"
        # Get latest Git for Windows release URL
        $gitRelease = Invoke-RestMethod "https://api.github.com/repos/git-for-windows/git/releases/latest"
        $gitUrl = ($gitRelease.assets | Where-Object { $_.name -match "64-bit\.exe$" -and $_.name -notmatch "portable" } | Select-Object -First 1).browser_download_url
        Invoke-WebRequest -Uri $gitUrl -OutFile $gitInstaller -UseBasicParsing
        Write-Host "  Installing Git (this may take a minute)..."
        Start-Process -FilePath $gitInstaller -ArgumentList "/VERYSILENT", "/NORESTART", "/NOCANCEL", "/SP-" -Wait
        Remove-Item $gitInstaller -Force
        Refresh-Path
        if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
            Write-Host "  Git installation failed. Install manually from https://git-scm.com"
            exit 1
        }
    } else {
        Write-Host "  git is required. Install it and re-run this script."
        exit 1
    }
}

# -- Check for Node.js ----------------------------------------------
$needNode = $false
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    $needNode = $true
    Write-Host "  Node.js is not installed."
} else {
    $nodeVersion = (node -v) -replace '^v', '' -split '\.' | Select-Object -First 1
    if ([int]$nodeVersion -lt $NodeMinVersion) {
        $needNode = $true
        Write-Host "  Node.js v$nodeVersion found, but v${NodeMinVersion}+ is required."
    }
}

if ($needNode) {
    if (Confirm-Action "Download and install Node.js LTS?") {
        Write-Host "  Downloading Node.js LTS..."
        $nodeInstaller = Join-Path $env:TEMP "node-installer.msi"
        Invoke-WebRequest -Uri "https://nodejs.org/dist/v22.16.0/node-v22.16.0-x64.msi" -OutFile $nodeInstaller -UseBasicParsing
        Write-Host "  Installing Node.js (this may take a minute)..."
        Start-Process msiexec.exe -ArgumentList "/i", $nodeInstaller, "/qn", "/norestart" -Wait
        Remove-Item $nodeInstaller -Force
        Refresh-Path
        if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
            Write-Host "  Node.js installation failed. Install manually from https://nodejs.org"
            exit 1
        }
    } else {
        Write-Host "  Node.js v${NodeMinVersion}+ is required. Install it and re-run this script."
        exit 1
    }
}

$nodeVer = (node -v) -replace '^v', ''
Write-Host "  Node.js v$nodeVer found."
Write-Host "  git found."
Write-Host ""

# -- Obtain the source -----------------------------------------------
# ROGUE_LOCAL_SRC lets a developer install from a local working copy
# (e.g. one uploaded to a test VM) instead of cloning from GitHub. When
# set, the clone/update is skipped and the build runs against that dir.
if ($env:ROGUE_LOCAL_SRC) {
    $InstallDir = $env:ROGUE_LOCAL_SRC
    Write-Host "  Using local source (ROGUE_LOCAL_SRC): $InstallDir"
    Push-Location $InstallDir
} else {
    # Self-heals if upstream history was rewritten: a fast-forward pull fails,
    # fall through to a clean re-clone.
    if (Test-Path $InstallDir) {
        Write-Host "  Updating existing installation..."
        Push-Location $InstallDir
        git pull --quiet --ff-only 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  Upstream history changed - re-cloning fresh..."
            Pop-Location
            Remove-Item -Recurse -Force $InstallDir
            git clone --quiet $RepoUrl $InstallDir
            Push-Location $InstallDir
        }
    } else {
        Write-Host "  Cloning rogue-arena-mcp..."
        git clone --quiet $RepoUrl $InstallDir
        Push-Location $InstallDir
    }
}

# -- Build the MCP server --------------------------------------------
Write-Host "  Installing dependencies..."
npm install --silent 2>$null

Write-Host "  Building MCP server..."
npm run build --silent

# tsc produces dist/cli.js; make it executable for the npm bin symlink.
# (This is a no-op on Windows file systems but harmless.) 2>$null

Write-Host "  Installing rogue-mcp CLI..."
npm install -g . --silent 2>$null

Pop-Location

# -- Verify CLI installed --------------------------------------------
Refresh-Path
if (-not (Get-Command rogue-mcp -ErrorAction SilentlyContinue)) {
    Write-Host ""
    Write-Host "  Package installed but 'rogue-mcp' not found on PATH."
    Write-Host "  You may need to restart your terminal."
    exit 1
}

# -- Detect target agent CLI(s): Claude Code and/or OpenAI Codex -----
# Register into whichever agent CLI is installed. We do NOT auto-install
# an agent - if neither is present, fail loud with hints.
$HaveClaude = [bool](Get-Command claude -ErrorAction SilentlyContinue)
$HaveCodex  = [bool](Get-Command codex  -ErrorAction SilentlyContinue)

if (-not $HaveClaude -and -not $HaveCodex) {
    Write-Host ""
    Write-Host "  No supported agent CLI found on PATH."
    Write-Host "  Rogue Arena MCP plugs into Claude Code or OpenAI Codex."
    Write-Host "  Install one, then re-run this installer:"
    Write-Host "    Claude Code:   npm install -g @anthropic-ai/claude-code"
    Write-Host "    OpenAI Codex:  npm install -g @openai/codex"
    exit 1
}

$Plugins = @("rogue-build-scenario", "rogue-plugin-dev", "rogue-curriculum-builder", "rogue-active-deployment", "rogue-auto-update")
$CodexSkillCount = 0

# -- Claude Code: marketplace plugins + user-scope MCP server --------
if ($HaveClaude) {
    Write-Host "  Claude Code CLI found - registering for Claude Code..."

    # Add marketplace (idempotent - ignore error if already registered)
    & claude plugin marketplace add $RepoUrl 2>$null | Out-Null
    # Refresh the marketplace clone so plugin install doesn't read stale files.
    & claude plugin marketplace update rogue-arena 2>$null | Out-Null
    # Clear stale plugin cache so renamed/deleted skills don't linger.
    $CacheDir = Join-Path $env:USERPROFILE ".claude\plugins\cache\rogue-arena"
    if (Test-Path $CacheDir) { Remove-Item -Recurse -Force $CacheDir }
    foreach ($plugin in $Plugins) {
        & claude plugin install "${plugin}@rogue-arena" | Out-Null
        Write-Host "    Installed plugin: $plugin"
    }

    # Clean up legacy state from older installer versions
    $LegacyMcpFile = Join-Path $env:USERPROFILE ".claude\mcpjson.d\rogue-arena.json"
    if (Test-Path $LegacyMcpFile) { Remove-Item $LegacyMcpFile -Force }

    # Register the MCP server (idempotent - remove any existing entry first)
    claude mcp remove --scope user rogue-arena 2>$null | Out-Null
    claude mcp add --scope user rogue-arena -- rogue-mcp serve
    Write-Host "  Claude Code: MCP server configured."
}

# -- OpenAI Codex: register the MCP server + copy skills -------------
if ($HaveCodex) {
    Write-Host "  Codex CLI found - registering for Codex..."
    # codex mcp add does a safe non-destructive merge into ~/.codex/config.toml.
    codex mcp remove rogue-arena 2>$null | Out-Null
    codex mcp add rogue-arena -- rogue-mcp serve
    Write-Host "  Codex: MCP server registered."

    # Skills: Codex has no plugin marketplace step here, so copy the skill
    # folders into ~/.codex/skills (global - Codex discovers them at startup).
    $CodexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE ".codex" }
    $CodexSkills = Join-Path $CodexHome "skills"
    $PluginsDir = Join-Path $InstallDir "plugins"
    if (Test-Path $PluginsDir) {
        New-Item -ItemType Directory -Force -Path $CodexSkills | Out-Null
        foreach ($pluginDir in Get-ChildItem -Path $PluginsDir -Directory) {
            $skillsRoot = Join-Path $pluginDir.FullName "skills"
            if (Test-Path $skillsRoot) {
                foreach ($skillDir in Get-ChildItem -Path $skillsRoot -Directory) {
                    if (Test-Path (Join-Path $skillDir.FullName "SKILL.md")) {
                        $dest = Join-Path $CodexSkills $skillDir.Name
                        # Refresh our skill (idempotent); leave other Codex skills alone.
                        if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
                        Copy-Item -Recurse -Force $skillDir.FullName $dest
                        # Co-locate the plugin's shared refs (refs/, reference/) so
                        # skill-relative "refs/..." paths resolve in Codex's flat layout.
                        foreach ($shared in @('refs','reference')) {
                            $sharedSrc = Join-Path $pluginDir.FullName $shared
                            if (Test-Path $sharedSrc) {
                                $sharedDest = Join-Path $dest $shared
                                New-Item -ItemType Directory -Force -Path $sharedDest | Out-Null
                                Copy-Item -Recurse -Force (Join-Path $sharedSrc '*') $sharedDest
                            }
                        }
                        Write-Host "    Installed skill: $($skillDir.Name)"
                        $CodexSkillCount++
                    }
                }
            }
        }
        Write-Host "  Codex: $CodexSkillCount skill(s) installed to $CodexSkills"
    } else {
        Write-Host "  Codex: no plugins/ dir in source - skipping skill copy."
    }
}

# -- Done -------------------------------------------------------------
Write-Host ""
Write-Host "  Installed successfully!"
Write-Host ""
Write-Host "  What was installed:"
Write-Host "    - rogue-mcp CLI (MCP server)"
if ($HaveClaude) {
    Write-Host "    - Claude Code: Rogue Arena plugins + user-scope MCP server"
}
if ($HaveCodex) {
    Write-Host "    - Codex: MCP server in ~/.codex/config.toml + $CodexSkillCount skill(s) in ~/.codex/skills"
}
Write-Host ""
Write-Host "  Next step (authenticate once - shared across both):"
Write-Host "    rogue-mcp login"
Write-Host ""
Write-Host "  To update later, just re-run this script."
Write-Host ""
