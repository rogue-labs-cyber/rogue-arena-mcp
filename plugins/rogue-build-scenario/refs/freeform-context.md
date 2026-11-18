# Architect Freeform — Context Reference

> **For:** architect-freeform skill
> **Purpose:** Comprehensive reference for manual canvas operations
> **Cross-references:** refs/shared-rules.md for constants

## 1. Tool Categories

Architect MCP tools are grouped by prefix. Use `discover_tools` to see full descriptions.
- **Canvas tools** (`architect_canvas_*`): Read/set the settings the lab is built to (security posture, character style, size limits), check completeness and budget
- **VLAN tools** (`architect_vlan_*`): Create/list/wire VLANs, manage backstory and connections
- **Machine tools** (`architect_machine_*`): Create/configure machines, assign users, set notes
- **Plugin tools** (`architect_plugin_catalog_*` + `architect_assigned_plugin_*`): Search catalog, assign and configure plugins
- **Forest tools** (`architect_forest_*`): The company (the world record: organization and its dated history, story clock, roster, shared events), each domain's backstory and relationships, trusts
- **File tools** (`architect_files_*`): Seed realistic workplace files on machines
- **Deploy tools** (`architect_deploy_*`): Read-only deployment status and logs
- **Apply and build tools** (`architect_canvas_apply_plan`, `architect_canvas_start_build`, `architect_deployment_preview_redeploy`, `architect_deployment_redeploy`, `architect_canvas_remove_build`): apply staged changes and run Architect builds (see section 3)

Note: Deploy tools are lazy-loaded. Call `discover_tools(category: "ROGUE_ARCHITECT_BUILDER", subcategory: "deploy")` before first use.

## 2. Platform Hierarchy

Canvas > Domain > VLAN > Machine > Plugin. Resources MUST be created top-down in this order. You cannot add a machine to a VLAN that does not exist, or a plugin to a machine that does not exist. Deletions cascade downward — deleting a VLAN removes all its machines and their plugins.

Domain topology is declared via `architect_forest_manage` and materialized into VLANs. Each AD-enabled VLAN belongs to exactly one domain. VLANs hold machines; machines hold plugins and user assignments.

Read canvas state with `architect_canvas_get_overview` before any mutation to understand what already exists. Use `architect_vlan_list` and `architect_machine_list` to enumerate current entities.

## 3. Draft / Apply Plan Lifecycle

All mutations via MCP tools land in DRAFT state. Nothing is live until the plan is applied. Every write answers the entity's `name` and `id`; a later call names a machine, network or applied plugin by either.

An answer leads with the hub's notes when it has any. **Not used** lists fields the tool left out, each with the nearest field it does take: fix the name and send the call again. **Nothing was changed** means a write saved nothing. A refused call adds a **Hint** (the fix) and the **Fields** at fault, each with what was expected and what was sent.

Describe results as "staged," "queued," or "drafted" — never "deployed," "live," or "running." Drafts become real infrastructure only after the plan is applied and a build runs.

Multiple drafts can coexist. `architect_canvas_get_projected_state` previews what the canvas would look like after applying all pending drafts. Use it to sanity-check before you apply.

Draft deletions (removing an existing entity) are also staged — the entity remains visible with a pending-delete marker until the plan is applied.

**Applying the plan.** You apply it yourself: call `architect_canvas_apply_plan` (no input; it acts on the active canvas) after the user says the batch is done; if drafts you didn't stage are pending (for example a teammate's), name them and ask first. It runs the canvas precheck first. `applied=false` returns the blocking findings and changes nothing: fix them and call it again. It is refused when nothing is pending, when an Oracle conversation staged the pending plan last, or when the canvas changed while it was validating (re-read the canvas, then apply again). Applying builds nothing; a build is refused while changes are pending.

**Builds.** For the user's own canvas you run the Architect build tools directly. Each one provisions or tears down real VMs, so say what it will do and wait for the user's yes first.

