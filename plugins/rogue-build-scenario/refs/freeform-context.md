# Architect Freeform — Context Reference

> **For:** architect-freeform skill
> **Purpose:** Comprehensive reference for manual canvas operations
> **Cross-references:** refs/shared-rules.md for constants

## 1. Tool Categories

Architect MCP tools are grouped by prefix. Use `discover_tools` to see full descriptions.
- **Canvas tools** (`architect_canvas_*`): Read/set company context, check completeness and budget
- **VLAN tools** (`architect_vlan_*`): Create/list/wire VLANs, manage backstory and connections
- **Machine tools** (`architect_machine_*`): Create/configure machines, assign users, set notes
- **Plugin tools** (`architect_plugin_catalog_*` + `architect_assigned_plugin_*`): Search catalog, assign and configure plugins
- **Forest tools** (`architect_forest_*`): Manage domain topology, events, trusts
- **Exploit tools** (`architect_exploit_*`): Paths, hops, credentials, technique catalog, reachability
- **File tools** (`architect_files_*`): Seed realistic workplace files on machines
- **Deploy tools** (`architect_deploy_*`): Read-only deployment status and logs

Note: Exploit and deploy tools are lazy-loaded. Call `discover_tools(category: "ROGUE_ARCHITECT_BUILDER", subcategory: "exploit")` before first use. The available exploit tools are: `architect_exploit_technique_list`, `architect_exploit_plugin_find`.

## 2. Platform Hierarchy

Canvas > Domain > VLAN > Machine > Plugin. Resources MUST be created top-down in this order. You cannot add a machine to a VLAN that does not exist, or a plugin to a machine that does not exist. Deletions cascade downward — deleting a VLAN removes all its machines and their plugins.

Domain topology is declared via `architect_forest_manage` and materialized into VLANs. Each AD-enabled VLAN belongs to exactly one domain. VLANs hold machines; machines hold plugins and user assignments.

Read canvas state with `architect_canvas_get_overview` before any mutation to understand what already exists. Use `architect_vlan_list` and `architect_machine_list` to enumerate current entities.

## 3. Draft / Apply Plan Lifecycle

All mutations via MCP tools land in DRAFT state. Nothing is live until the user clicks Apply Plan in the UI. The backend returns draft `nodeId` values for every created entity — use these nodeIds for all subsequent tool calls, never raw canvas UUIDs.

Describe results as "staged," "queued," or "drafted" — never "deployed," "live," or "running." The user controls when drafts become real infrastructure.

Multiple drafts can coexist. `architect_canvas_get_projected_state` previews what the canvas would look like after applying all pending drafts. Use it to sanity-check before the user applies.

Draft deletions (removing an existing entity) are also staged — the entity remains visible with a pending-delete marker until Apply Plan runs.

## 4. DC-First Ordering

Domain Controllers must be created before any domain-joined machine in the same domain. The DC establishes the domain — servers and workstations join it afterward. AD promotion (`ad-domain-controller` plugin) must be installed and configured on the DC before domain join plugins run on member machines.

**Per-VLAN creation order:** (1) Domain Controllers, (2) Servers, (3) Workstations. An AD-enabled VLAN that lacks a DC is an error — flag it before building anything else.

DC count guidance: 1 DC per domain for small scenarios (<20 VMs), 2 for medium (20-100 VMs), 3 for large (100+ VMs). Reserve 75-80% of VMs for workstations; DCs + servers should use <=25% of total VM budget.

## 5. Plugin Param Discovery Workflow

**LAW: Call `architect_plugin_catalog_list_full` with the plugin's `pluginVersionId` BEFORE calling `architect_assigned_plugin_set_params`.** Field names vary between plugin versions — guessing produces silent misconfigurations that only surface at deployment.

Workflow: (1) Install plugin via `architect_assigned_plugin_add`, (2) call `architect_plugin_catalog_list_full` to get exact param names, types, descriptions, and CSV headers, (3) call `architect_assigned_plugin_set_params` with the discovered field names.

For DC CSV params (CreateUsers, CreateOUs, CreateGroups): the catalog returns exact header schemas via `ifCSVListOfHeaderStringValues`. Use those headers verbatim — invented headers fail silently. CSV values are passed as raw strings (headers + rows, no code fences).

Use `architect_plugin_catalog_search` to find plugins by name or category. Use `architect_plugin_catalog_get_example` for sample param values. Stop searching after 3 catalog queries for the same plugin type — if it is not in the catalog, it does not exist.

## 6. Account Type Separation

Regular user accounts (`accountType: "regular"`) go on workstations ONLY with `hasAdminAccess: false`. Admin accounts (`accountType: "admin"`, `.sa` suffix, e.g. `john.smith.sa`) go on servers and DCs ONLY with `hasAdminAccess: true`. Never mix account types on the wrong machine role.

