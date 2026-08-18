# Flow — Implement canvas

> Loaded by `architect-brainstorm` only after `refs/flow-validate.md` passes **and** the user confirms the build. Do not invoke as a skill. Never call `Skill()`.
>
> MUTATES live canvas state. `architect_canvas_set_context` has REPLACE semantics.

This step runs the full build without further prompting, apart from the checkpoints below. Step 3 is the last cheap place to catch a wrong canvas — do not skip it, and echo the canvas name and current counts before writing anything.

## Startup Sequence

1. **Locate YML files** — scenario directory already in conversation context
2. **Validate scenario.yml** — Check `schema_version: 1`, verify required fields present
3. **Canvas ID validation** — Call `architect_canvas_get_overview` with the canvas ID from YML
   - Canvas not found → fail fast: "Canvas ID not found. Check the ID and try again."
   - Canvas has unexpected state → checkpoint: "This canvas already has X machines. Continue adding, or fresh canvas?"
4. **Resume detection** — Check diary (`diary_read`) + implementation.yml on disk for partial builds
   - If partial build found → present: "Found partial build — Phase A completed. Resume from Phase B?"
   - Resume from next incomplete phase

## Context Window Management

Load phase ref docs JUST-IN-TIME, not all at once:
- Before Phase B canvas step → load `refs/phases/canvas.md`
- Before Phase B domains step → load `refs/phases/domains.md`
- Before Phase B machines step → load `refs/phases/machines.md`
- Before each enrichment type → load relevant enrichment ref doc
- `refs/shared-rules.md` is referenced throughout (load once)

## Phase A: Expansion

1. Read scenario.yml (parts 1–3)
2. Call `architect_canvas_get_budget` to get actual resource limits
3. Plugin catalog lookups for every planned machine role (use decision logic table below)
4. Budget math: calculate total RAM/CPU from machine counts using per-machine defaults
5. Naming convention derivation (follow refs/phases/canvas.md naming decision process)
6. Forest event generation (follow refs/phases/domains.md 3-phase generation)
7. Write implementation.yml to scenario directory
8. Surface ALL expansion flags to user (missing plugins, budget warnings, substitution suggestions)
9. If `review_tier2: true` → present full implementation.yml for user review
10. If `review_tier2: false` → auto-proceed UNLESS critical gaps (unresolved plugins with no suggestions)
11. Large Generation Confirmation Gate: even when auto-proceeding, confirm before generating 80+ characters, 20+ CSV rows, or file manifests across 5+ machines

### Decision Logic

| Decision | Source Ref Doc |
|----------|---------------|
| Plugin selection (purpose → search terms) | refs/phases/machines.md — plugin resolution workflow |
| Machine allocation (DCs/servers/workstations split) | refs/phases/domains.md — budget allocation tables + shared-rules ratios |
| Naming conventions (company → hostname prefix) | refs/phases/canvas.md — naming decision process |
| Forest events (milestones → AD events) | refs/phases/domains.md — 3-phase CHRONICLE/PORTRAITS/AD MATERIALIZATION |
| Network topology (zone → firewall rules) | refs/phases/enrichment-network.md — zone-default rule tables |
| Character generation | Phase B via Haiku subagent per refs/phases/canvas.md |
| Budget limits | Phase A calls `architect_canvas_get_budget` as first MCP call to get actual limits |

## Phase B: Scenario Build

> **Staging:** `{scenario_dir}/staging/` is the canonical scratch area for deferred large content. Subagents write narrative fragments there; the orchestrator authors identity fields (headers, passwords, samAccountNames, character IDs), verifies fragments from disk, assembles the payload, pushes via MCP, and drops a `.pushed` sentinel. Full protocol in `refs/shared-rules.md` "Staged Dispatch Pattern."

Execute in this order, following the JIT-loaded ref doc for each step:

### B.1: Set Canvas Context
- Load refs/phases/canvas.md
- Generate company profile, characters (via Haiku subagent), leadership, technical infra
- Call `architect_canvas_set_context` ONCE (REPLACE semantics — one call with everything)

### B.2: Create Forest Topology
- Load refs/phases/domains.md
- Create domains, generate forest events (3-phase: CHRONICLE → PORTRAITS → AD MATERIALIZATION)
- Create domain backstories, set cross-domain relationships and trusts
- Call `architect_forest_manage` operations

### B.3: Create VLANs
- Still using domains ref doc
- Create VLANs with zone classification and machine budgets
- Call `architect_vlan_add` for each VLAN

