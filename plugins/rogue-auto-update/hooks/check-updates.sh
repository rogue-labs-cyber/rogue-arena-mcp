#!/bin/sh
# rogue-auto-update SessionStart hook.
# Prints a notice when MCP server or plugins are behind upstream. Silent otherwise.
# Any failure exits 0 with no output so it cannot break a session.
set -u

[ "${ROGUE_DISABLE_UPDATE_CHECK:-}" = "1" ] && exit 0

command -v curl >/dev/null 2>&1 || exit 0
command -v jq >/dev/null 2>&1 || exit 0

MCP_DIR="${HOME}/.rogue-arena-mcp"
CACHE="${MCP_DIR}/update-cache.json"
TTL_SECONDS=86400
NOW=$(date +%s)

REPO_RAW="https://raw.githubusercontent.com/rogue-labs-cyber/rogue-arena-mcp/main"
RELEASE_API="https://api.github.com/repos/rogue-labs-cyber/rogue-arena-mcp/releases/latest"
INSTALLER_CMD="curl -fsSL ${REPO_RAW}/install.sh | sh"

PLUGINS_TO_CHECK="rogue-build-scenario rogue-plugin-dev rogue-curriculum-builder rogue-active-deployment"

PLUGIN_CACHE_DIR=""
for candidate in \
  "${HOME}/.claude/plugins/cache/rogue-arena" \
  "${HOME}/.config/claude/plugins/cache/rogue-arena"; do
  if [ -d "$candidate" ]; then
    PLUGIN_CACHE_DIR="$candidate"
    break
  fi
done

read_local_mcp_version() {
  [ -f "${MCP_DIR}/package.json" ] || return 1
  jq -r '.version // empty' "${MCP_DIR}/package.json" 2>/dev/null
}

read_local_plugin_version() {
  plugin="$1"
  [ -n "$PLUGIN_CACHE_DIR" ] || return 1
  for f in "${PLUGIN_CACHE_DIR}/${plugin}"/*/.claude-plugin/plugin.json; do
    [ -f "$f" ] || continue
    v=$(jq -r '.version // empty' "$f" 2>/dev/null)
    [ -n "$v" ] && echo "$v" && return 0
  done
  return 1
}

cache_fresh() {
  [ -f "$CACHE" ] || return 1
  checked_at=$(jq -r '.checked_at // 0' "$CACHE" 2>/dev/null)
  [ -n "$checked_at" ] || return 1
  age=$((NOW - checked_at))
  [ "$age" -lt "$TTL_SECONDS" ]
}

fetch_remote() {
  mcp_latest=$(curl -fsSL --max-time 3 "${REPO_RAW}/package.json" 2>/dev/null | jq -r '.version // empty' 2>/dev/null)
  [ -n "$mcp_latest" ] || return 1

  marketplace=$(curl -fsSL --max-time 3 "${REPO_RAW}/.claude-plugin/marketplace.json" 2>/dev/null)
  [ -n "$marketplace" ] || return 1

  plugins_latest=$(printf '%s' "$marketplace" | jq -c '[.plugins[] | {(.name): .version}] | add' 2>/dev/null)
  [ -n "$plugins_latest" ] && [ "$plugins_latest" != "null" ] || return 1

  release=$(curl -fsSL --max-time 3 "$RELEASE_API" 2>/dev/null)
  release_body=$(printf '%s' "$release" | jq -r '.body // ""' 2>/dev/null)
  release_tag=$(printf '%s' "$release" | jq -r '.tag_name // ""' 2>/dev/null)

  mkdir -p "$MCP_DIR"
  jq -n \
    --argjson checked_at "$NOW" \
    --arg mcp_latest "$mcp_latest" \
    --argjson plugins_latest "$plugins_latest" \
    --arg release_body "$release_body" \
    --arg release_tag "$release_tag" \
    '{checked_at: $checked_at, mcp_latest: $mcp_latest, plugins_latest: $plugins_latest, release_body: $release_body, release_tag: $release_tag}' \
    > "$CACHE" 2>/dev/null || return 1
}

semver_lt() {
  [ "$1" = "$2" ] && return 1
  earlier=$(printf "%s\n%s\n" "$1" "$2" | sort -V | head -n 1)
  [ "$earlier" = "$1" ]
}

if ! cache_fresh; then
  fetch_remote || exit 0
fi
[ -f "$CACHE" ] || exit 0

mcp_latest=$(jq -r '.mcp_latest // empty' "$CACHE" 2>/dev/null)
release_body=$(jq -r '.release_body // ""' "$CACHE" 2>/dev/null)
release_tag=$(jq -r '.release_tag // ""' "$CACHE" 2>/dev/null)

diffs=""

mcp_local=$(read_local_mcp_version) || mcp_local=""
if [ -n "$mcp_local" ] && [ -n "$mcp_latest" ] && semver_lt "$mcp_local" "$mcp_latest"; then
  diffs="${diffs}
  MCP server:           ${mcp_local}  →  ${mcp_latest}"
fi

for plugin in $PLUGINS_TO_CHECK; do
  local_v=$(read_local_plugin_version "$plugin") || continue
  latest_v=$(jq -r --arg p "$plugin" '.plugins_latest[$p] // empty' "$CACHE" 2>/dev/null)
  [ -n "$local_v" ] && [ -n "$latest_v" ] || continue
  if semver_lt "$local_v" "$latest_v"; then
    padded=$(printf "%-21s" "${plugin}:")
    diffs="${diffs}
  ${padded} ${local_v}  →  ${latest_v}"
  fi
done

if [ -n "$diffs" ]; then
  echo "═══════════════════════════════════════════════════════════════"
  echo "Rogue Arena update available"
  printf '%s\n' "$diffs"
  if [ -n "$release_tag" ] && [ -n "$release_body" ]; then
    echo ""
    echo "What's new in ${release_tag}:"
    printf '%s' "$release_body" | head -c 500
    echo ""
  fi
  echo ""
  echo "To update, run:"
  echo "  ${INSTALLER_CMD}"
  echo "═══════════════════════════════════════════════════════════════"
fi

exit 0
