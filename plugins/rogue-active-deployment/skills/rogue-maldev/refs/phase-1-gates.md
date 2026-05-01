# Phase 1 — Hard Gates

Complete before any other action. No exceptions.

## Gate Sequence

| Step | Tool Call | Purpose |
|------|-----------|---------|
| 1. Discover tools | `discover_tools(category: "ACTIVE_DEPLOYMENT")` | Register all deployment tools |
| 2. Find deployment | `deployment_list_owned` | User picks deployment (or confirm the one in context) |
| 3. List VMs | `deployment_list_vms` | Full inventory: hostnames, IPs, OS, status, snapshots |
| 4. Locked check | Inspect status | If locked, stop — write access required (exec, snapshots, uploads) |
| 5. Workspace setup | Check CLAUDE.md for `rogue_workspace` | Create technique folder structure (only if writing files) |
| 6. Diary check | `deployment_diary_read` | Resume prior session if relevant |

## Workspace Resolution

Follows the unified Rogue Labs convention:

1. Check CLAUDE.md for `rogue_workspace: <path>`. Use it if found.
2. If missing, ask: "Where should I store technique files? ~/RogueLabsClaude/ (recommended) or custom path?"
3. Create `{ROGUE_WORKSPACE}/deployments/{deployment-name}/techniques/` if it doesn't exist.
4. Write `rogue_workspace: <path>` to CLAUDE.md if it wasn't there.

Workspace is only required for modes that write files (B, C, D in the entry table). If jumping straight to Phase 7 with a ready tool, skip workspace setup unless the user wants a diary trail.

## Environment Orientation

After listing VMs, identify roles by scanning hostnames and OS types:

| Role | Hostname hints |
|------|---------------|
| Elastic/SIEM | elastic, siem, kibana, fleet |
| Domain Controller | dc, domain, ad |
| Target workstations | ws, wks, desktop, pc |
| Linux hosts | Check `operatingSystem` field |

Present role guesses. Let the user confirm or correct. "No SIEM" is valid — the no-SIEM fallback applies throughout.

If a SIEM box exists, probe it for available Elastic indices. Check OS first: Linux uses `curl -s --max-time 20`, Windows uses `Invoke-RestMethod`. Which index patterns matter and how to query them lives in `refs/siem-query-patterns.md` — read that when observation comes up.

## Time-sync check

Once at Phase 1, compare the VM clock to the Elastic `@timestamp` on a recent event. Drift over 60 seconds invalidates time-window filtering in Phase 7. Full procedure in `refs/siem-query-patterns.md` under "Time-sync sanity check."

## Pre-existing Snapshots

If VMs already have snapshots, present them with names and timestamps. Ask: use existing as revert points, create new snapshots of current state, or skip? Each new snapshot gets a unique name.