### B.4: Create Machines
- Load refs/phases/machines.md
- Follow DC-first ordering (DCs → servers → workstations)
- For each machine: create machine, add plugins, set params, assign users
- Follow LAW 1 (catalog before params), LAW 2 (full bpData), LAW 3 (completeness verification)
- LAW 1.5 (Addon Config Samples first): when `architect_plugin_catalog_list_full` returns a plugin version with `addonConfigSampleCount > 0`, scan the `addonConfigSamples[{ sampleId, name, notes, language }]` summaries in the same response BEFORE authoring runtime config content from scratch. The `notes` field is the match key — pick the sample whose notes align with the machine's character/role/story, fetch via `architect_plugin_catalog_get_addon_config_sample(sampleId)`, tweak in memory (SAMs, hostnames, file paths), and pass into the plugin's `stringBlock` param via `_set_params`. Authoring config from scratch when a working sample matches is a silent regression.
- Idempotency: check `architect_machine_list` before creating — skip if exists

### B.5: Run Enrichment
- Only run enabled types (respect scenario.yml `enrichment:` boolean flags)
- Run in dependency order: backstory → relationships → files → network
- Load each enrichment ref doc JIT before running that type
- Skip disabled types entirely

### B.6: Orchestration Plugin Audit

Common silent failure: the data is set up correctly but the orchestration plugin that runs at deploy time is missing. Ansible has nothing to do; the user reports "auto-login didn't fire" or "files never copied." Walk every machine touched in this build and verify the required orchestration plugins are assigned.

Plugin names are not hardcoded — they evolve. Always resolve via catalog search at runtime.

| Data setup that happened | Required orchestration plugin | How to resolve |
|--------------------------|-------------------------------|----------------|
| Primary user assigned to a workstation/desktop via `architect_machine_manage_user` and that user is expected to auto-login on boot | An auto-login plugin matching the machine's OS family (Windows, Linux, etc.) | `architect_plugin_catalog_search` with terms like `"auto login"` / `"autologin"`; filter the result list by the machine's OS. If multiple candidates match, pick the canonical one for that OS or checkpoint to user. |
| Files uploaded to a vault destined for delivery to a machine | **File Copy** plugin on the same machine, pointing at the vault path | `architect_plugin_catalog_search` with term `"File Copy"` (this name is generic and stable). |
| Primary user assigned to a Windows workstation/desktop via `architect_machine_manage_user` | An Office install plugin (provides Word, Excel, etc. so users can open .docx/.xlsx artifacts seeded on the machine) | `architect_plugin_catalog_search` with terms like `"Office install"` / `"Microsoft Office"`; filter to Windows. If multiple candidates match, pick the canonical one or checkpoint to user. |

**Plugin `run_order` matters.** When File Copy and Auto Login are both assigned to the same machine, set File Copy's `run_order` HIGHER than Auto Login's. Auto Login creates the user profile folders (Desktop, Documents, AppData) that File Copy needs as destinations — if File Copy fires first, Ansible has nowhere to copy the files. Set this when calling `architect_assigned_plugin_set_params` for File Copy.

Steps for each pattern, per machine:
1. Read currently assigned plugins via `architect_machine_get`.
2. If the orchestration plugin is missing, search the catalog (do NOT hardcode plugin names).
3. Call `architect_assigned_plugin_add` with the resolved plugin and the appropriate params — user SAM + password for auto-login; vault path / destination for File Copy.
4. Log every auto-addition to the deviations log: `"Auto-added {plugin} on {machine} for {pattern}: {detail}"`.

Surface auto-additions in the B.7 checkpoint summary so the user sees what was caught.

This audit is non-optional. The pattern is "data setup ✓ + orchestration plugin ✓".

### B.6.5: Plugin Discipline

Four rules apply throughout plugin work — when adding, configuring, or auditing.

**Static IP belongs in the VLAN's subnet.** When a plugin param sets the machine's own IP (typically "Create Static IP"), call `architect_vlan_get` for the machine's parent VLAN and verify the IP falls inside `subnetCidr`. If `subnetCidr` is null, prompt the user to set it before proceeding. **Read the param's description from the catalog first** — if the description indicates the IP targets a remote network (firewall rule, DNS forwarder, NAT destination), skip the verification. Remote-network IPs are intentionally extra-VLAN.

**Same-machine dep pairs are coupled.** When listing plugins on a machine, check each plugin's `isDependencyAdd` flag and `sameMachineDependencies` / `sameMachineDependents` arrays. A plugin with `isDependencyAdd: true` is auto-attached — the parent (in `sameMachineDependents`) owns ordering, configuration, and lifecycle; the dependent travels with it. Treat dep-pairs as a single unit on listings — describe them as "coupled," not duplicates. Never `_update` or `_reorder` a plugin where `isDependencyAdd: true`; target its parent instead. (Cross-machine deps via `crossMachineDependencies` are separate and behave normally.)

