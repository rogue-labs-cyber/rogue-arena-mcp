# Enrichment: Backstory Phase — Reference Doc

> **Staging:** VLAN and machine backstories are staged per `refs/shared-rules.md`: a VLAN's under `staging/vlan-{vlan}/backstory/` (named section `events.json`), a user's under `staging/machine-{machine}/backstory/` (named sections `workplace-events.json` + `workplace-relationships.json`). A whole per-user backstory (`bpData`) is staged; a single added `event` or `relationship` is NOT staged. Each tool takes a `bpData` of at most 512,000 bytes as JSON.

> **For:** flow-implement Phase B (enrichment step — backstory)
> **Do not add:** persona blocks, trigger phrases, user interaction framing

Backstory is the narrative foundation the rest of enrichment builds on. It establishes shared workplace events across VLANs, per-user workplace histories, and machine notes that capture scenario intent. Runs after VLANs, machines, and user assignments exist.

## Shared VLAN Events

`architect_vlan_manage_backstory` with `bpData.sharedEventPool` per VLAN establishes company-wide and VLAN-specific events (breaches, mergers, reorgs, product launches, audits, incidents, personnel changes). These anchor downstream relationships and file generation.

## Individual Workplace Events

Two phases per VLAN:

1. **Shared events** — the VLAN's shared events above are the cross-machine interaction context. Set them before any user's events.
2. **Per-user events** — `architect_machine_manage_backstory` per assigned user with `machine`, `userSamAccountName` and `bpData` (`workplaceEvents`, `workplaceRelationships`), written from that user's own context (role, workStyle, hobbies, department, recent workplace events). `bpData` replaces the user's whole backstory.

## Event Categories

See [shared-rules.md -- Backstory Event Categories](../shared-rules.md#backstory-event-categories) for the 7 categories and sentiment distribution.

## Machine Notes

`architect_machine_update` with `aiNotes: "<annotation text>"` captures scenario intent and flow annotations — WHY a machine is configured a certain way. Example: `architect_machine_update({ machine, aiNotes: "This DC was the original domain controller before the merger; its GPOs still reflect the pre-acquisition policy set." })`

## Checklist

1. Read the company — `architect_forest_get_events` (its `world`): the organization, its departments and dated history, and the roster.
2. Read forest topology — the same answer's `domainBackstories` and `crossDomainRelationships`.
3. Shared VLAN events — `architect_vlan_manage_backstory({ vlan, bpData: { sharedEventPool } })` per VLAN.
4. Individual events — `architect_machine_manage_backstory({ machine, userSamAccountName, bpData: { workplaceEvents, workplaceRelationships } })` per assigned user, written from the user's own context and the VLAN's shared events.
5. Machine notes — `architect_machine_update` with `aiNotes: "<annotation>"` for key machines with scenario intent.
6. Verify shared events exist for every VLAN before proceeding to other enrichment sections.

## Constraints

- Verify state via `architect_canvas_get_overview` after this phase completes.
- For 5+ machines or 10+ users, confirm scope before generating — see [shared-rules.md -- Large Generation Confirmation Gate](../shared-rules.md#large-generation-confirmation-gate).