Each workstation gets exactly ONE primary user. Each user gets at most ONE primary workstation. Multiple admins can share server access. A single person can hold both a regular workstation account and an admin server account — they are separate accounts on separate machines.

Username patterns: primary `firstname.lastname`, admin `firstname.lastname.sa` (or `a-firstname.lastname` — pick ONE convention per company and stick with it). Service accounts: `svc-{app}-{role}`.

Past admin profiles on workstations are allowed for forensic scenarios (stale scripts, old log files referencing former admins), but current active assignments must follow the separation rule.

## 7. set_context REPLACE Semantics

`architect_canvas_set_context` uses REPLACE semantics — each call overwrites ALL previous context entirely. A second call destroys the first call's data.

**Safe update workflow:** (1) Read existing context via `architect_canvas_get_context`, (2) merge your changes into the existing payload, (3) write the merged result in a single `architect_canvas_set_context` call.

The `bpData` payload contains: `companyProfile`, `leadership`, and `technicalInfra`. Omitting any section from the call deletes it. Always include all three sections, even unchanged ones.

The `prompt` field is optional metadata for the audit trail. Auto-stored artifacts (`company_context`, `user_profiles`) are derived from bpData — no separate storage calls needed.

## 8. Zone Classification & IP Addressing

See `refs/shared-rules.md` (VLAN Zone Classification, IP Addressing Strategy) for the full zone/IP reference. Key freeform rules:
- Zones are set at VLAN creation and cannot be changed later
- Isolated VLANs require explicit firewall rules for any connectivity
- Gateway at `.1`, static `.2`-`.49` (DCs at `.10`-`.12`), DHCP `.50`-`.254`
- Firewall policy values: `allow_all` or `block_all` only (no `allow`/`deny`/`block`/`permit`). Protocol: `tcp`, `udp`, or `both` only
- Firewall priority bands: 1-100 critical allow, 101-500 standard allow, 501-900 specific deny, 901-999 catch-all
- If `manualRuleCount > 0` on a VLAN pair, add new rules alongside existing ones and preserve existing default policy

## 9. Naming Conventions

See `refs/shared-rules.md` (Hostname Rules, AD Structure Conventions) for full naming reference. Key freeform rules:
- Hostnames max 15 chars (NetBIOS). Formula: PREFIX (3-4) + TYPE (2-4) + NUMBER (2-3)
- All FQDNs lowercase, `.local` suffix. All hostnames globally unique across domains
- OU path format: `OU={Name},OU={Parent},DC=domain,DC=local`. List parents before children

## 10. Budget Enforcement

See `refs/shared-rules.md` (Company Size Limits, Resource Allocation Defaults, Server/Workstation Ratio) for full tables. Key freeform rules:
- Always check `architect_canvas_get_budget` before adding machines — server-side rejects over-budget additions
- Plugins may auto-set higher RAM/CPU on install; re-check budget after plugin installs
- Do NOT deploy more servers than workstations. Ratio: Small 70/30, Medium 75/25, Large 80/20

## Additional Context

### Tool Discovery & Subagents

See `refs/shared-rules.md` (Default Tool Discovery, Haiku Subagent Dispatch Pattern, Large Generation Confirmation Gate) for full patterns. Common tools are pre-loaded; exploit and deploy tools need `discover_tools` first (see Section 1 note).

### Content Policy

See `refs/shared-rules.md` (Content Appropriateness). Professional cybersecurity training only. No sexual/adult content. Red Rising Pinks = diplomats/administrators only.

### Security Posture & Domain Relationships

See `refs/shared-rules.md` (Security Posture, Domain Relationship Vocabularies) for full tables. Key freeform note:

**NOTE:** `architect_forest_get_domain_trusts` currently returns `trustDirection: 'bidirectional'` for all forest-event-derived trusts. Trust direction data may be inaccurate for acquisitions and parent_child relationships.

### Forest Event Generation

Use `architect_forest_manage(operation: "generate")` for fresh events (replaces all). Use `operation: "update"` to append — not interchangeable. Events form causality chains referencing prior events by ID. Target count: `max(3, numberOfDomains * 2)`. Descriptions must name leadership and quantify impact (dollars, records, headcounts). Internal process: CHRONICLE -> PORTRAITS -> AD MATERIALIZATION.

### User Assignment Richness

`architect_machine_manage_user` bpData must fill every field — identity, personal background (bio, hobbies, pets, personality, entertainment), work behavior (technical skill, filing habits, work style, communication style), and AD placement (OU path, groups, manager). Sparse profiles produce empty file seeding downstream. Pull values from company context and DC CreateUsers CSV params.

### Autologon Plugin Requirement

