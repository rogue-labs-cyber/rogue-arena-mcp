# Machines Phase — Reference Doc

> **For:** architect-implementor Phase B (machines step)
> **Do not add:** persona blocks, trigger phrases, user interaction framing

Machines are the physical backbone of every scenario. Skipped fields, deferred catalog lookups, and thin user profiles produce silent failures that only surface at deployment. This phase doc covers reading the machine manifest produced by the domains phase and turning it into fully configured machines on the canvas — each with a role (DC, server, workstation, local), purpose narrative, plugins, parameter configuration, and user assignments.

## Core Rules

Do not use TodoWrite during build execution. The checklist encodes step ordering — follow it directly without mirroring to TodoWrite.

**LAW 1: Plugin params require `architect_plugin_catalog_list_full` first.** Call `architect_plugin_catalog_list_full` with the machine's `pluginVersionId`s and read the response before calling `architect_assigned_plugin_set_params`. Guessing field names produces silent misconfigurations — field names vary between plugin versions.

**LAW 2: User assignments require full bpData with every field filled.** `architect_machine_manage_user` with sparse bpData produces empty user profiles that starve downstream file seeding. The implementor must fill every field in the `bpData.assignment` schema — identity, personal background, work behavior, and AD placement. Invent plausible values grounded in the scenario's industry and departments.

**LAW 3: Completion claims require tool-output evidence.** The implementor must report machines as "done," "complete," or "ready" only after calling `architect_canvas_get_overview` (and `architect_vlan_get` for each VLAN it built) and quoting the returned state — machine count per VLAN, plugin assignments per machine, user assignments. Tool output is the only evidence; "looks good" is not.

## Checklist

Complete these steps in order.

**Manifest prerequisite:** The machine manifest comes from the domains phase in conversation context. If no manifest is present (new session, /clear between domains and machines, or the implementor jumped straight to machines), stop and report: "I don't have the machine manifest in this session. The domains phase needs to run first to produce it — VLAN `bp_context` only carries purpose and budget, not the machine plan." Do not guess or re-derive the manifest from VLAN state.

1. **Read VLAN context** — Call `architect_vlan_get(includeBpContext: true)` for the target VLAN. This returns domain info and company context. For AD data (OUs, groups, users), use `architect_canvas_global_search` or check DC plugin params via `architect_assigned_plugin_get_param`.
2. **Read reference files** — Read `refs/shared-rules.md` for size limits, hostname rules, and resource defaults. Domain knowledge for machine creation, plugin configuration, and user profiles is inlined in this phase doc below.
3. **Per machine: choose hostname** — Pick a hostname using naming patterns from canvas technicalInfra context or search DC plugin params. Adapt if the actual role differs from the naming guidance (e.g., guidance says WEB01 but Tomcat is installed, use TOMCAT01). Max 15 characters.
4. **Create machine** — Spawn a haiku subagent to call `architect_machine_add` with bpData containing the machine's role narrative, purpose, and AD placement. Call `discover_tools(search: "templates")` to list available OS templates. Match template to machine role: Windows Server for DCs/servers, Windows 10/11 for workstations, Linux for specific services.
5. **Install base and role plugins** — Call `architect_assigned_plugin_add` for each plugin. Install `required: true` plugins first, then optional ones. Order: base plugins (discover via `architect_plugin_catalog_search` when the manifest is missing them) then role-specific plugins from the manifest. User-specific plugins (e.g., development tools for a developer workstation) install in step 9 after user assignment completes, since they depend on knowing who the user is.
6. **Discover parameter field names** — Call `architect_plugin_catalog_list_full` with all `pluginVersionId`s from the machine's plugin list to get exact parameter names, types, descriptions, and CSV headers. Always precedes step 7.
7. **Configure parameters** — Call `architect_assigned_plugin_set_params` using the exact field names from step 6 and the parameter descriptions to choose values. On failure, check the error for correct field names and retry. For DC CSV params (CreateUsers, CreateOUs, CreateGroups), follow the Staged Dispatch Pattern per "DC User CSV Generation" below — the orchestrator authors identity fields, subagents author narrative fields, the orchestrator assembles and pushes via staging.
8. **Assign users** — Spawn a haiku subagent to call `architect_machine_manage_user` with rich bpData (see User Assignment below). Match workstation purpose to the right user by searching via `architect_canvas_global_search` or the DC's CreateUsers CSV param.
9. **Install user-specific plugins** — Now that the user is assigned:
    a. **Autologon plugin (required for every workstation with a primary user)** — Search for the autologon plugin via `architect_plugin_catalog_search` (search: "autologon" or "auto log"). Install it via `architect_assigned_plugin_add`. Discover its params via `architect_plugin_catalog_list_full`, then configure them with the assigned user's `samAccountName` and `password` from the bpData used in step 8. Without this plugin, the user assignment only exists in the canvas — Ansible won't actually log the user in on boot.
    b. **Role-matched plugins** — Install any plugins keyed to the user's role (e.g., Visual Studio for a developer workstation, Office tools for an admin assistant).