**Plugin sequencing sanity.** When adding a plugin or auditing a machine's sequence, read each plugin's description and any `parentServerPlugins` from the catalog to determine prerequisites. Catalog metadata + prose are the source of truth — don't guess from plugin names. Common anti-patterns to watch for:

- Domain-join AFTER auto-login of a domain user (login fails; user doesn't exist yet)
- User-context plugins (Outlook, Mount Share, file-copy to user-profile paths like `C:\Users\<user>\`) BEFORE auto-login (user profile doesn't exist yet)
- Permission grants (Add to Local Admins, Grant File Permissions) BEFORE the user exists

Place new plugins AFTER their prerequisites. The B.6 File-Copy-after-Auto-Login rule is a specific case of this discipline.

**Run-order tooling.** Each plugin returns `position` (1..N dense, derived per machine) and `runOrderSequence` (raw int the FE displays). Use `position` as your working model. To reorder a whole machine: `architect_assigned_plugin_reorder({ machineId, orderedAppliedPluginIds })` — one atomic call, weaves in same-machine deps automatically (omit `isDependencyAdd: true` plugins from input). To insert a single plugin at a specific spot: `_add` then `_update` with the desired `runOrderSequence` (any unused integer; gaps survive — hub doesn't reindex on `_update` or Apply Plan).

### B.7: Checkpoint
- Run `architect_canvas_get_overview` to confirm machine and VLAN counts match the plan and to spot empty-plugin entities
- Write diary entry: `diary_write` with type SCENARIO_BUILT, content summarizing machine counts, VLAN counts, deviations (including any orchestration plugins auto-added in B.6)
- Present to user: "Scenario built. X machines across Y VLANs. Deviations from plan: [list]. Changes are staged as drafts."

## End of pipeline — final validate

After Phase B, this flow is done. Do **not** run the audit inline. Do **not** call `Skill()`.

Tell the user:

> "Build staged as drafts. Run `/architect-final-validate` for the pre-deploy audit (plugin params, run order, completeness, realism grade) before Apply Plan."

That skill is the required last step. Stop here.

## Error Handling

### Deviations Log
Maintain a running log of every substitution, retry, or skip. Present at each phase checkpoint.

### Retry Policy
3 retries with exponential backoff (1s, 3s, 9s) for transient MCP failures. After 3 failures → checkpoint to user: "MCP call failed after 3 retries. Retry, skip this resource, or stop?"

### Mid-Implementation Interruption
If user sends a message during implementation: finish creating the current resource (never abort mid-resource), then checkpoint: "Paused after completing [current resource]. What would you like to change?"

### Error Classification
- **Silent fix:** API transient failure → retry. A generated canvas resource display-name collision may use a deterministic suffix when identity is unaffected; log it.
- **Checkpoint to user:** Vault path/name collision (`VAULT_NAMESPACE_CONFLICT`) — never overwrite or silently rename; plugin not found (no substitute), budget exceeded.
- **Re-design needed:** Platform doesn't support the design at all.

## Idempotency
Check before creating every resource. If a VLAN with the same name or a machine with the same nickname already exists, skip and log. This enables safe re-runs after partial failures.

## Diary Integration

| Phase Boundary | Diary Entry Type |
|----------------|-----------------|
| After Phase A | `EXPANSION_COMPLETE` — implementation.yml written, flags resolved |
| After Phase B | `SCENARIO_BUILT` — machine counts, VLAN counts, deviations, completeness state |

## Resume Protocol

If partial build detected (via diary entries + implementation.yml on disk):

1. Read last diary entry to determine which phase completed
2. Read implementation.yml for the expansion state
3. Read canvas state via MCP to verify what actually exists
4. Present to user: "Found a partial build — Phase A completed, Phase B not started. Resume from scenario build?"
5. Resume from the next incomplete phase, skipping completed work

## Apply Plan Reminders
At every checkpoint, remind: "These changes are staged as drafts."

**Run precheck before sending the user to Apply Plan or final-validate.** First call `architect_canvas_precheck` (read-only — 8 deterministic checks against the projected canvas: missing required params, malformed CIDR, duplicate names, empty-plugin machines, unwired dep edges, unreachable cross-machine deps). If it returns any `error`-severity findings, fix them and re-run before handing off. Report the precheck result when you tell the user to run `/architect-final-validate`.