- **First build:** `architect_canvas_start_build` with a new `clientCommandId` (a UUID). It is refused while changes are unapplied, and when every deployment slot is in use: tell the user to remove a deployment, then try again.
- **Redeploy an existing build:** call `architect_deployment_preview_redeploy`, tell the user the strategy and effects it returns, then call `architect_deployment_redeploy` with the build's `deploymentRecordId`, the returned `planToken` as `expectedPlanToken`, its strategy as `expectedStrategy`, and a new `clientCommandId`. A canvas change after the preview invalidates the token: preview again, never invent one.
- **Remove a build:** `architect_canvas_remove_build` with the builder `deploymentRecordId` (from `architect_deploy_list_status`) and a new `clientCommandId`.
- **Follow a build** with `architect_deploy_list_status` every minute or two. Builds typically take 5 to 15 minutes; stop when it reports the build succeeded, failed or was cancelled.

Reuse a `clientCommandId` only to retry the same request.

## 4. DC-First Ordering

Domain Controllers must be created before any domain-joined machine in the same domain. The DC establishes the domain — servers and workstations join it afterward. AD promotion (`ad-domain-controller` plugin) must be installed and configured on the DC before domain join plugins run on member machines.

**Per-VLAN creation order:** (1) Domain Controllers, (2) Servers, (3) Workstations. An AD-enabled VLAN that lacks a DC is an error — flag it before building anything else.

DC count guidance: 1 DC per domain for small scenarios (<20 VMs), 2 for medium (20-100 VMs), 3 for large (100+ VMs). Reserve 75-80% of VMs for workstations; DCs + servers should use <=25% of total VM budget.

## 5. Plugin Param Discovery Workflow

**LAW: Call `architect_plugin_catalog_list_full` with the plugin's `pluginId` BEFORE calling `architect_assigned_plugin_set_params`.** Field names vary between plugins — guessing produces silent misconfigurations that only surface at deployment. The same call also returns `addonConfigSamples[{ sampleId, name, notes, language }]` — the plugin's curated library of ready-to-deploy runtime config blobs.

Workflow: (1) Install plugin via `architect_assigned_plugin_add`, (2) call `architect_plugin_catalog_list_full` to get exact param names, types, descriptions, CSV headers, AND `addonConfigSamples[]`, (3) for any `stringBlock`-shaped runtime config param (Ghosts timelines, C2 profiles, rule sets), scan `addonConfigSamples[].notes` for a story-match against the machine's purpose / assigned user before authoring from scratch. On match, fetch via `architect_plugin_catalog_get_addon_config_sample({ sampleId })`, tweak in memory (substitute SAMs, hostnames, file paths), and pass the tweaked blob to `_set_params`. (4) Configure remaining params normally.

DISTINCT from `architect_plugin_catalog_get_example` — that tool returns plugin USAGE examples (param patterns + sibling plugins + machine context from real scenarios). `architect_plugin_catalog_get_addon_config_sample` returns the CONFIG content the plugin operates on. Use `_get_example` to learn how to wire a plugin into a machine; use `_get_addon_config_sample` to learn what to put inside one of its `stringBlock` params.

For DC CSV params (CreateUsers, CreateOUs, CreateGroups): `architect_plugin_catalog_list_full` returns each parameter's exact headers as `csvHeaders`. Use those headers verbatim — invented headers fail silently. CSV values are passed as raw strings (headers + rows, no code fences). Samples typically don't cover DC CSVs — those are scenario-identity, not runtime config.

Use `architect_plugin_catalog_search` to find plugins by name or category; `architect_plugin_catalog_list_full` on the candidates' `pluginIds` shows which ship curated content (`addonConfigSamples`). Stop searching after 3 catalog queries for the same plugin type — if it is not in the catalog, it does not exist.

## 6. Account Type Separation

Regular user accounts go on workstations ONLY, assigned with `isAdmin: false`. Admin accounts (`.sa` suffix, e.g. `john.smith.sa`) go on servers and DCs ONLY, assigned with `isAdmin: true`. Never mix account types on the wrong machine role.

Each workstation gets exactly ONE primary user. Each user gets at most ONE primary workstation. Multiple admins can share server access. A single person can hold both a regular workstation account and an admin server account — they are separate accounts on separate machines.

Username patterns: primary `firstname.lastname`, admin `firstname.lastname.sa` (or `a-firstname.lastname` — pick ONE convention per company and stick with it). Service accounts: `svc-{app}-{role}`.

Past admin profiles on workstations are allowed for forensic scenarios (stale scripts, old log files referencing former admins), but current active assignments must follow the separation rule.

## 7. Settings and the World Record

