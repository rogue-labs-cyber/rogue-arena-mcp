# Enrichment: Crown Jewels Phase — Reference Doc

> **For:** architect-implementor Phase B (enrichment step — crown jewels)
> **Source:** Migrated from skills/enrichment-crown-jewels/SKILL.md
> **Do not add:** persona blocks, trigger phrases, user interaction framing

Crown jewels are the high-value targets on VLANs — the ultimate objectives in red team scenarios. They are named targets with a type and optional description. Who accesses the crown jewel and how attackers reach it lives on the exploit path itself (exploit_users + credentials), not on the crown jewel.

## Machine Value Assessment

The implementor must assess every machine across every VLAN (not just candidates). Each machine gets a `valueScore` (0-100), `valueReasons` (1-3 reasons), and `inferredType`.

| Machine Type | Score Range |
|---|---|
| Domain Controllers | 90-100 |
| Database servers (sensitive data) | 70-90 |
| File servers (business documents) | 60-80 |
| Executive workstations | 50-70 |
| General servers | 30-50 |
| Workstations | 10-30 |

`inferredType` values: `domain_controller`, `database`, `file_server`, `mail_server`, `web_server`, `backup_server`, `jump_host`, `executive_workstation`, `general_workstation`, `server`, `workstation`, `unknown`.

## Crown Jewel Types (one per VLAN)

These are the enum values accepted by `architect_exploit_crown_jewel_set`:

| Type (enum value) | Typical Contents | Business Value Focus |
|---|---|---|
| `critical_server` (key infrastructure server) | Domain controllers, backup systems, pipelines | Operational continuity, recovery |
| `application_stack` (application/service stack) | Web apps, mail servers, business-critical services | Service availability, credential compromise |
| `data_repository` (database/data store) | Customer PII, financial records, medical records, source code | Revenue dependency, breach fines, competitive advantage |
| `control_system` (SCADA/ICS/operational) | SCADA/ICS, manufacturing processes, monitoring systems | Safety, physical damage, production halt |
| `isolated_vlan` (high-security isolated zone) | Key management, certificate authority, audit logs, compliance data | Credential compromise, regulatory fines |

The optional `description` field can capture business context (dollar amounts, record counts, regulatory stakes) if it helps the scenario feel grounded, but it is not required.

## Placement Rules

Crown jewels belong on internal or isolated zone VLANs only — not DMZ or external. Not every VLAN needs a crown jewel. One crown jewel type per VLAN maximum.

**Difficulty tagging:** The implementor must tag each crown jewel with a target difficulty (`easy`, `medium`, or `hard`). The exploits phase uses this tag to shape the attack path chain; crown jewel placement only needs to pick a zone-appropriate machine, not plan the hops. Attack path topology (hop counts, trust boundary crossings, lateral movement) is the exploits phase's responsibility.

**Draft nodeIds only** (e.g., `vlan-corp`); canvas UUIDs will fail.

## Checklist

1. Read topology + VLANs — `architect_forest_get_events`, `architect_vlan_list`, `architect_vlan_get` per VLAN.
2. Assess machine values across every VLAN — every machine gets valueScore, valueReasons, and inferredType. Workstations score 10-30 by default but still require an explicit entry.
3. Filter candidates — internal or isolated zone VLANs with servers hosting business-critical data.
4. Design crown jewels — pick a `crownJewelName`, `crownJewelType` (from the enum), and optionally a `description` with business context.
5. Apply — `architect_exploit_crown_jewel_set` per crown jewel using draft nodeIds (e.g., `vlan-corp`). Example call shape: `{ crownJewelName: "Patient Records DB", crownJewelType: "data_repository", description: "3.2M patient records — HIPAA breach fines up to $1.5M" }`.
6. Verify — confirm each `architect_exploit_crown_jewel_set` call returned success.

If no VLAN qualifies, the implementor must output `infrastructure_needed` JSON specifying what needs to be built. A forced crown jewel on an unsuitable machine does worse than none at all.

## Constraints

- Internal or isolated zones only — never DMZ or external.
- One crown jewel type per VLAN maximum.
- Draft nodeIds only (e.g., `vlan-corp`); canvas UUIDs will fail.
- Optional `description` can add business context but is not required.
- The implementor runs completeness verification (`architect_canvas_get_completeness`) after this phase completes.