Every workstation with a primary user needs an autologon plugin. Without it, the user assignment only exists in the canvas — Ansible will not actually log the user in on boot. Install after user assignment, configure with the assigned user's `samAccountName` and `password`.

### Backstory Event Ordering

Backstory enrichment follows a strict sequence: (1) shared VLAN events via `architect_vlan_manage_backstory`, (2) shared machine events via `architect_machine_manage_backstory(operation: 'generate_shared_events')`, (3) per-user events via `architect_machine_manage_backstory(operation: 'generate')` with 100+ character prompts. Later phases (relationships, files) depend on these existing first.

### Crown Jewel

The crown jewel is declared in `exploit.yml`'s top-level `crownJewel` block — YAML-only, not stored in the hub. The `crownJewel.machine` field names the endgame machine; `crownJewel.description` provides business context (dollar amounts, record counts, fine risk). In freeform mode, you can stamp a crown jewel breadcrumb onto a machine by calling `architect_machine_update` with `aiNotes: "Crown jewel: {description}"`. There is no hub API for crown jewel state — the YAML block is the single source of truth.

### Exploit Path Constraints

- Maximum 15 hops, 15 credentials, 5 variations per path
- Call `architect_exploit_technique_list` and `architect_exploit_plugin_find` BEFORE designing any hop — every technique must come from a catalog result
- Credential sub-types must match across a chain (4 canonical sub-types: `password`, `hash`, `ticket`, `key` — `password→password`, `hash→hash`, etc.)
- Use different credential harvesting methods per hop and span all three `implementationType` values (`plugin`, `file_seeding`, `attacker_action`)
- Paths should touch every domain on the canvas

### File Seeding Targets

| Machine Type | Files Per Machine |
|---|---|
| Workstation | 10-18 |
| Server | 5-10 |
| Domain Controller | 5-10 |
| Local / utility | 3+ |

Every workstation manifest includes 1-2 email artifacts (OST, PST, or saved .eml). Files must span all 4 date-decay tiers (current 0-7 days, recent 8-30, older 31-90, archive 91-365) with at least 1 file older than 180 days. Topic fields: 50+ characters with WHO/WHAT/WHY/WHEN. Vulnerable files (`isVulnerabilityFile: true`) are placed by the exploits phase, not by file seeding.

### Common Operations Quick Reference

- **Add a Windows DC:** `architect_machine_add` (role: domain_controller, OS: WindowsServer2022) -> `architect_assigned_plugin_add` (ad-domain-controller) -> `architect_plugin_catalog_list_full` -> `architect_assigned_plugin_set_params` (CreateUsers CSV, CreateOUs CSV, CreateGroups CSV)
- **Wire two VLANs:** `architect_vlan_manage_connection` with trust level, firewall rules, and default policy. AD-trusting pairs need rules for ports 88, 389, 636, 445, 53, 3268, 3269.
- **Check what's missing:** `architect_canvas_get_completeness` returns per-machine percentages and specific gaps. Below 100% means something is missing.
- **Swap a plugin:** `architect_assigned_plugin_delete` the old one, then `architect_assigned_plugin_add` the new one. Re-discover params via catalog before configuring.
- **Add machine notes:** `architect_machine_update` with `aiNotes` field containing freeform text describing the machine's role in the learning flow or notable configuration details.
- **Search for anything:** `architect_canvas_global_search` searches across all entity types — users, machines, plugins, params. Use field hints like `["username", "displayname"]` to narrow results.
- **Modify company context:** Read via `architect_canvas_get_context`, merge changes, write back via `architect_canvas_set_context` (single call, all sections included).
- **Add a user to a workstation:** `architect_machine_manage_user` with full bpData (every field filled). Then install autologon plugin with the user's credentials.
- **Seed files on a machine:** `architect_files_get_seeding_context` first to get user/machine context -> `architect_files_create` per file entry (batch up to 20 per call).
- **Design an exploit path:** inventory techniques via `architect_exploit_technique_list` -> check VLAN connection rules via `architect_vlan_get` (zone + firewall rules show whether a path exists) -> commit hops to `exploit.yml` after user confirms plan. Canvas materializes from the YAML at apply time.
- **Resume an exploit path:** read `exploit.yml` from the scenario directory for planning context -> read canvas state via `architect_canvas_get_overview` to see what has been materialized -> resume based on state.
- **Check AD data:** DC plugin params hold the source of truth — use `architect_assigned_plugin_get_param` for CreateUsers/CreateOUs/CreateGroups, or `architect_canvas_global_search` with field hints.
- **Validate infrastructure:** Read-only audit via `architect_canvas_get_overview`, `architect_canvas_get_completeness`, and per-machine `architect_machine_get`. Never mutates canvas state.
