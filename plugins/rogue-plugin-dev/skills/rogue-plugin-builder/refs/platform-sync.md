# Platform Sync — Plugins, Canvas, Builds

Shared by phases 2 and 3. Everything here goes through the Rogue Arena MCP tools; the local project files stay the working copy you edit.

**Command IDs.** Tools that take a `clientCommandId` want a fresh UUID per new request. To retry the same request after an error or timeout, resend the SAME `clientCommandId`; a retry never repeats the effect.

## Tool Discovery

- `discover_tools(category: "PLUGIN_DEV")` — the `plugin_dev_*` tools. They key off `pluginId` and need no canvas.
- `discover_tools(category: "ROGUE_ARCHITECT_BUILDER")` — canvas staging tools. Add `subcategory: "plugin_catalog"` for the template catalog and `subcategory: "deploy"` for the `architect_deploy_*` debug tools.
- A tool named here but missing from your list (e.g. `architect_canvas_action_status`): `discover_tools(search: "<tool name>")`.
- `architect_*` tools act on the active canvas; bind it with `rogue_set_canvas` first (Canvas below).

---

## Startup Sync (existing project, every session)

### 1. Load context

For the picked plugin, read:
- the current `ansible_run.yml`
- the download script (if it has content beyond the scaffold)
- the file list of `for_plugin_vault/` (if any)
- the `.sample/` body files for any Addon Config Samples on the plugin
- `BUGS.md` at the project root (create it with the empty template from phase 1 if missing)
- `lastUpdate` from `project.json`

### 2. Metadata completeness

Every plugin in `project.json` MUST have:
- `displayName` — human-readable name for the UI
- `description` — max 600 characters (platform limit), explains what the plugin does for end users
- `pluginType` — one of: `action`, `role`, `application`, `vulnerability`, `attack`, `defense`
- `parameters` — array of parameter objects, each with `name`, `type`, `required`, `description`; CSV-type params also need `sampleCSV`. **For `csv`-type params, the `description` MUST embed a copy-paste-ready example block** (headers + 4-10 realistic rows) so end users can copy-paste and edit directly from the platform UI.

If ANY of these are missing or empty, **stop and collect them before any development work:**
1. Read the `ansible_run.yml` and identify all `{{ variable }}` references and `set_fact` values
2. Propose a `displayName`, `description`, and `pluginType` (default `pluginType` to `application` if intent is unclear, and call it out so the user can correct)
3. Propose a complete parameter list with types and descriptions
4. For any CSV parameters, generate a realistic sample CSV (headers + 4-10 rows) AND embed that same example as a fenced block inside the param's `description` — both `sampleCSV` and `description` carry the example so the platform UI displays it inline
5. Present the full metadata to the user for confirmation
6. Write it into `project.json` once confirmed

This metadata is required for publishing — don't skip it.

### 3. Pull and reconcile

- `pluginId` set → `discover_tools(category: "PLUGIN_DEV")`, then `plugin_dev_get(pluginId)`. The platform is the source of truth for the YAML: if its `yamlCode` differs from the local `ansible_run.yml`, say so and take the platform version unless the user says the local one is newer.
- `canvasVersionId` set (project-level or plugin-level) → `rogue_set_canvas(canvasVersionId)` and `discover_tools(category: "ROGUE_ARCHITECT_BUILDER", subcategory: "deploy")`.
- **First-sync backfill.** The plugin may exist on the platform without everything pushed (an interrupted session, a plugin adopted from `plugin_dev_list`). Compare `plugin_dev_get` against `project.json` and push what's missing so the platform matches the confirmed plan before any development work:
  - **Name / description / type** don't match → `plugin_dev_update_metadata` with the confirmed values (including `name` = `displayName`).
  - **YAML body** empty or whitespace → push the local `ansible_run.yml` via `plugin_dev_update_yaml`, so the plugin carries at least the deploy-safe scaffold placeholder. The one case where local wins: an empty platform body is a gap to fill, not truth.
  - **Compatible OS templates** none set (or only the catch-all default) → set an initial slice from `targetOS` (Compatible-OS Mapping below). Phase 3's Post-Build Assessment narrows it later.
  - **Params** — push any `project.json` param not already in `parameters[]` via `plugin_dev_add_param` (Param Push Mapping below).
  - **Addon samples** — push any `addonConfigSamples` entry without a `sampleId` via `plugin_dev_add_addon_config_sample`.
