# Domains Phase — Reference Doc

> **For:** architect-implementor Phase B (domains step)
> **Do not add:** persona blocks, trigger phrases, user interaction framing

## Overview

The domains phase designs Active Directory forest topology and creates VLANs as network containers that hold machines. Forest events feed domain backstories, domain backstories feed VLAN purpose, and VLAN machine manifests feed the machines phase. If the foundation is thin or disconnected, every downstream phase inherits that weakness.

The work spans three stages: (1) design forest topology with rich event timelines, (2) create VLANs as containers with purpose and zone, (3) plan machine manifests per VLAN for handoff to the machines phase. Forest event generation within Stage 1 runs its own internal 3-phase process (CHRONICLE -> PORTRAITS -> AD MATERIALIZATION) -- see GATE 3.

## Core Rules

Do not use TodoWrite during build execution. The gate sequence is the progress tracker.

1. Forest events run the full 3-phase generation process (CHRONICLE -> PORTRAITS -> AD MATERIALIZATION). Each phase feeds the next; partial generation produces thin downstream output.
2. Forest events always use a subagent (single call). VLAN purpose uses parallel subagents when 3+ VLANs exist; for 1-2 VLANs, the orchestrator may generate inline since parallelism savings don't justify dispatch overhead. Either path hands the output through to the `bpData` field.
3. `architect_forest_manage(operation: "generate")` creates fresh events and replaces all existing ones. `architect_forest_manage(operation: "update")` appends to existing events -- use for ADD_VLAN. The two operations are not interchangeable.
4. VLANs are containers for purpose and zone only. AD objects (OUs, groups, users) are configured later via DC plugin params (CreateOUs, CreateGroups, CreateUsers CSVs) after the DC machine is created.
5. Budget, FQDN case, plugin provenance, and DC-first ordering rules live in the Gates section below.

Event descriptions name 1-3 leadership team members, quantify impact (dollar amounts, record counts, headcounts), and trace consequences -- "A data breach occurred" does not meet this bar.

## Phase 1: Forest Topology

> **Staging:** Forest events for the `set` operation are staged per `refs/shared-rules.md`. Read the `architect_forest_manage` description for path (`staging/forest/`) and sections (`events.json`, `backstories.json`, `relationships.json`). `add_events` and `update_events` are NOT staged — call directly with small payloads.

### Decision Heuristics

Translate the company narrative into domain topology:

