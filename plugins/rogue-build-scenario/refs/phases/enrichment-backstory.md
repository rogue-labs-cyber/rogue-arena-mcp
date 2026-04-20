# Enrichment: Backstory Phase — Reference Doc

> **For:** architect-implementor Phase B (enrichment step — backstory)
> **Source:** Migrated from skills/enrichment-backstory/SKILL.md
> **Do not add:** persona blocks, trigger phrases, user interaction framing

Backstory is the narrative foundation the rest of enrichment builds on. It establishes shared workplace events across VLANs, per-user workplace histories, and machine notes that capture scenario intent. Runs after VLANs, machines, and user assignments exist.

## Shared VLAN Events

`architect_vlan_manage_backstory` with `operation: "set_events"` per VLAN establishes company-wide and VLAN-specific events (breaches, mergers, reorgs, product launches, audits, incidents, personnel changes). These anchor downstream relationships and file generation.

## Individual Workplace Events

Two-phase generation per VLAN:

1. **Shared events** — `architect_machine_manage_backstory` with `operation: 'generate_shared_events'` per VLAN to establish cross-machine interaction context.
2. **Per-user events** — `architect_machine_manage_backstory` with `operation: 'generate'` per assigned user, threading user-specific context (role, workStyle, hobbies, department, recent workplace events) into the `prompt` field at 100+ characters.

## Event Categories

See [shared-rules.md -- Backstory Event Categories](../shared-rules.md#backstory-event-categories) for the 7 categories and sentiment distribution.

## Machine Notes

`architect_machine_notes_set` captures scenario intent and flow annotations — WHY a machine is configured a certain way. Example: "This DC was the original domain controller before the merger; its GPOs still reflect the pre-acquisition policy set."

## Checklist

1. Read company context — `architect_canvas_get_context` for company profile, departments, characters.
2. Read forest topology — `architect_forest_get_events` for domain relationships and existing events.
3. Shared VLAN events — `architect_vlan_manage_backstory(operation: "set_events")` per VLAN.
4. Shared machine events — `architect_machine_manage_backstory(operation: 'generate_shared_events')` per VLAN.
5. Individual events — `architect_machine_manage_backstory(operation: 'generate')` per assigned user with 100+ character prompts.
6. Machine notes — `architect_machine_notes_set` for key machines with scenario intent.
7. Verify shared events exist for every VLAN before proceeding to other enrichment sections.

## Constraints

- The implementor runs completeness verification (`architect_canvas_get_completeness`) after this phase completes.
- For 5+ machines or 10+ users, the implementor must confirm scope before generating — see [shared-rules.md -- Large Generation Confirmation Gate](../shared-rules.md#large-generation-confirmation-gate).
