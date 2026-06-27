# Rogue Arena MCP Server + Skills

Connect **Claude Code** or **OpenAI Codex** to your [Rogue Arena](https://roguelabs.io) workspace. This repo includes:

- **MCP Server** -- authenticated proxy that gives your agent access to your canvases, deployments, plugins, and more
- **4 Skills** -- teach your agent how to build scenarios, develop plugins, create curriculum, and operate on live deployments
- **Auto-update notifier** (Claude Code) -- a SessionStart hook that pops a notice in your terminal whenever your installed MCP server or any plugin is behind the public GitHub repo, with the one-line update command. Silent when you're up to date.

## Install

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/rogue-labs-cyber/rogue-arena-mcp/main/install.sh | sh
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/rogue-labs-cyber/rogue-arena-mcp/main/install.ps1 | iex
```

The installer checks for Node.js 18+ and git, then detects which agent CLI you have installed -- **Claude Code, OpenAI Codex, or both** -- and wires up whichever it finds. (If neither is installed, it stops and tells you how to get one -- it won't install an agent for you.) It builds the MCP server, registers it with your agent(s), and installs the skills.

Then authenticate:

```bash
rogue-mcp login
```

A browser window opens for you to sign in with your Rogue Arena account. Your token is stored in your OS keychain and auto-refreshes for **31 days**. Login is shared across both agents -- you only do it once.

That's it. Restart your agent (Claude Code or Codex) and you're set.

> **Skills vs. tools:** the skills install and autocomplete right away, login or not. The MCP **tools** only show up after `rogue-mcp login` -- until then the server runs in a limited mode that exposes a single `rogue_auth_status` tool. If the tools aren't there, you're either not logged in or you need to restart your agent after logging in.

## What Gets Installed

### MCP Server

The `rogue-mcp` CLI connects your agent (Claude Code or Codex) to the Rogue Arena hub at `arena.roguelabs.io`. It proxies tool calls with your authentication, so your agent can:

- Read and modify canvases (machines, VLANs, plugins, forests)
- Manage deployments (start, monitor, debug)
- Upload/download files to VMs
- Work with curriculum content
- Develop and test Ansible plugins

The server is registered per-agent:

- **Claude Code** -- added to your user config (`claude mcp add --scope user`).
- **Codex** -- added to `~/.codex/config.toml` under `[mcp_servers.rogue-arena]`.

### Skills

| Skill | What it does |
|-------|-------------|
| **rogue-build-scenario** | Design lab scenarios -- brainstorm company context and infrastructure, implement via MCP tools, debug deployments |
| **rogue-active-deployment** | Operate on running deployments -- execute commands, browse files, manage snapshots, test payloads against detections |
| **rogue-plugin-dev** | Develop Ansible plugins -- brainstorm offline install approaches, write YAML, manage vaults |
| **rogue-curriculum-builder** | Build course content -- create chapters, sections, CTF nodes, insert media |

**In Claude Code**, skills install as plugins and activate automatically when you ask for something matching their triggers (e.g., "build a lab", "test this payload", "create a chapter").

**In Codex**, skills are copied to `~/.codex/skills/` and surfaced on demand -- invoke one with `$<skill-name>`, browse them with `/skills`, or just describe what you want and Codex matches by the skill's description.

## Typical Workflow

```
You:    "Build me a lab with a small financial company, 2 domains, 5 machines"
Agent:  [activates rogue-build-scenario, brainstorms with you, builds via MCP tools]

You:    "Deploy it and upload my C2 implant to the Windows workstation"
Agent:  [activates rogue-active-deployment, deploys, uploads file]

You:    "Test the implant against detections"
Agent:  [activates rogue-maldev, snapshots, executes, checks Elastic, reverts]
```

## Commands

```bash
rogue-mcp login     # Authenticate with Rogue Arena (shared across agents)
rogue-mcp logout    # Sign out and revoke token
rogue-mcp whoami    # Check auth status
rogue-mcp serve     # Start the MCP server (your agent does this automatically)
```

## File Access

Upload and download tools can read/write files on your local machine. Claude Code prompts you before each file operation. The server blocks access to sensitive directories (`~/.ssh`, `~/.aws`, `~/.gnupg`, etc.) as a safety net.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ROGUE_HUB_URL` | `https://arena.roguelabs.io` | Hub API URL |
| `ROGUE_VAULTS_URL` | Same as hub URL | Vaults service URL |
| `ROGUE_CLIENT_ID` | `rogue-mcp` | Keycloak client ID |
| `ROGUE_DISABLE_UPDATE_CHECK` | unset | Set to `1` to silence the auto-update notifier (Claude Code) |

## Updating

In Claude Code, you don't need to remember to update -- the auto-update notifier checks GitHub once per session (cached for 24h) and surfaces a notice when your MCP server or any plugin is behind. It will offer to run the installer for you. Either way, re-run the installer to refresh everything:

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/rogue-labs-cyber/rogue-arena-mcp/main/install.sh | sh

# Windows
irm https://raw.githubusercontent.com/rogue-labs-cyber/rogue-arena-mcp/main/install.ps1 | iex
```

Re-running the installer refreshes everything: the MCP server, the `rogue-mcp` CLI, all skill content, and the plugin/MCP registration for whichever agents you have. Your keychain auth token is preserved -- no need to re-login.

To silence the notifier (e.g., on an air-gapped machine):

```bash
export ROGUE_DISABLE_UPDATE_CHECK=1
```

## Uninstalling

```bash
# 1. Sign out (revokes the token and clears the keychain entry)
rogue-mcp logout

# 2. Remove the MCP server from your agent
claude mcp remove --scope user rogue-arena   # Claude Code
codex mcp remove rogue-arena                  # Codex

# 3. Uninstall the global CLI
npm uninstall -g rogue-arena-mcp

# 4. Remove the local clone and the per-agent skill/plugin files
rm -rf ~/.rogue-arena-mcp ~/.claude/plugins/cache/rogue-arena   # Claude Code clone + plugins
rm -rf ~/.codex/skills/architect-* ~/.codex/skills/rogue-*      # Codex skills
```

Optional (Claude Code): remove the Rogue Arena plugin entries from
`~/.claude/plugins/installed_plugins.json` if you want Claude Code to stop
listing them in `/plugin`.

## Troubleshooting

**"Not logged in"** -- Run `rogue-mcp login`.

**"Session expired"** -- Token expired after ~31 days of inactivity. Run `rogue-mcp login` again.

**Tools not appearing** -- The MCP tools require auth: run `rogue-mcp login`, then restart your agent (Claude Code or Codex). Note that skills autocomplete without login, but the MCP tools do not. Run `rogue-mcp whoami` to verify auth.

**"No canvas set"** -- Tell your agent to set a canvas, or use `rogue_set_canvas` with your canvas version ID from the Rogue Arena URL.

## License

MIT