| Company Narrative Element | Domain Topology Decision |
|---|---|
| Subsidiaries | Child domains under the parent |
| Acquisitions | External trusts with legacy naming, or child domains |
| Business units / divisions | Domain trees within the forest |
| Secondary locations | Additional domains with AD sites |
| Security incidents in history | Forensics OUs, incident response groups, trust downgrades |
| `securityPosture` | See [shared-rules.md SS Security Posture](../../refs/shared-rules.md#security-posture) for how each posture shapes topology |

Explicit user constraints (machine caps, domain limits) are hard limits. Single-domain scenarios run the full workflow with `trusts: []`.

### Forest Event Guidelines

Target event count: `max(3, numberOfPlannedDomains * 2)` events, distributed across domains.

Events form **interconnected causality chains** -- a 2019 acquisition leads to a 2020 integration struggle, which leads to a 2021 breach via unpatched legacy systems, which triggers a 2022 SOC buildout. Every event references 1-3 leadership team members by name and quantifies impact (dollar amounts, record counts, headcounts).

Event types: `breach`, `scandal`, `merger`, `lawsuit`, `restructuring`, `expansion`, `layoff`, `acquisition`, `compliance_failure`, `executive_change`, `spinoff`.

### 3-Phase Generation (CHRONICLE -> PORTRAITS -> AD MATERIALIZATION)

Forest events are generated in three sequential phases. Each phase has one job.

**Phase 1a: CHRONICLE (Event Timeline).** Write an interconnected corporate timeline. Each event requires: `id` (e.g. `evt-breach-2021`), `type`, `year` (1990-2030), `title` (min 5 chars), `description` (min 20 chars, naming leaders and quantifying impact), `affectedDomains[]`. Events reference prior events by ID to form causality chains.

**Phase 1b: PORTRAITS (Domain Biographies).** Write the definitive profile of each AD domain. Each portrait requires: `domainFQDN`, `uniqueCharacteristics` (full paragraph with acquisition history, legacy infrastructure, OU layout quirks, service account naming conventions, political dynamics), `primaryFunction`, `culturalNotes`, `userCount`.

Specificity requirements for portraits -- pack with concrete, inventable details:
- Naming conventions with prefixes: `gl-svc-*`, `svc-corp-*`, `CP-GRP-*`
- VLAN numbers and subnet details: VLAN 847, VLAN 310
- Specific servers and hardware: SCCM-CORP-01, JMP-CLIN-01
- Named service accounts: svc-corp-legacybackup running as domain admin
- Admin counts and access details: 3 Tier 0 admins, 7 PAW workstations
- Team culture markers: Slack channels (#the-island), nicknames ("mainlanders")
- Legacy infrastructure that survived events: orphaned accounts, deprecated OUs

Domain differentiation by archetype:
- **Root/HQ**: Deep OU hierarchies, strict naming, change-averse governance
- **Acquired**: Legacy naming from pre-acquisition, resistance to standardization, hybrid infrastructure
- **Clinical/regulated**: Hardened configs, jump-box-only access, compliance-driven change windows
- **Finance**: Audit-heavy, isolated segments, SOX-compliant reviews
- **Remote/satellite**: Bandwidth constraints, relaxed policies, audited last

**Phase 1c: AD MATERIALIZATION (Events + Portraits -> AD Artifacts).** Translate events and portraits into concrete AD artifacts. For every event, determine what OUs, security groups, departments, and service accounts would exist as a direct consequence. Artifacts must be proportional to event severity.

**Event-driven artifacts** shape domain distinctiveness: a breach produces `OU=IncidentResponse` + `GRP-ForensicsTeam`; a merger produces legacy OUs + migration groups; a restructuring produces transitional OUs; a compliance failure produces `OU=AuditHold` + restrictive GPOs. Domains without event artifacts look identical -- the events are what make each domain feel lived-in. Pull shared OU hierarchy, security group tiering, and service account conventions from [shared-rules.md SS AD Structure Conventions](../../refs/shared-rules.md#ad-structure-conventions).

#### Example: Acquired Startup Domain Portrait

```json
{
  "domainFQDN": "research.meridian.local",
  "uniqueCharacteristics": "Originally GeneLabs Inc., a 30-person genomics startup acquired in 2019 for their CRISPR platform. The domain preserves the original flat OU layout from pre-acquisition — IT has attempted three migration projects, each abandoned after the GeneLabs veterans threatened to walk. Service accounts use the old 'gl-svc-*' naming convention instead of the corporate 'SVC-' standard because the GeneLabs CTO negotiated AD independence as part of the acquisition terms. Houses the only air-gapped lab subnet (VLAN 847) and the sole remaining NetApp filer nobody can decommission. After the 2021 breach, trust was downgraded from bidirectional to selective.",
  "primaryFunction": "Clinical trial data management, genomics research computing, regulatory submission preparation",
  "culturalNotes": "Fiercely autonomous — the GeneLabs veterans see corporate IT as bureaucratic overhead. The VP of Research reports directly to the CEO, bypassing the CTO. Their Slack channel is called #the-island. New hires from corporate are called 'mainlanders' for their first year.",
  "userCount": 120
}
```

### Haiku Subagent Dispatch

See [shared-rules.md SS Subagent Dispatch Pattern](../../refs/shared-rules.md#haiku-subagent-dispatch-pattern) for the canonical template shape.

**Per-skill context block:** planned domains FQDNs, company context summary, target event count, leadership roster.

**Step 3 instruction:** "Follow the 3-phase generation process (CHRONICLE -> PORTRAITS -> AD MATERIALIZATION) and output the complete JSON payload for `architect_forest_manage`. Return ONLY JSON."

After the subagent returns JSON, verify: all FQDNs lowercase, event descriptions name leadership by name, events reference prior events by ID, domain portraits include concrete specifics, each portrait has distinct personality.

## Phase 2: VLAN Containers

### Budget Allocation

Distribute the total machine budget across VLANs proportionally:

| VLAN Type | Budget Share | Rationale |
|---|---|---|
| Root domain | 25-40% | Core infrastructure, most services |
| Child domains | 15-30% each | Departmental or subsidiary infrastructure |
| DMZ / standalone | 5-15% | Minimal, internet-facing or isolated |

Rules:
- Every VLAN gets at least 1 machine.
- AD-enabled VLANs need at least 1 DC.
- Show the math: `[DC:1 + servers:2 + ws:3 = 6] <= budget(8)`.
- Print a budget allocation table before proceeding.
- **Respect the server/workstation ratio from [shared-rules.md SS Server/Workstation Ratio](../../refs/shared-rules.md#serverworkstation-ratio-critical).** Sum workstations and servers across every VLAN, compute the ratio, and verify it matches the company size tier (70/30 for small, 75/25 for medium, 80/20 for large). If the draft distribution violates the ratio, redistribute before submitting to `architect_vlan_add`.

Resource cost estimation defaults: Servers/DCs = 2GB RAM, 2 CPU cores; Workstations = 1GB RAM, 2 CPU cores; User-controllable machines = 6GB RAM, 4 CPU cores. If estimated totals exceed `resourceBudget.remaining`, reduce before proceeding.

### Plugin Resolution

Search the catalog with max 2 broad `architect_plugin_catalog_search` calls for initial VLAN-to-category resolution. (Targeted per-plugin fallback lookups during machine build are governed by the machines phase and run up to 3 queries per missing plugin.) Match plugins to VLANs by category:

| Plugin Category | Target VLANs |
|---|---|
| `active_directory` | AD-enabled VLANs (for DCs) |
| `file_server`, `web_server`, `database` | Server roles based on VLAN purpose |
| `domain_membership` | All AD-enabled VLANs (workstations + member servers) |
| `vulnerability` | 2-3 vulnerability plugins per VLAN for attack surface |

Every VLAN receives at least 1 relevant plugin.

### Per-VLAN Build

For each VLAN, generate bpData with purpose and zone, then call `architect_vlan_add`.

The `purpose` field (min 30 chars) includes: machine types, domain join status, communication patterns, business function with industry-specific apps, and security posture reality. Great purposes read like a sysadmin's honest assessment of a real network segment.

`architect_vlan_add` also accepts an `aiNotes` string — a free-text field for AI-generated notes and context about this VLAN (e.g. design rationale, domain-specific quirks, backstory highlights) that persists alongside the blueprint data. Populate it when there is meaningful context beyond what fits in `purpose`.

For 3+ VLANs, spawn haiku subagents in parallel -- one per VLAN. Their outputs are independent. See [shared-rules.md SS Subagent Dispatch Pattern](../../refs/shared-rules.md#haiku-subagent-dispatch-pattern) for the canonical template shape.

**Per-skill context block:** VLAN name, purpose, domain FQDN, company context (name, industry, departments), security posture, machine budget for this VLAN.

**Step 3 instruction:** "Generate bpData with purpose and zone. AD structure is configured later via DC plugin params after the DC machine is created. Return ONLY the bpData JSON -- the machine manifest is produced in Phase 3 by the orchestrator, not by this subagent."

For fewer than 3 VLANs, generate bpData inline without subagents.

## Phase 3: Machine Manifest Planning

For each VLAN, plan which machines it needs. This is handoff to the machines phase -- the domains phase plans, machines executes.

**Handoff is conversation-only.** The manifest output lives in orchestrator conversation -- there is no backend persistence tool for it. If the user ends the session or clears context between domains and machines, the manifest is lost and domains must re-run. The implementor warns the user before they end a session mid-cascade.

**AD-enabled VLANs:**
- 1+ Domain Controller (always first -- it creates the domain)
- Servers matching VLAN purpose (file, web, database, application)
- Workstations for the departments this VLAN serves

**DMZ / standalone VLANs:**
- No DC. Mostly servers (web, proxy, bastion).
- Workgroup machines only.

### DC-First Ordering

For AD-enabled VLANs, the Domain Controller is item #1 in the machine manifest. It establishes the domain that all other machines join.

### Complexity Ratings

DCs are complex (create first), servers are medium, workstations are simple (create last). Include these ratings in the manifest so the machines phase knows creation order.

### Machine Manifest Format

```
VLAN: {name} ({nodeId})
Domain: {fqdn}
AD-enabled: yes/no
DC-first: yes (if AD-enabled)

Machines (DC is item #1 in AD-enabled VLANs):
1. namingGuidance: "DC01-style name"
   role: domain-controller
   purpose: "Primary DC for {domain}"
   plugins: [{pluginVersionId, displayName, required: true}]
   complexity: complex

2. namingGuidance: "APP01-style name"
   role: application-server
   purpose: "Hosts {application} for {department}"
   plugins: [{pluginVersionId, displayName, required: true}]
   complexity: medium

3. namingGuidance: "WS01-style name"
   role: workstation
   purpose: "{department} user workstation"
   plugins: [{pluginVersionId, displayName, required: false}]
   complexity: simple
```

## Domain Knowledge

### Cross-Domain Relationships

For multi-domain forests, describe how domains relate. Each relationship has: `fromDomain`, `toDomain`, `type`, `description`.

See [shared-rules.md SS Domain Relationship Vocabularies](../../refs/shared-rules.md#domain-relationship-vocabularies) for the canonical `CrossDomainRelationshipType` list and AD-direction defaults.

For single-domain forests: `trusts: []`.

### VLAN Purpose and Zone Rules

**Purpose field** (min 30 chars) includes: machine types, domain join status, communication patterns, business function with industry-specific apps, and security posture reality. Posture-driven purpose text is defined in [shared-rules.md SS Security Posture](../../refs/shared-rules.md#security-posture).

**Zone classification**: See [shared-rules.md SS VLAN Zone Classification](../../refs/shared-rules.md#vlan-zone-classification).

**DC budget** and resource allocation defaults: See [shared-rules.md SS Domain Controller Budget](../../refs/shared-rules.md#domain-controller-budget).

### Workstation Application Grounding

The implementor must name specific, real-world business applications appropriate to the company's industry when describing workstation purposes.

## Breadcrumb

Domain trust wiring (firewall rules, AD ports, VLAN connections, zone matrix) is implemented by the enrichment phase's network section after machines exist.

## CREATE Workflow (New Canvas)

Execution sequence:

1. `architect_canvas_get_overview` -- read canvas state
2. `architect_canvas_get_context` -- read full company narrative
3. `architect_vlan_delete` x N -- clear existing VLANs if starting fresh
4. Decide `plannedDomains[]` -- FQDNs (lowercase) + purposes from company narrative
5. Spawn subagent for forest events -> `architect_forest_manage` (generate) with `plannedDomains[]`
6. `architect_plugin_catalog_search` -- broad search for machine roles (max 2 calls)
7. Allocate machine budget across VLANs. Print budget table. Verify sum equals total.
8. For each VLAN: generate bpData (purpose, zone) -> `architect_vlan_add`. Use subagents for 3+ VLANs.
9. `architect_vlan_list` -- read back created VLANs to get `vlanNodeIds`
10. Plan machine manifests per VLAN. Verify DC-first, plugin provenance, budget match.
11. The implementor runs completeness verification (`architect_canvas_get_completeness`) after this phase completes.

## ADD_VLAN Workflow (Existing Canvas)

Execution sequence:

1. `architect_canvas_get_overview` -- read existing state
2. `architect_canvas_get_context` -- verify company profile exists
3. Decide new `plannedDomains[]` -- lowercase FQDNs
4. Spawn subagent -> `architect_forest_manage` (update, not generate which overwrites)
5. Steps 6-11 same as CREATE workflow

## Gates

**GATE 1: FQDN Case.** All `domainFQDN` values are lowercase. Case-sensitive matching breaks on mixed case -- the implementor must confirm the lowercase form before calling any tool that accepts a domain FQDN.

**GATE 2: Causality Chain.** Every forest event references at least one prior event by ID in its description. Disconnected events produce a timeline, not a story -- rewrite instead of shipping.

**GATE 3: 3-Phase Completeness.** All three phases (CHRONICLE, PORTRAITS, AD MATERIALIZATION) complete for every domain. Subagent output missing a phase goes back with explicit instructions.

**GATE 4: Budget Arithmetic.** VLAN machine allocations sum exactly to the total machine budget from `resourceBudget.quotas.maxMachines`. Print a budget table; fix any mismatch before proceeding.

**GATE 5: Plugin Provenance.** Every `pluginVersionId` comes from an `architect_plugin_catalog_search` result in this session. If the catalog response line is not citable, the ID is hallucinated.

**GATE 6: DC-First.** The Domain Controller is item #1 in every AD-enabled VLAN manifest -- it establishes the domain that all other machines join.

## Constraints

- Maximum 2 broad `architect_plugin_catalog_search` calls for VLAN-to-category resolution. Per-plugin fallback during the machines phase runs up to 3 queries for that specific plugin (machines phase governs that).
- Subagents generate bpData per the Subagent Dispatch Pattern; the domains phase passes results through to the `bpData` field unchanged.
- Every VLAN gets at least 1 plugin and at least 1 machine.
- Company context must exist before generating forest events (`architect_canvas_get_context`).
- Subagent instructions include the path to `shared-rules.md` for size limits and naming conventions.
- The implementor runs completeness verification (`architect_canvas_get_completeness`) after this phase completes.
- Flag unrealistic budgets (e.g., 3 AD-enabled VLANs with a budget of 4) before generating.
- Only assign plugins that serve a real role on the VLAN -- skip force-fits.

Final check: every domainFQDN lowercase, every pluginVersionId from a catalog search this session, DC is item #1 in every AD-enabled VLAN.
