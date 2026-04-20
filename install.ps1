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

# ── Helper: prompt y/n ──────────────────────────────────────────────
function Confirm-Action {
    param([string]$Message)
    $answer = Read-Host "  $Message [y/N]"
    return ($answer -match '^[yY]')
}

# ── Helper: refresh PATH ────────────────────────────────────────────
function Refresh-Path {
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machinePath;$userPath"
}

# ── Check for git ───────────────────────────────────────────────────
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

# ── Check for Node.js ──────────────────────────────────────────────
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

# ── Clone or update the repo ────────────────────────────────────────
if (Test-Path $InstallDir) {
    Write-Host "  Updating existing installation..."
    Push-Location $InstallDir
    git pull --quiet
} else {
    Write-Host "  Cloning rogue-arena-mcp..."
    git clone --quiet $RepoUrl $InstallDir
    Push-Location $InstallDir
}

# ── Build the MCP server ────────────────────────────────────────────
Write-Host "  Installing dependencies..."
npm install --silent 2>$null

Write-Host "  Building MCP server..."
npm run build --silent

# tsc produces dist/cli.js; make it executable for the npm bin symlink.
# (This is a no-op on Windows file systems but harmless.) 2>$null

Write-Host "  Installing rogue-mcp CLI..."
npm install -g . --silent 2>$null

Pop-Location

# ── Verify CLI installed ────────────────────────────────────────────
Refresh-Path
if (-not (Get-Command rogue-mcp -ErrorAction SilentlyContinue)) {
    Write-Host ""
    Write-Host "  Package installed but 'rogue-mcp' not found on PATH."
    Write-Host "  You may need to restart your terminal."
    exit 1
}

# ── Check for Claude Code ───────────────────────────────────────────
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
    Write-Host "  Claude Code CLI not found."
    if (Confirm-Action "Install Claude Code via npm?") {
        npm install -g @anthropic-ai/claude-code 2>$null
        Refresh-Path
    } else {
        Write-Host "  Claude Code is required. Install it and re-run this script."
        exit 1
    }
}

Write-Host "  Claude Code CLI found."

# ── Register plugins via Claude Code's marketplace flow ─────────────
Write-Host "  Registering Rogue Arena plugins..."

$Plugins = @("rogue-build-scenario", "rogue-plugin-dev", "rogue-curriculum-builder", "rogue-active-deployment")
$pluginCount = $Plugins.Count

# Add marketplace (idempotent — update if already registered)
& claude plugin marketplace add $RepoUrl 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    & claude plugin marketplace update rogue-arena 2>$null | Out-Null
}

# Install each plugin
foreach ($plugin in $Plugins) {
    & claude plugin install "${plugin}@rogue-arena" | Out-Null
    Write-Host "    Installed: $plugin"
}

# ── Clean up legacy state from older installer versions ─────────────
$ClaudeDir = Join-Path $env:USERPROFILE ".claude"
$LegacyMcpFile = Join-Path $ClaudeDir "mcpjson.d\rogue-arena.json"
if (Test-Path $LegacyMcpFile) {
    Remove-Item $LegacyMcpFile -Force
}

# ── Configure MCP server ────────────────────────────────────────────
# Remove any existing rogue-arena entry before re-adding (idempotent)
claude mcp remove --scope user rogue-arena 2>$null | Out-Null

claude mcp add --scope user rogue-arena -- rogue-mcp serve

Write-Host "  MCP server configured."

# ── Done ─────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  Installed successfully!"
Write-Host ""
Write-Host "  What was installed:"
Write-Host "    - rogue-mcp CLI (MCP server)"
Write-Host "    - $pluginCount Rogue Arena plugins for Claude Code"
Write-Host "    - MCP server config (auto-connects on Claude Code start)"
Write-Host ""
Write-Host "  Next step:"
Write-Host "    rogue-mcp login"
Write-Host ""
Write-Host "  To update later, just re-run this script."
Write-Host ""