10. **Verify — 4-Step Evidence Gate**
    1. **CALL**: Run `architect_canvas_get_overview` for the canvas, plus `architect_vlan_get` for each VLAN built.
    2. **READ**: Read the full responses. Note every machine's plugin assignments, user assignments, and any empty-plugin or missing-role gaps surfaced in the state.
    3. **CHECK**: Every machine in the manifest is present, every plugin in the per-machine manifest is assigned with params, every required user assignment exists. Anything missing — identify it, fix it, and re-read state.
    4. **STATE**: Report completion with evidence by quoting the state ("architect_canvas_get_overview reports VLAN X: 5/5 machines, all plugins assigned and configured; VLAN Y: 3/3 machines, all plugins assigned and configured"). Machines still missing assignments after fixes get reported honestly as incomplete.

## Resource Budget Gate

Call `architect_canvas_get_budget` before creating machines to check current resource headroom (server-side enforcement rejects over-budget additions, so budgeting first saves turns). See [shared-rules.md - Resource Allocation Defaults](../shared-rules.md#resource-allocation-defaults) for ramGB/cpuCores defaults per machine type.

After completing all machines for a VLAN, call `architect_canvas_get_budget` again to verify quotas. If over budget, identify the most expensive machines (user-controllable boxes at 6GB/4cores) and propose reductions or removals.

## Machine Ordering

DCs are created before any other machine in a VLAN — they establish the domain that servers and workstations join.

**Per VLAN build order:**
1. Domain Controllers (complex) — one at a time
2. Servers (medium) — 2-3 per batch
3. Workstations (simple) — up to 5 per batch

An AD-enabled VLAN whose manifest lacks a DC is an error — flag it before building anything.

## Role-Specific Behavior

### Domain Controllers (complex)

DCs are the most involved machines to configure:

- Install DC plugins from the manifest (AD DS, DNS, DHCP, CreateUsers)
- Configure domain name, admin credentials, OU structure
- For CreateUsers, CreateOUs, and CreateGroups CSV params: follow the Staged Dispatch Pattern (see "DC User CSV Generation" below). The orchestrator authors identity fields, subagents author narrative fields, the orchestrator assembles and pushes. This applies to every row count — there is no "small enough to do inline" threshold.
- When `workplaceEvents` are available from VLAN context, reflect incidents in OU naming and security group structure (e.g., a post-breach `Security-Audit-Team` OU)

### Servers (medium)

- Add domain join plugin first (if AD-enabled VLAN)
- Determine base plugins by searching the plugin catalog or using convention
- Then install role-specific plugins from the manifest
- Configure parameters per plugin descriptions

### Workstations (simple)

- Add domain join plugin (if AD-enabled VLAN) as a base plugin in Checklist step 5
- Determine additional base plugins via catalog search when the manifest is missing them
- Assign a user via `architect_machine_manage_user` in Checklist step 8 (match workstation purpose to user role — e.g., dev workstation gets a software developer user)
- Install the autologon plugin and any role-matched user-specific plugins (dev tools, office suite) in Checklist step 9 after the user exists

## User Assignment

Users assigned via `architect_machine_manage_user` need rich bpData. These fields DIRECTLY drive file seeding in later tiers — sparse profiles produce sparse files.

The implementor must fill every field in the `bpData.assignment` schema — the schema includes identity (name, title, department), personal background (bio, hobbies, pets, personality, entertainment), work behavior (technical skill, filing habits, work style, communication style), and AD placement (OU path, groups, manager). Pull values from the company context and the DC's CreateUsers CSV param (via `architect_assigned_plugin_get_param` or `architect_canvas_global_search`). Invent plausible values grounded in the scenario's industry and departments.

### Subagent Dispatch for User bpData

When assigning users to 3+ workstations in a VLAN, spawn haiku subagents in parallel — one per workstation. Each subagent receives the user archetype, company context, and VLAN purpose, then calls `architect_machine_manage_user` with full bpData.

## Two Modes

### CREATE Mode

Full machine build from a manifest. This is the normal flow from the VLANs phase:

```
For each machine in manifest (DC-first order):
  1. Choose hostname from naming scheme
  2. Create machine via architect_machine_add with bpData
  3. Install plugins via architect_assigned_plugin_add
  4. Discover params via architect_plugin_catalog_list_full
  5. Configure params via architect_assigned_plugin_set_params
  6. Assign user (workstations) via architect_machine_manage_user
```

### MODIFY Mode

Update existing machines. Read state first, then apply changes:

1. Read current machine state via `architect_machine_get({ includePlugins: true, includeParams: true })`
2. For updates: add plugins from `pluginsToAdd[]` via `architect_assigned_plugin_add`. Remove plugins from `pluginsToRemove[]` via `discover_tools(category: "ROGUE_ARCHITECT_BUILDER")` for plugin deletion tools. To check plugin install order on the machine, call `discover_tools(search: "applied plugins")`.
3. For deletions: call `architect_machine_delete` — warn if deleting a DC, as dependent machines may break

## Context Usage

The VLAN context from `architect_vlan_get(includeBpContext: true)` provides:

- `companyContext` — company name and industry for realistic naming
- `vlanContext.purpose` — what this VLAN is for

Use this context to make decisions. When adding a web server, the VLAN context tells the implementor what company this is, what the VLAN is for, and what would make sense.

### Where to Find AD Data

| Question | Where to Look | Tool |
|----------|--------------|------|
| Who exists in this domain? | CreateUsers CSV on DC plugin | `architect_assigned_plugin_get_param` or `architect_canvas_global_search` |
| What OU structure exists? | CreateOUs CSV on DC plugin | `architect_assigned_plugin_get_param` or `architect_canvas_global_search` |
| What groups exist? | CreateGroups CSV on DC plugin | `architect_assigned_plugin_get_param` or `architect_canvas_global_search` |
| User personality/backstory? | Machine assignment bpData | `architect_machine_get` or `architect_canvas_global_search` |
| Why is user on this machine? | Machine aiNotes field | `architect_machine_get` or `architect_canvas_global_search` (searches aiNotes content) |
| Find everything about user X | All sources | `architect_canvas_global_search` with ["username", "displayname"] |

## Plugin Resolution Fallback

Plugin UUIDs are typically already set in the machine manifest from the domains phase. Use those directly.

If the manifest plugins are missing or incomplete:
1. Call `architect_plugin_catalog_search` to search by name
2. Use only the `pluginVersionID` from catalog results
3. Stop searching after 3 catalog queries for the same plugin type — if it is not in the catalog, note the gap and move on

## DC User CSV Generation

DC `CreateUsers`, `CreateOUs`, and `CreateGroups` CSV params are staged per the Staged Dispatch Pattern in `refs/shared-rules.md`. Read the `architect_assigned_plugin_set_params` tool description for the path template and the concat assembly rule.

Identity-bearing fields are authored by the orchestrator — never by subagents:

- `01-header.csv` is always written by the orchestrator from the plugin catalog's `ifCSVListOfHeaderStringValues` schema.
- samAccountNames are allocated per-fragment by the orchestrator (e.g. fragment A gets positions 1–50, fragment B gets 51–100); subagents receive their slice as an allocation list.
- Passwords are sourced from `implementation.yml` or generated by the orchestrator; subagents reference them verbatim, never invent.

Subagents author only narrative fields: character title, department, description text, forensic details. Subagents never write header rows, never generate samAccountNames, never invent passwords.

After assembly, the orchestrator cross-checks every samAccountName and password against the allocation plan before pushing; any drift triggers a re-dispatch of the offending fragment.

Inline values over 8 KB are rejected by the hub with a 400 and the exact staging path.

## Subagent Dispatch Points

See [shared-rules.md - Haiku Subagent Dispatch Pattern](../shared-rules.md#haiku-subagent-dispatch-pattern) for the canonical template shape. The machines phase dispatches haiku subagents in three places:

1. **Machine creation** (Checklist step 4) — context block: machine role, VLAN purpose, company context, naming guidance. Output: bpData for `architect_machine_add`.
2. **User assignment** (Checklist step 8) — context block: user archetype, company context, VLAN purpose, department info. Output: full user bpData for `architect_machine_manage_user` (see LAW 2 for required fields).
3. **DC CSV generation** (Checklist step 7 for DC param CSVs) — see the "DC User CSV Generation" section above for the full context block and orchestrator duties.

## Error Handling

- Check every tool result for `success` before proceeding
- If a machine creation fails, record the error and continue with remaining machines
- If a plugin install fails, record it and continue — report as UNCONFIGURED in summary
- If parameter configuration fails, check error for correct field names, retry once, then record and move on

## Communication Discipline

- Report completion only with `architect_canvas_get_overview` (or `architect_vlan_get`) output quoted as evidence.
- Verify after each machine type (DCs then servers then workstations); batch-then-verify hides cascading failures from early machines.
- Include failed tool calls in status reports.
- State facts with tool evidence: "architect_canvas_get_overview reports 12/12 manifest machines present, all plugins assigned" instead of "everything looks good."
- Say "unverified" when something cannot be confirmed instead of "should be fine."

## Constraints

- bpData for machine creation, user assignment, and DC CSV params is generated by haiku subagents (see "Subagent Dispatch Points"), not inline in the orchestrator. The orchestrator passes the subagent's output through to the `bpData` field.
- Verify with `architect_canvas_get_overview` after all machines are created.

---

## Machine-Specific Domain Knowledge

Shared AD structure, hostname rules, posture effects, and DC plugin param conventions live in [shared-rules.md](../shared-rules.md). Only machines-specific rules stay here.

### Credential Consistency

DCs produce credentials at configuration time — the domain FQDN, admin user, and admin password become available to every other machine in the same VLAN. Servers and workstations consume those credentials via domain join; the system wires them automatically, so domain join plugins only need the parameters they explicitly expose.

### Account Type Separation

See [shared-rules.md - Account Type Separation](../shared-rules.md#account-type-separation-enforced) for the canonical regular-vs-admin rules. Machines-specific constraints on top of the shared rule:

- Each workstation gets exactly one primary user.
- Each user gets at most one primary workstation.
- Multiple admins can share server access.
- A single person can hold both a regular workstation account and an admin server account — they're separate accounts on different machines.

### Computer Object Placement

Place machines in role-appropriate OUs rather than the default `CN=Computers`:

| Role | OU Placement |
|------|-------------|
| Domain Controllers | `OU=Domain Controllers` (built-in) |
| Database/Web/File Servers | `OU={Role}Servers,OU=Servers` |
| Dept Workstations | `OU=Workstations,OU={Dept}` |
| PAWs | `OU=PAW,OU=Tier0Admin` |

Chaotic/neglected posture scenarios can leave some machines in `CN=Computers` as deliberate poor hygiene — but not universally.

---

Final check: every pluginVersionId traces to `architect_plugin_catalog_list_full` this session, every user has full bpData, and `architect_canvas_get_overview` shows every manifest machine with its expected plugins and user assignments.
