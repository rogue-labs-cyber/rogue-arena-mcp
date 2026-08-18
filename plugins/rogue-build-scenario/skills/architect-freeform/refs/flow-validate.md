# Flow — Validate YML

> Loaded by `architect-brainstorm` after the files-enrichment gate. Do not invoke as a skill. Never call `Skill()`.

Validate `scenario_part1.yml`, `_part2.yml`, `_part3.yml` against live canvas state and cross-phase consistency. Read-only — reports findings, changes nothing.

Before any check, load `refs/scenario-schema.md`. That file is the AUTHORITATIVE source for field names.

## Execution order

```
1. Canvas↔YML reconciliation pre-check   (blocks on divergence)
   ↓
2. Cross-phase consistency
   ↓
3. Report
   ↓
4. Loop termination check (hard escalate after 3 full runs in this session)
```

## Pre-check: Canvas↔YML Reconciliation

Call `architect_canvas_get_overview` + `architect_vlan_list` + `architect_machine_list`.

**New canvas (no VLANs/machines yet):** skip entity-existence checks. The implement step will create them from the YMLs. Continue to cross-phase consistency.

**Canvas already has entities** (update mode or a partial build):

- Every VLAN in `scenario_part1.yml` → `architect_vlan_list` must return it.
- Every machine in `_part1.yml` → `architect_machine_list` must return it.
- Every character in `_part2.yml` → `architect_machine_get` on the owning machine must return matching character data.
- Every plugin mapping in `_part3.yml` → `architect_assigned_plugin_get` must return the assignment.

**On divergence,** bail:

```
✗ Canvas↔YML reconciliation failed.

   Canvas has VAULT-DB-01 but scenario_part1.yml doesn't mention it.
   Canvas has no machine BRIEFS-WS-99 but scenario_part3.yml maps a plugin to it.

Fix: stay in this session, edit the YML to match canvas (or the reverse), then re-run this checklist.
```

Do NOT run the remaining checks against potentially-stale data.

## Cross-phase consistency

| Check | Source | Fix suggestion on fail |
|-------|--------|------------------------|
| Every workstation in `_part1.yml` has a character in `_part2.yml` | parse part1 + part2 | "Add a character for `<hostname>`, or remove the workstation from Phase 1" |
| Every character's `machine` exists in `_part1.yml` | parse part1 + part2 | "Fix the hostname typo, or add the machine in Phase 1" |
| Every plugin mapping in `_part3.yml` targets a machine/role declared in `_part1.yml` | parse part1 + part3 | "Fix the mapping target, or add the machine/role in Phase 1" |
| Plugins referenced in `_part3.yml` exist in catalog | `architect_plugin_catalog_search` | "Fix plugin name, or swap to a catalog plugin" |
| Domain FQDNs in parts 1–3 are consistent and end in `.local` (or `null` for standalone) | parse all 3 YMLs | "Align the FQDN across files; lab domains use `.local`" |

## Report

### On pass

```
✓ Canvas↔YML reconciliation: matched
✓ Cross-phase consistency: all pass
```

Return to the orchestrator. It asks the user to confirm the canvas build, then loads `refs/flow-implement.md`.

### On fail

Report each failure with a specific remediation. User options:

- **Fix in place** — user provides edits; update the YMLs and re-run this checklist (loop counter increments).
- **Loop back** — re-read the relevant earlier flow file (`flow-shape.md`, `flow-cast.md`, or `flow-build.md`) and revise that phase.

## Loop termination

Increment a loop counter per full validate run in this session. On reaching 3 runs:

```
⚠ Hard escalate: validate has now run 3 times this session.

Initial failures: [list]
Fixes attempted loop 1: [list]
Fixes attempted loop 2: [list]
Remaining failures: [list]

I will not auto-revise further. You can:
  1. Hand-edit the YMLs directly.
  2. Restart from the relevant phase.
```

No more auto-revise after 3 loops.

## Principles

- Trust live canvas over stale YML. Reconcile first.
- Report every failure with a specific remediation.
- No `Skill()` calls. Stay in this session.
- All checks are mechanical — no subjective judgment.