- A plugin with no `pluginId` → Plugin IDs below (phase 2's Platform Integration).

---

## Plugin IDs — Create or Find

You create and find plugins yourself. Never ask the user to create plugins in the UI or paste IDs.

### Find an existing plugin

- `pluginId` already in `project.json` → use it.
- `pluginId` null but the plugin may already exist (the user says so, or an earlier session was interrupted mid-create) → `plugin_dev_list` (lists plugins you can develop; `includeTeam: true` adds teammates' editable ones; returns `pluginId`, name, type, status). Match by name. Ask the user to pick only when names are ambiguous.
- Before adopting a listed plugin, `plugin_dev_get` it:
  - Not editable (published or cloning) → say which plugin and offer to create a fresh one instead.
  - Holds real content (params, compatible templates, a real YAML body) that differs from `project.json` → show the differences and ask before overwriting. A wrong match would clobber a populated plugin.

### Create new plugins

1. **Confirm the batch once.** One message listing every plugin you will create: display name, `pluginType`, `targetOS`, and its proposed compatible-OS set (Compatible-OS Mapping below). Phase 2 folds the test canvas into the same message. Creating is cheap and non-destructive; one yes covers the batch.
2. **Create each plugin:** `plugin_dev_create` with `clientCommandId` (a fresh UUID per plugin; resend the same one to retry), `pluginName` (the `displayName`), `pluginDescription` (the `description`, max 600 chars), `pluginType`. It creates a new, empty, unpublished plugin owned by the user and returns `pluginId`, `replayed`, `note`. Leave the staff-only fields (`blockStudentAccessToMachine`, `blockStudentFromAccessingPlugin`, `whitelistDomains`) unset.
3. **Save immediately.** Write `pluginId` into the matching `project.json` entry right away, then `plugin_dev_get(pluginId)` and save `vaultId` too, so the binding survives a crash.
4. **Run the Push Loop** below for each new plugin.

If a session ends mid-batch, `plugin_dev_list` shows what was already created; adopt those instead of creating duplicates.

---

## Compatible-OS Mapping

Propose which base VM templates each plugin should be compatible with, grouped by plugin `targetOS`, as part of the batch confirmation.

- Scan the global template list with `architect_plugin_catalog_list_templates` (needs no `pluginId`; returns `id` / `templateName` / `operatingSystem` per template; filter with `operatingSystems`). It runs in a canvas context: if it errors because no canvas is set, bind one first (Canvas below). Valid OS values: `WindowsServer2022`, `Windows10`, `Windows11`, `DebianLinux`, `Kali`, `Ubuntu`, `UbuntuGUI`, `VyOS`, `OracleLinux9`.
- Per-OS defaults: **linux plugins → the apt-based images** (`DebianLinux`, `Ubuntu`, `UbuntuGUI`, `Kali`); **windows plugins → the Windows images** (`WindowsServer2022`, `Windows10`, `Windows11`). Exclude `OracleLinux9` from the linux default (it is dnf/yum-based, not apt) and call that out so the user can add it back for a non-apt plugin. Exclude `VyOS` (a router OS) unless a plugin specifically targets it.
- Present it as a lightweight yes/no (the binding plan was already confirmed at phase 1's Confirmation Gate):
  > "Compatible-OS set per plugin — good, or adjust?
  >  - `wireguard-server` (linux) → DebianLinux, Ubuntu, UbuntuGUI, Kali
  >  - `wireguard-client-win` (windows) → WindowsServer2022, Windows10, Windows11"
- If the catalog isn't available in this session, propose from `targetOS` and the OS list above, still confirm, and resolve the exact template IDs at push time.

---

## Push Loop

With `discover_tools(category: "PLUGIN_DEV")` done, run these in order for each plugin. On any per-step error, stop and report the specific plugin + step — don't silently continue to the next plugin.

1. **Metadata + body.** `plugin_dev_create` already set name, description, and type. For an adopted plugin, or when they change later, call `plugin_dev_update_metadata(pluginId, name, description, type)` and set all three (`name` is the `displayName`); if it rejects the plugin as not editable (published/cloning), skip that plugin and say so. Then `plugin_dev_update_yaml(pluginId, <the plugin's local ansible_run.yml>)` to push the body — at minimum the deploy-safe scaffold placeholder. An empty plugin body makes the first build error, so the platform plugin must carry at least the placeholder until the real tasks are written.
2. **Compatible templates — get-before-set is required.**
   - `plugin_dev_get_compatible_templates(id)` returns `availableTemplates` + `selectedTemplateIds` for this plugin.
   - Map the user-approved OS choices to template IDs by cross-referencing the `architect_plugin_catalog_list_templates` output (`id` / `templateName` / `operatingSystem`), keeping only IDs that also appear in this plugin's `availableTemplates`. When several templates share an OS, disambiguate by exact `templateName`.
   - If the matched set is empty, do NOT call set — surface the plugin, its actual `availableTemplates`, and the approved OS set, and ask the user to pick from what this plugin offers.
   - `plugin_dev_set_compatible_templates(id, matchedIds)` is a strict **bulk replace** that 400s on unknown IDs, so only ever pass IDs sourced from this plugin's `availableTemplates`. If it 400s, re-fetch `get_compatible_templates` once and remap; if it 400s again, or the remap is empty or ambiguous, stop and surface `availableTemplates` to the user rather than retrying.
3. **Params — `plugin_dev_add_param` for every declared param** (Param Push Mapping below). `add_param` is additive, so add only params not already in the `parameters` list `plugin_dev_get` returned (avoids duplicates on a re-run). This MUST happen before the test scenario is staged — `architect_assigned_plugin_add` can't parameterize a plugin whose params don't exist on the platform.
4. **Addon samples — `plugin_dev_add_addon_config_sample` for every sample** when `addonConfigSamples` is present. Walk the array in order: `pluginId`, `name`, `notes`, `language`, `code` (empty string is fine at first; phase 2 fills it in), `sortOrder`. Also additive, so add only samples not already on the plugin; save each returned `sampleId` back to the matching `project.json` entry. Samples push regardless of canvas staging — downstream sessions discover them via the catalog as soon as they exist.
5. **Confirm:**
   > "Created <N> plugin(s) and set description, type, compatible OS templates, and parameters. Refresh the UI to see them."

---

## Work-Loop Sync

When `pluginId` is present, every local change also goes to the platform:

| Action | Local (always) | MCP (when pluginId present) |
|--------|----------------|-----------------------------|
| Write/edit YAML | Save to `ansible_run.yml` | Also push via `plugin_dev_update_yaml` |
| Add/change params | Update `project.json` params | Also call `plugin_dev_add_param` / `plugin_dev_update_param` / `plugin_dev_delete_param` (delete: user's yes) |
| Update name/desc/type | Update `project.json` | Also call `plugin_dev_update_metadata` |
| Upload resources | Save to `for_plugin_vault/` | Upload via `plugin_dev_upload_to_vault(pluginId, localFilePath)` — async TUS resumable transfer. Returns `transferId`; poll `plugin_dev_transfer_status` to terminal status. A claimed vault name fails with `VAULT_NAMESPACE_CONFLICT`; it never overwrites or silently renames. For an intentional replacement, list the vault, delete the exact existing file (user's yes), then retry the upload. |
| Check vault contents | `ls for_plugin_vault/` | Also call `plugin_dev_list_vault_files` |
| Delete vault files | `rm` locally | Also call `plugin_dev_delete_vault_file` (user's yes) |
| Add/edit/reorder addon config samples | Update `project.json` `addonConfigSamples[]` + write/edit body in `.sample/<name>.<ext>` | Also call `plugin_dev_add_addon_config_sample` / `plugin_dev_update_addon_config_sample` |
| Delete addon config samples | Remove from `project.json` array and delete the `.sample/<name>.<ext>` body file | Also call `plugin_dev_delete_addon_config_sample` with `sampleIds: [...]` (user's yes; auto-recompacts sortOrder) |
| Read full sample code from platform | `cat .sample/<name>.<ext>` locally | Also call `plugin_dev_get_addon_config_sample(sampleId)` |

### Param Push Mapping (`project.json` → MCP args)

The param tools take a narrower, differently-named arg set than the `project.json` param object — map explicitly; passing `project.json` fields straight through fails (the tools reject unknown fields):

- **`plugin_dev_add_param`** — `pluginId`, param `name` → `parameterFieldName` (valid Ansible variable name, no spaces), `type`, `description`, `required` → `isRequired`, optional `isAdvancedSetting`, and `csvHeaders` (only for `csv` type — the header row alone, i.e. the first line of the param's `sampleCSV`, as a **comma-separated string**). There is no default field — a param's default belongs in the YAML (`plugin_dev_update_yaml`), not here, so don't imply a default was applied. Additive: each call creates a new param, so use `update_param` (not a second `add_param`) to change an existing one.
- **`plugin_dev_update_param`** — keyed on **`parameterId`** (the param's UUID from `plugin_dev_get`'s `parameters[]`), not the field name. Same editable fields, with one shape difference: its `csvHeaders` is an **array of strings** (or `null` to clear), not a comma-separated string.
- **`plugin_dev_delete_param`** — keyed on the same `parameterId`.

---

## Canvas — Find, Create, Bind

You find or create the canvas yourself. Never ask the user for a canvas ID.

1. **Already known** — `canvasVersionId` in `project.json` → `rogue_set_canvas(canvasVersionId)`.
2. **Find** — `architect_canvas_list` (the user's own canvases; optional literal `search` on the name) or `architect_canvas_list_team` (teammates' canvases). Take the obvious match (e.g. named after the project). Ask the user to choose only when several are plausible.
3. **Create** — when none fits: `architect_canvas_create` with `clientCommandId` (fresh UUID), `name` (e.g. `<project-name> test`), optional `shortDescription` and `description`. It finishes in the background: follow it with `architect_canvas_action_status` (by `requestId`) until `status` is `succeeded`, then take `result.canvasVersionId`.
4. **Bind and save** — `rogue_set_canvas(canvasVersionId)`, then save `canvasVersionId` to the project-level `project.json`.
5. **Read before mutating** — `architect_canvas_get_overview()`, so you don't double-create entities already on the canvas.

## Apply the Plan

`architect_canvas_apply_plan` (no input; acts on the active canvas). You call it; the user never has to click Apply Plan.

- It runs the canvas precheck first. On `applied=false` it returns blocking findings and changes nothing: fix them and call it again.
- It is refused when nothing is pending; when an Oracle conversation staged the pending plan last (tell the user, and leave that plan for them to review and apply); or when the canvas changed while validating (re-read with `architect_canvas_get_overview`, apply again).
- Applying publishes every pending draft on the canvas. If drafts you didn't stage are pending (for example a teammate's), name them and ask first.
- **Applying does NOT build or provision VMs.** A build or redeploy is refused while changes are pending, so apply first.

## Builds

You may start, redeploy, and remove builds on the user's own canvas, but each one provisions or tears down real VMs: **say what it will do and get the user's explicit yes first, every time.**

- **First build** — `architect_canvas_start_build` with `clientCommandId` (fresh UUID); optional `continueOnYmlRunError`, `maximumVerbosityInAnsibleLogs`, `snapshotEveryXMinutes` (leave the defaults unless there's a reason). Refused while changes are unapplied (apply first) and when every deployment slot is in use (tell the user to remove a deployment). Then monitor (below).
- **Redeploy** — `architect_deployment_preview_redeploy` (no input) returns the strategy, effects, and `planToken`. Tell the user what it will do. On their yes, `architect_deployment_redeploy` with `deploymentRecordId` (from `architect_deploy_list_status`), `expectedPlanToken`, `expectedStrategy` (`resume_from_checkpoint` or `rebuild_from_scratch`, as the preview said), and a fresh `clientCommandId`. Any change after the preview invalidates the token: preview again, never invent one.
- **Rebuild from scratch** — when a clean VM is required (validating a fix, the offline proof) and the preview strategy is `resume_from_checkpoint`: `architect_canvas_remove_build` with the builder `deploymentRecordId` (from `architect_deploy_list_status`) and a fresh `clientCommandId` tears the build down (confirm first), then `architect_canvas_start_build`.
- **No snapshot or revert** is available through `architect_deploy_*`. A clean VM means a from-scratch rebuild.

### Pre-Redeploy Final Check Gate

**Before proposing any redeploy or rebuild**, confirm each row below. Past sessions skipped this and shipped bugs straight into the next deploy — the gate exists to prevent that. Earning a redeploy is your job, not the user's.

The gate is an assertion pass — it introduces no new rules. State the result of each row out loud before greenlighting:

| # | Pre-redeploy assertion | Source rule |
|---|------------------------|-------------|
| 1 | Every live-discovered fix is reflected in `ansible_run.yml` — live execution alone does not count | SKILL.md fact 3 ("live shell is for discovery, never patching") |
| 2 | Every new/modified file in `for_plugin_vault/` was uploaded via `plugin_dev_upload_to_vault` (confirmed via `plugin_dev_list_vault_files` if TUS completion was in doubt) | Work-Loop Sync |
| 3 | Every new/changed param exists in `project.json` AND was pushed via `plugin_dev_add_param` / `plugin_dev_update_param` / `plugin_dev_delete_param` | Work-Loop Sync |
| 4 | If `displayName`, `description`, or `pluginType` changed, `plugin_dev_update_metadata` was called | Work-Loop Sync |
| 4b | Every new/edited/deleted Addon Config Sample in `project.json` (and `.sample/`) was pushed via `plugin_dev_add_addon_config_sample` / `plugin_dev_update_addon_config_sample` / `plugin_dev_delete_addon_config_sample`; every entry has a non-empty `sampleId` | Work-Loop Sync (Addon Config Samples rows) |
| 5 | Every canvas-level change (machine config, plugin assignment, plugin param values, VLAN tweak) is staged via the appropriate `architect_*` tool AND the plan is applied (`architect_canvas_apply_plan` returned `applied=true`) | SKILL.md hard gates; Apply the Plan |
| 6 | Every `BUGS.md` entry for a fix applied this round shows `fix applied, awaiting redeploy validation` with a note describing what changed and where | Phase 3 → `BUGS.md` |
| 7 | If `plugin_dev_set_compatible_templates` was narrowed this session, it was called with the right OS slice | Phase 3 → Post-Build Assessment |

Only after every row is a confirmed "yes", preview the redeploy and say:

> "All fixes codified — vault synced, params synced, plan applied, `BUGS.md` updated. The redeploy preview says `<strategy>`: <effects>. Redeploy now? I'll monitor it."

If ANY row fails, fix it first. Do NOT propose a redeploy on an incomplete pass. If you can't complete a row (e.g., a TUS upload is still in flight), say so explicitly and either wait or schedule a wakeup before greenlighting.

## Monitoring In-Flight Builds

**This applies only while a build or redeploy is in flight** — not during steady-state debugging on an already-deployed VM (that runs at whatever pace you and the user iterate).

Builds typically take 5 to 15 minutes, sometimes far longer for heavy canvases. **Never sit idle blocking on one.**

- **Short waits:** poll `architect_deploy_list_status` every minute or two.
- **Longer waits:** use `ScheduleWakeup`. Default cadence 10 minutes (600s), good for the bulk of a build when nothing's imminent. Drop to 3 minutes (180s) when something specific is about to happen — a tricky plugin about to run, a phase you expect to fail, a fix you just codified and want to verify ASAP.
- **On each wake:** `architect_deploy_list_status` → `architect_deploy_list_failed` → spot-check the most recent failures via `architect_deploy_get_machine_details` / `architect_deploy_log_query_raw`.
- **Begin codifying root-cause fixes mid-build** when failures are unambiguous — don't wait for the build to finish. By the time it does, you can have YAML/param/vault changes ready and queued behind the Final Check gate.
- **Stop** once the build reports succeeded, failed, or cancelled and you have everything you need.

Each wake is a short, focused status pass — not a deep rabbit hole. Long investigations interleave fine with wakeups; idle waiting does not.
