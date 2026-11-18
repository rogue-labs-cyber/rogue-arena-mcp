# Domains Phase — Reference Doc

> **For:** flow-implement Phase B (domains step)
> **Do not add:** persona blocks, trigger phrases, user interaction framing

## Overview

The domains phase designs Active Directory forest topology and creates VLANs as network containers that hold machines. The company's dated history feeds domain backstories, domain backstories feed VLAN purpose, and VLAN machine manifests feed the machines phase. If the foundation is thin or disconnected, every downstream phase inherits that weakness.

The work spans three stages: (1) design forest topology with a rich dated history, (2) create VLANs as containers with purpose and zone, (3) plan machine manifests per VLAN for handoff to the machines phase. The forest story within Stage 1 runs its own internal 3-phase process (CHRONICLE -> PORTRAITS -> AD MATERIALIZATION) -- see GATE 3.

## Core Rules

Do not use TodoWrite during build execution. The gate sequence is the progress tracker.

1. The forest story runs the full 3-phase generation process (CHRONICLE -> PORTRAITS -> AD MATERIALIZATION). Each phase feeds the next; partial generation produces thin downstream output.
2. The forest story always uses a subagent (single call). VLAN purpose uses parallel subagents when 3+ VLANs exist; for 1-2 VLANs, the orchestrator may generate inline since parallelism savings don't justify dispatch overhead. The story goes through to `architect_forest_manage` (`world.organization` with its `history`, `addBackstories`, `addRelationships`); a VLAN's purpose and zone go through to `architect_vlan_add`'s `aiNotes`.
3. `architect_forest_manage` replaces `world.organization` whole when it is sent: read the organization with `architect_forest_get_events` (its `world`), add the history entries, and send the whole organization back. `addBackstories` refuses a domain that already has one and `addRelationships` a pair that already exists; change those with `updateBackstories` and `updateRelationships` -- use them for ADD_VLAN.
4. VLANs are containers for purpose and zone only (kept in their `aiNotes`). AD objects (OUs, groups, users) are configured later via DC plugin params (CreateOUs, CreateGroups, CreateUsers CSVs) after the DC machine is created.
5. Budget, FQDN case, plugin provenance, and DC-first ordering rules live in the Gates section below.

History entries name 1-3 executives, quantify impact (dollar amounts, record counts, headcounts), and trace consequences -- "A data breach occurred" does not meet this bar.

## Phase 1: Forest Topology

> **Staging:** The forest story is staged per `refs/shared-rules.md` under `staging/forest/` as named sections: `history.json`, `backstories.json` and `relationships.json`, composed into one `architect_forest_manage` call as `world.organization.history` (merged into the organization read back from `architect_forest_get_events`), `addBackstories` and `addRelationships`. `updateBackstories` and `updateRelationships` are NOT staged — call directly with small payloads.

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

Explicit user constraints (machine caps, domain limits) are hard limits. Single-domain scenarios run the full workflow with no cross-domain relationships (send no `addRelationships`).

### History Guidelines

Target length: `max(3, numberOfPlannedDomains * 2)` history entries, spread across domains. The canvas phase may already have written some from the brief's milestones: keep them and add to them.

Entries form **interconnected causality chains** -- a 2019 acquisition leads to a 2020 integration struggle, which leads to a 2021 breach via unpatched legacy systems, which triggers a 2022 SOC buildout. Every entry names 1-3 executives and quantifies impact (dollar amounts, record counts, headcounts). No entry is dated after the story clock's `today` or before the organization's `founded`.

Kinds of entry: breach, scandal, merger, lawsuit, restructuring, expansion, layoff, acquisition, compliance failure, executive change, spinoff.

### 3-Phase Generation (CHRONICLE -> PORTRAITS -> AD MATERIALIZATION)

The forest story is generated in three sequential phases. Each phase has one job.