`architect_canvas_set_context` saves only the settings the lab is built to: `securityPosture`, `characterStyle`, `allowedFranchises` and `constraints` (`minMachines`, `maxMachines`, `minUsers`, `maxUsers`, `minDomains`, `maxDomains`). Every call replaces all four. **Safe update workflow:** read them with `architect_canvas_get_context` (its `profile`), change what the user asked for, and send all four back in one call.

The company itself is the world record: write it with `architect_forest_manage`, read it with `architect_forest_get_events` (its `world`). One call may carry several keys, saved together or not at all:
- `world`: `organization` (`name`, `business`, `sector`, `sites`, `departments` with each `head`'s roster account, `entities` for every other named organization, `products`, `culture`, `situation`, `founded`, the one dated `history`, and `conventions` with the one `mailDomain` ending in `.local`) and `storyClock` (`today`: nothing is dated after it). Each part you send replaces that part whole, so read it first and send it back whole with your change.
- `addPeople`: roster people by `account` (`name`, `kind`, `title`, `department`, `manager`, `mail`; the executives who run the company with `executive: true`). One with the same account is replaced.
- `generateStaff`: the background staff from counts per department; it replaces the generated tier whole.
- `addSharedEvents`: dated shared events by `id`, with their exact `facts` and the documents or mail behind them (`artifacts`).

## 8. Zone Classification & IP Addressing

See `refs/shared-rules.md` (VLAN Zone Classification, IP Addressing Strategy) for the full zone/IP reference. Key freeform rules:
- A VLAN's zone is written into its `aiNotes` at creation; enrichment does not change it
- Isolated VLANs require explicit firewall rules for any connectivity
- Gateway at `.1`, static `.2`-`.49` (DCs at `.10`-`.12`), DHCP `.50`-`.254`
- Firewall policy values: `allow_all` or `block_all` only (no `allow`/`deny`/`block`/`permit`). Protocol: `tcp`, `udp`, or `both` only
- Firewall rules apply in the order sent (first match wins, then `defaultPolicy`): critical allows first, then standard allows, then specific denies, then catch-alls
- `set_firewall_rules` replaces a direction's whole rule set: when a pair already has rules (`architect_vlan_get` `connections`, with `ruleCount`), send them back with the new ones and keep the existing default policy

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

See `refs/shared-rules.md` (Default Tool Discovery, Haiku Subagent Dispatch Pattern, Large Generation Confirmation Gate) for full patterns. Common tools are pre-loaded; deploy tools need `discover_tools` first (see Section 1 note).

### Content Policy

See `refs/shared-rules.md` (Content Appropriateness). Professional cybersecurity training only. No sexual/adult content. Red Rising Pinks = diplomats/administrators only.

### Security Posture & Domain Relationships

See `refs/shared-rules.md` (Security Posture, Domain Relationship Vocabularies) for full tables.

### Company History and Domain Stories

The company's events are its one dated history: `world.organization.history`, entries of `date` and `text`, sent with the rest of the organization (`architect_forest_manage` replaces the organization whole). Each entry names the executives involved and quantifies the impact (dollars, records, headcounts), and later entries follow from earlier ones. Target length: `max(3, numberOfDomains * 2)` entries. Each domain's own story goes in `addBackstories` (`domainFQDN`, `uniqueCharacteristics`, `primaryFunction`, `culturalNotes`) and the ties between domains in `addRelationships`; `updateBackstories` and `updateRelationships` change existing ones. The payload keys say the job; there is no operation field. Internal process: CHRONICLE (history) -> PORTRAITS (backstories) -> AD MATERIALIZATION (the OUs and groups the DC's CreateOUs and CreateGroups params create).

### User Assignment Richness

`architect_machine_assign_user` (`machine`, its name or id, and `account`, the account name, then the profile fields at its top level) must fill every field — sign-in (`isActivelyLoggedIn`, `isAdmin`), identity (`title`, `department`), personal background (`bio`, `age`, `gender`, `significantLifeEvents`, `pets`, `personalityTraits`, `hobbies`, `favoriteEntertainment`), and work behavior (`technicalSkill`, `filingHabits`, `workStyle`, `communicationStyle`, `employeeType`). It takes no directory placement: the OU path, groups and manager live in the DC's CreateUsers CSV and on the roster (`architect_forest_manage` `addPeople`). Sparse profiles produce empty file seeding downstream. Pull values from company context and DC CreateUsers CSV params.

### Autologon Plugin Requirement

Every workstation with a primary user needs an autologon plugin. Without it, the user assignment only exists in the canvas — Ansible will not actually log the user in on boot. Install after user assignment, configure with the assigned user's `samAccountName` and `password`.

### Backstory Event Ordering

Backstory enrichment follows a strict sequence: (1) shared VLAN events via `architect_vlan_manage_backstory` (`bpData.sharedEventPool` per VLAN), (2) per-user events and relationships via `architect_machine_manage_backstory` (`machine`, `userSamAccountName`, and `bpData` with `workplaceEvents` and `workplaceRelationships`, written from the user's own context and the VLAN's shared events). Later phases (relationships, files) depend on these existing first.

### File Seeding Targets

| Machine Type | Files Per Machine |
|---|---|
| Workstation | 10-18 |
| Server | 5-10 |
| Domain Controller | 5-10 |
| Local / utility | 3+ |

Every workstation manifest includes 1-2 email artifacts (OST, PST, or saved .eml). Files must span all 4 date-decay tiers (current 0-7 days, recent 8-30, older 31-90, archive 91-365) with at least 1 file older than 180 days, counted back from the story clock's `today` (a file's `modifiedAt`). Each file's `summary`: 50+ characters with WHO/WHAT/WHY/WHEN.

### Common Operations Quick Reference

- **Add a Windows DC:** `architect_machine_add` (`role: domain_controller`, `baseTemplateId`: a Windows Server 2022 template's name or id from `architect_plugin_catalog_list_templates`) -> `architect_assigned_plugin_add` (ad-domain-controller) -> `architect_plugin_catalog_list_full` -> `architect_assigned_plugin_set_params` (CreateUsers CSV, CreateOUs CSV, CreateGroups CSV)
- **Wire two VLANs:** `architect_vlan_manage_connection` with `operation: set_firewall_rules`, `sourceVlan`, `targetVlan` and `firewallRules` (`defaultPolicy`, `rules`), once per direction; it takes no trust level. AD-trusting pairs take `defaultPolicy: allow_all` with no rules (the AD trust note in `refs/shared-rules.md`).
- **Check what's missing:** `architect_canvas_get_overview` returns the full canvas state — empty plugin slots, machines without roles, and VLANs without machines all surface here.
- **Swap a plugin:** `architect_assigned_plugin_delete` the old one, then `architect_assigned_plugin_add` the new one. Re-discover params via catalog before configuring.
- **Add machine notes:** `architect_machine_update` with `aiNotes` field containing freeform text describing the machine's role in the learning flow or notable configuration details.
- **Search for anything:** `architect_canvas_global_search` with `searchTerms` (short keywords such as `["Vader", "CEO"]`, each matched on its own) searches plugin param values, machine notes, user assignments and VLAN notes in one call.
- **Modify the company:** read the world record with `architect_forest_get_events`, change it, and write it back with `architect_forest_manage` (`world` parts whole; people by `addPeople`). The settings go through `architect_canvas_set_context`, all four in one call.
- **Add a user to a workstation:** `architect_machine_assign_user` with `machine`, `account` and every profile field filled. Then install autologon plugin with the user's credentials.
- **Seed files on a machine:** the world record first (`architect_forest_manage` `world` with the organization and story clock, `addPeople` with the machine's accounts), then `architect_files_get_seeding_context` for user/machine context (write nothing for a machine whose `storyReady` is false) -> one call per file to the write tool for its kind (`architect_files_write_text`, `architect_files_write_log`, `architect_files_write_document`, `architect_files_write_sheet`, `architect_files_write_deck` or `architect_files_write_mail`). Each tool's schema is that kind's whole shape, and the file name's ending gives the format.
- **Check AD data:** DC plugin params hold the source of truth — use `architect_assigned_plugin_get_param` for CreateUsers/CreateOUs/CreateGroups, or `architect_canvas_global_search` with an account or group name.
- **Validate infrastructure:** Read-only audit via `architect_canvas_get_overview` and per-machine `architect_machine_get`. Hand off to `architect-final-validate` for the full pre-deploy audit. Never mutates canvas state.
