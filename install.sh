#!/bin/sh
set -e

# Rogue Arena MCP Server + Skills Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/rogue-labs-cyber/rogue-arena-mcp/main/install.sh | sh

REPO_URL="https://github.com/rogue-labs-cyber/rogue-arena-mcp.git"
INSTALL_DIR="${HOME}/.rogue-arena-mcp"
NODE_MIN_VERSION=18

echo ""
echo "  Rogue Arena MCP Server Installer"
echo "  ================================="
echo ""

# ── Helper: prompt y/n ──────────────────────────────────────────────
confirm() {
  printf "  %s [y/N] " "$1"
  read -r answer < /dev/tty
  case "$answer" in
    [yY]|[yY][eE][sS]) return 0 ;;
    *) return 1 ;;
  esac
}

# ── Detect OS and package manager ───────────────────────────────────
OS="$(uname -s)"
PKG=""
case "$OS" in
  Darwin)
    if command -v brew >/dev/null 2>&1; then
      PKG="brew"
    fi
    ;;
  Linux)
    if command -v apt-get >/dev/null 2>&1; then
      PKG="apt"
    elif command -v dnf >/dev/null 2>&1; then
      PKG="dnf"
    elif command -v yum >/dev/null 2>&1; then
      PKG="yum"
    fi
    ;;
esac

# ── Check for git ───────────────────────────────────────────────────
if ! command -v git >/dev/null 2>&1; then
  echo "  git is not installed."
  if [ -n "$PKG" ]; then
    if confirm "Install git via $PKG?"; then
      case "$PKG" in
        brew) brew install git ;;
        apt)  sudo apt-get update -qq && sudo apt-get install -y -qq git ;;
        dnf)  sudo dnf install -y git ;;
        yum)  sudo yum install -y git ;;
      esac
    else
      echo "  git is required. Install it and re-run this script."
      exit 1
    fi
  else
    echo "  Install git from: https://git-scm.com"
    exit 1
  fi
fi

# ── Check for Node.js ──────────────────────────────────────────────
NEED_NODE=false
if ! command -v node >/dev/null 2>&1; then
  NEED_NODE=true
  echo "  Node.js is not installed."
else
  NODE_VERSION=$(node -v | sed 's/^v//' | cut -d. -f1)
  if [ "$NODE_VERSION" -lt "$NODE_MIN_VERSION" ]; then
    NEED_NODE=true
    echo "  Node.js v${NODE_VERSION} found, but v${NODE_MIN_VERSION}+ is required."
  fi
fi

if [ "$NEED_NODE" = true ]; then
  if [ -n "$PKG" ]; then
    if confirm "Install Node.js via $PKG?"; then
      case "$PKG" in
        brew) brew install node ;;
        apt)  sudo apt-get update -qq && sudo apt-get install -y -qq nodejs npm ;;
        dnf)  sudo dnf install -y nodejs npm ;;
        yum)  sudo yum install -y nodejs npm ;;
      esac
    else
      echo "  Node.js v${NODE_MIN_VERSION}+ is required. Install it and re-run this script."
      exit 1
    fi
  else
    echo "  Install Node.js (v${NODE_MIN_VERSION}+) from: https://nodejs.org"
    exit 1
  fi
  # Verify it worked
  if ! command -v node >/dev/null 2>&1; then
    echo "  Node.js installation failed. Install manually from https://nodejs.org"
    exit 1
  fi
fi

echo "  Node.js v$(node -v | sed 's/^v//') found."
echo "  git found."

echo ""

# ── Clone or update the repo ────────────────────────────────────────
# Self-heals if upstream history was rewritten (force-push): a plain git
# pull fails with "divergent branches"; fall through to a clean re-clone.
if [ -d "$INSTALL_DIR" ]; then
  echo "  Updating existing installation..."
  cd "$INSTALL_DIR"
  if ! git pull --quiet --ff-only 2>/dev/null; then
    echo "  Upstream history changed — re-cloning fresh..."
    cd /
    rm -rf "$INSTALL_DIR"
    git clone --quiet "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
  fi
else
  echo "  Cloning rogue-arena-mcp..."
  git clone --quiet "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# ── Build the MCP server ────────────────────────────────────────────
echo "  Installing dependencies..."
npm install --silent

echo "  Building MCP server..."
npm run build --silent

# tsc produces dist/cli.js without execute permissions; npm's bin symlink
# won't work without this chmod.
chmod +x dist/cli.js

echo "  Installing rogue-mcp CLI..."
npm install -g . --silent

# ── Verify CLI installed ────────────────────────────────────────────
if ! command -v rogue-mcp >/dev/null 2>&1; then
  echo ""
  echo "  Package installed but 'rogue-mcp' not found on PATH."
  echo "  You may need to add npm's global bin directory to your PATH."
  echo "  Try: npm bin -g"
  exit 1
fi

# ── Check for Claude Code ───────────────────────────────────────────
if ! command -v claude >/dev/null 2>&1; then
  echo "  Claude Code CLI not found."
  if confirm "Install Claude Code via npm?"; then
    npm install -g @anthropic-ai/claude-code
  else
    echo "  Claude Code is required. Install it and re-run this script."
    exit 1
  fi
fi

echo "  Claude Code CLI found."

# ── Register plugins via Claude Code's marketplace flow ─────────────
echo "  Registering Rogue Arena plugins..."

PLUGINS="rogue-build-scenario rogue-plugin-dev rogue-curriculum-builder rogue-active-deployment"
PLUGIN_COUNT=4

# Add marketplace (idempotent — ignore error if already registered)
claude plugin marketplace add "$REPO_URL" >/dev/null 2>&1 || true

# Refresh the marketplace's internal clone. Without this, claude plugin install
# reads stale files after an upstream force-push or normal update.
claude plugin marketplace update rogue-arena >/dev/null 2>&1 || true

# Clear stale plugin cache so renamed/deleted skills don't linger.
rm -rf "${HOME}/.claude/plugins/cache/rogue-arena"

# Install each plugin (idempotent — claude plugin install re-installs cleanly)
for plugin in $PLUGINS; do
  claude plugin install "${plugin}@rogue-arena" >/dev/null
  echo "    Installed: $plugin"
done

# ── Clean up legacy state from older installer versions ─────────────
CLAUDE_DIR="${HOME}/.claude"
LEGACY_MCP_FILE="${CLAUDE_DIR}/mcpjson.d/rogue-arena.json"
if [ -f "$LEGACY_MCP_FILE" ]; then
  rm -f "$LEGACY_MCP_FILE"
fi

# ── Configure MCP server ────────────────────────────────────────────
# Remove any existing rogue-arena entry before re-adding (idempotent)
claude mcp remove --scope user rogue-arena >/dev/null 2>&1 || true

claude mcp add --scope user rogue-arena -- rogue-mcp serve

echo "  MCP server configured."

# ── Done ─────────────────────────────────────────────────────────────
echo ""
echo "  Installed successfully!"
echo ""
echo "  What was installed:"
echo "    - rogue-mcp CLI (MCP server)"
echo "    - ${PLUGIN_COUNT} Rogue Arena plugins for Claude Code"
echo "    - MCP server config (auto-connects on Claude Code start)"
echo ""
echo "  Next step:"
echo "    rogue-mcp login"
echo ""
echo "  To update later, just re-run this script."
echo ""