**Phase 1a: CHRONICLE (the dated history).** Write an interconnected corporate timeline as `world.organization.history` entries. Each entry has a `date` (`YYYY`, `YYYY-MM` or `YYYY-MM-DD`) and a `text` (up to 1,000 characters) that names the executives involved, quantifies the impact, names the domains it touched, and refers back to the earlier entry it follows from.

**Phase 1b: PORTRAITS (Domain Biographies).** Write the definitive profile of each AD domain as an `addBackstories` entry: `domainFQDN`, `uniqueCharacteristics` (full paragraph with acquisition history, legacy infrastructure, OU layout quirks, service account naming conventions, political dynamics), `primaryFunction`, `culturalNotes` (an empty string if none).

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

**Phase 1c: AD MATERIALIZATION (History + Portraits -> AD Artifacts).** Translate the history and portraits into concrete AD artifacts. For every history entry, determine what OUs, security groups, departments, and service accounts would exist as a direct consequence. Artifacts must be proportional to the event's severity. Name them in the domain's `uniqueCharacteristics` and in each relationship's `adImpact`, and carry them in the machine manifest for the DC's CreateOUs and CreateGroups params (the machines phase writes them).

**Event-driven artifacts** shape domain distinctiveness: a breach produces `OU=IncidentResponse` + `GRP-ForensicsTeam`; a merger produces legacy OUs + migration groups; a restructuring produces transitional OUs; a compliance failure produces `OU=AuditHold` + restrictive GPOs. Domains without event artifacts look identical -- the events are what make each domain feel lived-in. Pull shared OU hierarchy, security group tiering, and service account conventions from [shared-rules.md SS AD Structure Conventions](../../refs/shared-rules.md#ad-structure-conventions).

#### Example: Acquired Startup Domain Portrait

```json
{
  "domainFQDN": "research.meridian.local",
  "uniqueCharacteristics": "Originally GeneLabs Inc., a 30-person genomics startup acquired in 2019 for their CRISPR platform. The domain preserves the original flat OU layout from pre-acquisition — IT has attempted three migration projects, each abandoned after the GeneLabs veterans threatened to walk. Service accounts use the old 'gl-svc-*' naming convention instead of the corporate 'SVC-' standard because the GeneLabs CTO negotiated AD independence as part of the acquisition terms. Houses the only air-gapped lab subnet (VLAN 847) and the sole remaining NetApp filer nobody can decommission. After the 2021 breach, trust was downgraded from bidirectional to selective.",
  "primaryFunction": "Clinical trial data management, genomics research computing, regulatory submission preparation",
  "culturalNotes": "Fiercely autonomous — the GeneLabs veterans see corporate IT as bureaucratic overhead. The VP of Research reports directly to the CEO, bypassing the CTO. Their Slack channel is called #the-island. New hires from corporate are called 'mainlanders' for their first year."
}
```

### Haiku Subagent Dispatch

See [shared-rules.md SS Subagent Dispatch Pattern](../../refs/shared-rules.md#haiku-subagent-dispatch-pattern) for the canonical template shape.

**Per-skill context block:** planned domains FQDNs, the organization as `architect_forest_get_events` returns it (with any history already written), target history length, the executives (account, name, title).

**Step 3 instruction:** "Follow the 3-phase generation process (CHRONICLE -> PORTRAITS -> AD MATERIALIZATION) and output JSON with `history` (the new history entries), `addBackstories`, `addRelationships` and `adArtifacts` (per domain: the OUs and groups Phase 1c names). Return ONLY JSON."

After the subagent returns JSON, verify: all FQDNs lowercase and ending in `.local`, history entries name executives and refer back to earlier entries, no entry dated after the story clock's `today`, domain portraits include concrete specifics, each portrait has distinct personality. Then merge `history` into the organization and send `world` (`organization`), `addBackstories` and `addRelationships` to `architect_forest_manage` in one call; keep `adArtifacts` in the manifest.

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

For each VLAN, write its purpose and zone as its `aiNotes`, then call `architect_vlan_add` with `nickname` and `aiNotes` (and `subnetCidr` when the user asked for an exact network).

The purpose (min 30 chars) includes: machine types, domain join status, communication patterns, business function with industry-specific apps, and security posture reality. Great purposes read like a sysadmin's honest assessment of a real network segment.

`architect_vlan_add` takes no blueprint data: `aiNotes` is the VLAN's one free-text field. Put the purpose and zone first, then any other context worth keeping (design rationale, domain-specific quirks, backstory highlights).

For 3+ VLANs, spawn haiku subagents in parallel -- one per VLAN. Their outputs are independent. See [shared-rules.md SS Subagent Dispatch Pattern](../../refs/shared-rules.md#haiku-subagent-dispatch-pattern) for the canonical template shape.

**Per-skill context block:** VLAN name, purpose, domain FQDN (must end in `.local`), company context (name, industry, departments), security posture, machine budget for this VLAN.

**Step 3 instruction:** "Write the VLAN's aiNotes: its purpose and zone. AD structure is configured later via DC plugin params after the DC machine is created. Return ONLY the aiNotes text -- the machine manifest is produced in Phase 3 by the orchestrator, not by this subagent."

For fewer than 3 VLANs, write the aiNotes inline without subagents.

## Phase 3: Machine Manifest Planning

For each VLAN, plan which machines it needs. This is handoff to the machines phase -- the domains phase plans, machines executes.

**Handoff is conversation-only.** The manifest output lives in orchestrator conversation -- there is no backend persistence tool for it. If the user ends the session or clears context between domains and machines, the manifest is lost and domains must re-run. Warn the user before they end a session mid-cascade.

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
VLAN: {name} ({id})
Domain: {fqdn}
AD-enabled: yes/no
DC-first: yes (if AD-enabled)

Machines (DC is item #1 in AD-enabled VLANs):
1. namingGuidance: "DC01-style name"
   role: domain-controller
   purpose: "Primary DC for {domain}"
   plugins: [{pluginId, displayName, required: true}]
   complexity: complex

2. namingGuidance: "APP01-style name"
   role: application-server
   purpose: "Hosts {application} for {department}"
   plugins: [{pluginId, displayName, required: true}]
   complexity: medium

3. namingGuidance: "WS01-style name"
   role: workstation
   purpose: "{department} user workstation"
   plugins: [{pluginId, displayName, required: false}]
   complexity: simple
```

## Domain Knowledge

### Cross-Domain Relationships

For multi-domain forests, describe how domains relate. Each relationship has: `fromDomain`, `toDomain`, `type`, `description`, `adImpact` (its effect on AD, as text).

See [shared-rules.md SS Domain Relationship Vocabularies](../../refs/shared-rules.md#domain-relationship-vocabularies) for the canonical `CrossDomainRelationshipType` list and AD-direction defaults.

For single-domain forests: send no `addRelationships`.

### VLAN Purpose and Zone Rules

**Purpose** (min 30 chars, in the VLAN's `aiNotes`) includes: machine types, domain join status, communication patterns, business function with industry-specific apps, and security posture reality. Posture-driven purpose text is defined in [shared-rules.md SS Security Posture](../../refs/shared-rules.md#security-posture).

**Zone classification**: See [shared-rules.md SS VLAN Zone Classification](../../refs/shared-rules.md#vlan-zone-classification).

**DC budget** and resource allocation defaults: See [shared-rules.md SS Domain Controller Budget](../../refs/shared-rules.md#domain-controller-budget).

### Workstation Application Grounding

Name specific, real-world business applications appropriate to the company's industry when describing workstation purposes.

## Breadcrumb

Domain trust wiring (firewall rules, AD ports, VLAN connections, zone matrix) is implemented by the enrichment phase's network section after machines exist.

## CREATE Workflow (New Canvas)

Execution sequence:

1. `architect_canvas_get_overview` -- read canvas state
2. `architect_forest_get_events` -- read the company (its `world`: the organization, its history and the executives)
3. `architect_vlan_delete` x N -- clear existing VLANs if starting fresh
4. Decide `plannedDomains[]` -- FQDNs (lowercase, `.local` suffix) + purposes from company narrative
5. Spawn subagent for the forest story, giving it `plannedDomains[]` -> `architect_forest_manage` (`world.organization` with the merged `history`, `addBackstories`, `addRelationships`, in one call)
6. `architect_plugin_catalog_search` -- broad search for machine roles (max 2 calls)
7. Allocate machine budget across VLANs. Print budget table. Verify sum equals total.
8. For each VLAN: write `aiNotes` (purpose, zone) -> `architect_vlan_add`. Use subagents for 3+ VLANs.
9. `architect_vlan_list` -- read back the created VLANs (`id`, `nickname`) for the manifests
10. Plan machine manifests per VLAN. Verify DC-first, plugin provenance, budget match.
11. Verify state via `architect_canvas_get_overview` after this phase completes.

## ADD_VLAN Workflow (Existing Canvas)

Execution sequence:

1. `architect_canvas_get_overview` -- read existing state
2. `architect_forest_get_events` -- verify the world record has the organization (`world.organization`) and read the existing backstories
3. Decide new `plannedDomains[]` -- lowercase FQDNs ending in `.local`
4. Spawn subagent -> `architect_forest_manage`: `addBackstories` for the new domains only, `addRelationships` for new pairs, `updateBackstories` / `updateRelationships` for existing ones, and the organization sent whole when the history grows
5. Steps 6-11 same as CREATE workflow

## Gates

**GATE 1: FQDN Case & Suffix.** All `domainFQDN` values are lowercase AND end in `.local`. Case-sensitive matching breaks on mixed case; non-`.local` suffixes are rejected by the server-side write boundary. Confirm both before calling any tool that accepts a domain FQDN.

**GATE 2: Causality Chain.** Every history entry after the first refers back to an earlier entry in its text. Disconnected entries produce a timeline, not a story -- rewrite instead of shipping.

**GATE 3: 3-Phase Completeness.** All three phases (CHRONICLE, PORTRAITS, AD MATERIALIZATION) complete for every domain. Subagent output missing a phase goes back with explicit instructions.

**GATE 4: Budget Arithmetic.** VLAN machine allocations sum exactly to the total machine budget from `resourceBudget.quotas.maxMachines`. Print a budget table; fix any mismatch before proceeding.

**GATE 5: Plugin Provenance.** Every `pluginId` comes from an `architect_plugin_catalog_search` result in this session. If the catalog response line is not citable, the ID is hallucinated.

**GATE 6: DC-First.** The Domain Controller is item #1 in every AD-enabled VLAN manifest -- it establishes the domain that all other machines join.

## Constraints

- Maximum 2 broad `architect_plugin_catalog_search` calls for VLAN-to-category resolution. Per-plugin fallback during the machines phase runs up to 3 queries for that specific plugin (machines phase governs that).
- Subagents generate the forest story and VLAN `aiNotes` per the Subagent Dispatch Pattern; the domains phase passes results through unchanged (`history` merged into `world.organization`, `addBackstories`, `addRelationships`, `aiNotes`).
- Every VLAN gets at least 1 plugin and at least 1 machine.
- The world record's organization must exist before generating the forest story (`architect_forest_get_events`, `world.organization`).
- Subagent instructions include the path to `shared-rules.md` for size limits and naming conventions.
- Verify state via `architect_canvas_get_overview` after this phase completes.
- Flag unrealistic budgets (e.g., 3 AD-enabled VLANs with a budget of 4) before generating.
- Only assign plugins that serve a real role on the VLAN -- skip force-fits.

Final check: every domainFQDN lowercase and `.local`-suffixed, every pluginId from a catalog search this session, DC is item #1 in every AD-enabled VLAN.
