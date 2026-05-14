# Rogue Arena MCP Server + Skills

Connect Claude Code to your [Rogue Arena](https://roguelabs.io) workspace. This repo includes:

- **MCP Server** -- authenticated proxy that gives Claude access to your canvases, deployments, plugins, and more
- **4 Skills** -- teach Claude how to build scenarios, develop plugins, create curriculum, and operate on live deployments
- **Auto-update notifier** -- a SessionStart hook that pops a notice in your terminal whenever your installed MCP server or any plugin is behind the public GitHub repo, with the one-line update command. Silent when you're up to date.

## Install

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/rogue-labs-cyber/rogue-arena-mcp/main/install.sh | sh
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/rogue-labs-cyber/rogue-arena-mcp/main/install.ps1 | iex
```

The installer checks for Node.js 18+, git, and Claude Code — and offers to install any that are missing. It then clones the repo, builds the MCP server, installs the skills, and configures Claude Code automatically.

Then authenticate:

```bash
rogue-mcp login
```

A browser window opens for you to sign in with your Rogue Arena account. Your token is stored in your OS keychain and auto-refreshes for **31 days**.

That's it. Restart Claude Code and the tools are available.

## What Gets Installed

### MCP Server

The `rogue-mcp` CLI connects Claude Code to the Rogue Arena hub at `arena.roguelabs.io`. It proxies tool calls with your authentication, so Claude can:

- Read and modify canvases (machines, VLANs, plugins, forests)
- Manage deployments (start, monitor, debug)
- Upload/download files to VMs
- Work with curriculum content
- Develop and test Ansible plugins

### Skills

| Skill | What it does |
|-------|-------------|
| **rogue-build-scenario** | Design lab scenarios -- brainstorm company context and infrastructure, implement via MCP tools, debug deployments |
| **rogue-active-deployment** | Operate on running deployments -- execute commands, browse files, manage snapshots, test payloads against detections |
| **rogue-plugin-dev** | Develop Ansible plugins -- brainstorm offline install approaches, write YAML, manage vaults |
| **rogue-curriculum-builder** | Build course content -- create chapters, sections, CTF nodes, insert media |

Skills activate automatically when you ask Claude to do something that matches their triggers (e.g., "build a lab", "test this payload", "create a chapter").

## Typical Workflow

```
You:    "Build me a lab with a small financial company, 2 domains, 5 machines"
Claude: [activates rogue-build-scenario, brainstorms with you, builds via MCP tools]

You:    "Deploy it and upload my C2 implant to the Windows workstation"
Claude: [activates rogue-active-deployment, deploys, uploads file]

You:    "Test the implant against detections"
Claude: [activates rogue-maldev, snapshots, executes, checks Elastic, reverts]
```

## Commands

```bash
rogue-mcp login     # Authenticate with Rogue Arena
rogue-mcp logout    # Sign out and revoke token
rogue-mcp whoami    # Check auth status
rogue-mcp serve     # Start the MCP server (Claude Code does this automatically)
```

## File Access

Upload and download tools can read/write files on your local machine. Claude Code prompts you before each file operation. The server blocks access to sensitive directories (`~/.ssh`, `~/.aws`, `~/.gnupg`, etc.) as a safety net.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ROGUE_HUB_URL` | `https://arena.roguelabs.io` | Hub API URL |
| `ROGUE_VAULTS_URL` | Same as hub URL | Vaults service URL |
| `ROGUE_CLIENT_ID` | `rogue-mcp` | Keycloak client ID |
| `ROGUE_DISABLE_UPDATE_CHECK` | unset | Set to `1` to silence the auto-update notifier |

## Updating

You don't need to remember to update. The auto-update notifier checks GitHub once per session (cached for 24h) and surfaces a notice when your MCP server or any plugin is behind. Claude will offer to run the installer for you, or you can run it yourself:

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/rogue-labs-cyber/rogue-arena-mcp/main/install.sh | sh

# Windows
irm https://raw.githubusercontent.com/rogue-labs-cyber/rogue-arena-mcp/main/install.ps1 | iex
```

Re-running the installer refreshes everything: the MCP server, the `rogue-mcp` CLI, all skill content, and the plugin metadata. Your keychain auth token is preserved — no need to re-login.

To silence the notifier (e.g., on an air-gapped machine):

```bash
export ROGUE_DISABLE_UPDATE_CHECK=1
```

## Uninstalling

```bash
# 1. Sign out (revokes the token and clears the keychain entry)
rogue-mcp logout

# 2. Remove the MCP server from Claude Code
claude mcp remove --scope user rogue-arena

# 3. Uninstall the global CLI
npm uninstall -g rogue-arena-mcp

# 4. Remove the local clone and plugin cache
rm -rf ~/.rogue-arena-mcp ~/.claude/plugins/cache/rogue-arena
```

Optional: remove the four Rogue Arena plugin entries from
`~/.claude/plugins/installed_plugins.json` if you want Claude Code to stop
listing them in `/plugin`.

## Troubleshooting

**"Not logged in"** -- Run `rogue-mcp login`.

**"Session expired"** -- Token expired after ~31 days of inactivity. Run `rogue-mcp login` again.

**Tools not appearing** -- Restart Claude Code. Run `rogue-mcp whoami` to verify auth.

**"No canvas set"** -- Tell Claude to set a canvas, or use `rogue_set_canvas` with your canvas version ID from the Rogue Arena URL.

## License

MIT
