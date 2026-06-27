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

# ── Obtain the source ───────────────────────────────────────────────
# ROGUE_LOCAL_SRC lets a developer install from a local working copy
# (e.g. one uploaded to a test VM) instead of cloning from GitHub. When
# set, the clone/update is skipped and the build runs against that dir.
if [ -n "${ROGUE_LOCAL_SRC:-}" ]; then
  INSTALL_DIR="$ROGUE_LOCAL_SRC"
  echo "  Using local source (ROGUE_LOCAL_SRC): $INSTALL_DIR"
  cd "$INSTALL_DIR"
else
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

# ── Detect target agent CLI(s): Claude Code and/or OpenAI Codex ─────
# We register into whichever agent CLI is already installed. We do NOT
# auto-install an agent — if neither is present, fail loud with hints.
HAVE_CLAUDE=false
HAVE_CODEX=false
if command -v claude >/dev/null 2>&1; then HAVE_CLAUDE=true; fi
if command -v codex  >/dev/null 2>&1; then HAVE_CODEX=true; fi

if [ "$HAVE_CLAUDE" = false ] && [ "$HAVE_CODEX" = false ]; then
  echo ""
  echo "  No supported agent CLI found on PATH."
  echo "  Rogue Arena MCP plugs into Claude Code or OpenAI Codex."
  echo "  Install one, then re-run this installer:"
  echo "    Claude Code:   npm install -g @anthropic-ai/claude-code"
  echo "    OpenAI Codex:  npm install -g @openai/codex"
  exit 1
fi

PLUGINS="rogue-build-scenario rogue-plugin-dev rogue-curriculum-builder rogue-active-deployment rogue-auto-update"

# ── Claude Code: marketplace plugins + user-scope MCP server ────────
if [ "$HAVE_CLAUDE" = true ]; then
  echo "  Claude Code CLI found — registering for Claude Code..."

  # Add marketplace (idempotent — ignore error if already registered)
  claude plugin marketplace add "$REPO_URL" >/dev/null 2>&1 || true
  # Refresh the marketplace clone so plugin install doesn't read stale files.
  claude plugin marketplace update rogue-arena >/dev/null 2>&1 || true
  # Clear stale plugin cache so renamed/deleted skills don't linger.
  rm -rf "${HOME}/.claude/plugins/cache/rogue-arena"
  for plugin in $PLUGINS; do
    claude plugin install "${plugin}@rogue-arena" >/dev/null
    echo "    Installed plugin: $plugin"
  done

  # Clean up legacy state from older installer versions
  LEGACY_MCP_FILE="${HOME}/.claude/mcpjson.d/rogue-arena.json"
  if [ -f "$LEGACY_MCP_FILE" ]; then rm -f "$LEGACY_MCP_FILE"; fi

  # Register the MCP server (idempotent — remove any existing entry first)
  claude mcp remove --scope user rogue-arena >/dev/null 2>&1 || true
  claude mcp add --scope user rogue-arena -- rogue-mcp serve
  echo "  Claude Code: MCP server configured."
fi

# ── OpenAI Codex: register the MCP server in ~/.codex/config.toml ────
if [ "$HAVE_CODEX" = true ]; then
  echo "  Codex CLI found — registering for Codex..."
  # `codex mcp add` does a safe non-destructive merge into ~/.codex/config.toml.
  # Idempotent — remove any existing entry first (ignore if absent).
  codex mcp remove rogue-arena >/dev/null 2>&1 || true
  codex mcp add rogue-arena -- rogue-mcp serve
  echo "  Codex: MCP server registered."

  # Skills: Codex has no plugin marketplace, so copy the skill folders into
  # ~/.codex/skills (global — Codex discovers them at startup). Source is the
  # repo's plugins/ tree, present in the published repo.
  CODEX_SKILLS="${CODEX_HOME:-$HOME/.codex}/skills"
  CODEX_SKILL_COUNT=0
  if [ -d "$INSTALL_DIR/plugins" ]; then
    mkdir -p "$CODEX_SKILLS"
    for skill_dir in "$INSTALL_DIR"/plugins/*/skills/*/; do
      [ -d "$skill_dir" ] || continue
      [ -f "${skill_dir}SKILL.md" ] || continue
      skill_name=$(basename "$skill_dir")
      # Refresh our skill (idempotent); leave the user's other Codex skills alone.
      rm -rf "$CODEX_SKILLS/$skill_name"
      cp -R "$skill_dir" "$CODEX_SKILLS/$skill_name"
      # Co-locate the plugin's shared refs (refs/, reference/) into the skill so
      # skill-relative "refs/..." paths resolve in Codex's flat layout -- the
      # plugin root doesn't travel with a per-skill copy the way it does in
      # Claude Code's full-plugin install.
      plugin_root=$(dirname "$(dirname "$skill_dir")")
      for shared in refs reference; do
        if [ -d "$plugin_root/$shared" ]; then
          mkdir -p "$CODEX_SKILLS/$skill_name/$shared"
          cp -R "$plugin_root/$shared/." "$CODEX_SKILLS/$skill_name/$shared/"
        fi
      done
      echo "    Installed skill: $skill_name"
      CODEX_SKILL_COUNT=$((CODEX_SKILL_COUNT + 1))
    done
    echo "  Codex: $CODEX_SKILL_COUNT skill(s) installed to $CODEX_SKILLS"
  else
    echo "  Codex: no plugins/ dir in source — skipping skill copy."
  fi
fi

# ── Done ─────────────────────────────────────────────────────────────
echo ""
echo "  Installed successfully!"
echo ""
echo "  What was installed:"
echo "    - rogue-mcp CLI (MCP server)"
if [ "$HAVE_CLAUDE" = true ]; then
  echo "    - Claude Code: Rogue Arena plugins + user-scope MCP server"
fi
if [ "$HAVE_CODEX" = true ]; then
  echo "    - Codex: MCP server in ~/.codex/config.toml + ${CODEX_SKILL_COUNT} skill(s) in ~/.codex/skills"
fi
echo ""
echo "  Next step (authenticate once — shared across both):"
echo "    rogue-mcp login"
echo ""
echo "  To update later, just re-run this script."
echo ""
