# Enrichment: Relationships Phase — Reference Doc

> **For:** flow-implement Phase B (enrichment step — relationships)
> **Do not add:** persona blocks, trigger phrases, user interaction framing

Relationships drive the social fabric of the lab — mentorship trust, information asymmetry, cross-department access patterns, and shared file collaboration.

## Prerequisite: Shared Events Already Exist

Shared workplace events per VLAN are owned by the backstory phase — it sets them with `architect_vlan_manage_backstory` (`bpData.sharedEventPool`). This phase reads those events but does not write them. No tool reads a VLAN's shared event pool back: read it from the backstory phase's staged `events.json` (`staging/vlan-{vlan}/backstory/`, with its `.pushed` sentinel) or from this session's backstory step.

If shared events do not exist when this phase runs (backstory was skipped), halt and report: "Shared workplace events are missing. Run the backstory enrichment phase first, or approve falling back to role-only relationships without event references." Never call `architect_vlan_manage_backstory` from this phase — it is a single-owner write belonging to backstory.

## Relationship Generation

Add each relationship with `architect_machine_manage_backstory({ machine, userSamAccountName, relationship })`, one relationship per call, for each assigned user. Write it from the user's role, workStyle, hobbies, the shared events from backstory, and asymmetry context. Adding keeps the events the backstory phase wrote; sending `bpData` would replace them.

## WorkStyle Caps

Each number is an upper cap on relationship count per user, not a range. There is no floor — fewer relationships are fine when the narrative does not support more. Use the cap only when role or seniority justifies it; padding to the cap produces hollow relationships.

| workStyle | Cap (relationships per user) |
|-----------|:---:|
| collaborative | 5 |
| meticulous | 3 |
| independent | 2 |

## What Each Relationship Draws On

Write every relationship from:

- Role and department with seniority level
- Personality and workStyle from user profile
- Hobbies and interests (shared hobbies create social bonds)
- Recent workplace events the user was involved in
- Information asymmetry — what sensitive data this user's role exposes
- Asymmetric knowledge patterns (see table below)

## Information Asymmetry Patterns

| Department | Holds | Asymmetry With |
|-----------|-------|---------------|
| HR | Performance reviews, PIPs, salary data | Everyone |
| IT / Security | Access logs, credentials, security incidents | Clinical, Finance, Operations |
| Finance | Budget forecasts, M&A plans, vendor contracts | Engineering, Clinical, HR |
| Executives | Strategic plans, board decisions | All departments |
| Engineering / Dev | Source code, deployment keys, CI/CD secrets | Business units |

## Scope Rules

- **Assigned users only** — skip users with no machine presence.
- **Cross-machine priority** — favor relationships between users on different machines to create lateral movement opportunities.
- **Cross-trust pairings** — if AD trusts exist between domains, create cross-trust relationships (billing contacts, IT support contracts, audit relationships).

## Checklist

1. Read profiles — `architect_forest_get_events` (its `world`) for the organization, its departments and the roster.
2. Read existing shared events — the backstory phase's staged `events.json` per VLAN (no tool reads the pool back). If events are missing, halt and direct to backstory first.
3. Per-user relationships — `architect_machine_manage_backstory` with one `relationship` per call, per assigned user, each referencing shared events from step 2.
4. Verify — count relationships per user against workStyle caps. Confirm at least one cross-VLAN relationship exists when multiple VLANs have users. Confirm cross-trust pairings when AD trusts exist.

## Constraints

- Verify state via `architect_canvas_get_overview` after this phase completes.
- For 10+ users, confirm scope before generating — see [shared-rules.md -- Large Generation Confirmation Gate](../shared-rules.md#large-generation-confirmation-gate).
