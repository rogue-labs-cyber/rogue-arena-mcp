---
name: architect-validator
description: "Validate a Rogue Arena scenario against mechanical invariants + cross-phase consistency checks after Phase 4. Invoked automatically by architect-brainstorm on Phase 4 completion, or standalone via Skill tool with a scenario directory path. Triggers: 'validate scenario', 'check exploit path', 'run validator'."
disable-model-invocation: true
user-invocable: false
---

# Architect Validator

Validate a completed scenario (`scenario_part1.yml`, `_part2.yml`, `_part3.yml`, `exploit.yml`) against mechanical invariants and cross-phase consistency checks. Gate between `architect-brainstorm` Phase 4 completion and `architect-implementor` execution.

## Invocation

- **Auto:** invoked at end of Phase 4 by `architect-brainstorm` with the scenario directory path.
- **Standalone:** invoked via `Skill("rogue-build-scenario:architect-validator")` with a scenario directory path argument. Useful for verifying hand-edited YML or re-validating after manual canvas changes.

## Required load

Before running any check, Glob for and read:
- `**/rogue-build-scenario/refs/exploit-design.md`
- `**/rogue-build-scenario/refs/escape-hatch-plugins.md`
- `**/rogue-build-scenario/refs/scenario-schema.md`

`exploit-design.md` defines invariant semantics. `escape-hatch-plugins.md` holds the 5-source query order + cap formula. `scenario-schema.md` is the AUTHORITATIVE source for field names — when inline field references in this skill disagree with the schema, the schema wins.

## Execution order

```
1. Canvas↔YML reconciliation pre-check   (blocks on divergence)
   ↓
2. Group A — 8 mechanical invariants
3. Group B — cross-phase checks
4. Group C — slim quality invariant
5. Group D — escape-hatch cap
   ↓
6. Report
   ↓
7. Loop termination check (hard escalate after 3 full runs in this session)
```

Groups 2-5 are independent — run all regardless of individual failures (no early exit). Group 1 always runs first and can bail before the rest.

## Pre-check: Canvas↔YML Reconciliation

Cross-reference every entity in the 4 YMLs against live canvas state via MCP:

- Every VLAN in `scenario_part1.yml` → `architect_vlan_list` must return it.
- Every machine in `_part1.yml` → `architect_machine_list` must return it.
- Every character in `_part2.yml` → `architect_machine_get` on the owning machine must return matching character data.
- Every plugin mapping in `_part3.yml` → `architect_assigned_plugin_get` must return the assignment.
- Every hop's `machineFrom` / `machineTo` / note `machine` field → must appear in `architect_machine_list`.

**On divergence,** bail with an explicit reconcile prompt:

```
✗ Canvas↔YML reconciliation failed.

   Canvas has VAULT-DB-01 but scenario_part1.yml doesn't mention it.
   Canvas has no machine BRIEFS-WS-99 but exploit.yml hop 4 references it.

Fix: run `architect-brainstorm` in update mode to reconcile, or hand-edit
the YML to match canvas state, then re-invoke the validator.
```

Do NOT run Groups A-D against potentially-stale data.

## Group A — Mechanical invariants

Semantics from `refs/exploit-design.md` Section 12. Check each:

| # | Check | Fix suggestion on fail |
|---|-------|------------------------|
| 1 | Every `abstractTechnique` in exploit.yml exists in catalog (`architect_exploit_technique_list`) | "Swap to catalog technique `<closest alternative>`, drop the hop, or cite Run PS/Bash as catalog fallback" |
| 2 | Credential sub-type chain intact (pw→pw, hash→hash, ticket→ticket, key→key); parse `credentials` block + per-hop `credential_discovers` / `credential_uses` refs | "Add an explicit conversion hop (password→hash extraction), or swap the consuming hop's technique to match discovered sub-type" |
| 4 | No illegal privilege jumps between a hop's `input_privilege_level` and `output_privilege_level` (e.g., `none`→`domain_admin` in one step without earned escalation). Parse the legacy `privilege` combined-string field if present on older hops. | "Insert intermediate escalation hop, or change starting privilege" |
| 5 | Every domain declared in `_part1.yml` touched by ≥1 hop, minus any domain listed in `intentionallyUntouchedDomains` | "Add a hop through `<domain>`, remove it from Phase 1, or add it to `intentionallyUntouchedDomains`" |
| 6 | Every hop's `narrativeContext` contains both (a) a resolvable field reference (regex: matches `architect_(forest_get_events\|machine_get)\..+`) and (b) at least one additional sentence of justification (non-citation text ≥ 60 chars) | "Add field reference, or add justification sentence explaining why the cited backstory motivates this hop" |
| 7 | Every hop with `implementation_type: file_seeding` references a `character_sam_account_name` present in `_part2.yml`. Every `implementorNotes` entry with `type: file_seed` must tie to a character in `_part2.yml` (either directly via the hop's `character_sam_account_name`, or via the note's `details` field referencing a named character). | "Change `character_sam_account_name` to a real Phase 2 character, or add the character to Phase 2 via `architect-brainstorm` update mode" |
| 8 | Every `trustBoundaryCrossed` value matches the real trust direction returned by `architect_forest_get_domain_trusts` | "Query actual trust direction, change `trustBoundaryCrossed` to match, or remove the trust crossing claim" |
| 9 | Every hop's plugin need is covered by `_part3.yml` mapping OR an `implementorNotes` entry specifying `plugin_assignment`. Call `architect_plugin_catalog_list_full` on the hop's target machine to verify mapped plugins can actually configure the credential placement the hop requires. | "Add plugin to Phase 3 mapping, swap to a capable plugin, or add a `plugin_assignment` note on this hop" |

Invariant #3 (diversity floor) is deleted; see Group C.

## Group B — Cross-phase checks

| Check | Source | Fix suggestion on fail |
|-------|--------|------------------------|
| Characters in `implementorNotes` exist in `_part2.yml` | parse exploit.yml notes + part2 | "Change note's character ref to a real Phase 2 character" |
| Machines in notes + hops exist on canvas | `architect_machine_list` | "Fix typo, or add machine via brainstorm update mode" |
| Plugins referenced by `suggestedPlugin` exist in catalog, except for canvas-universal escape-hatch plugins (`Run PowerShell Script`, `Run Bash Script`) which are exempt from the catalog check per `escape-hatch-plugins.md` | `architect_plugin_catalog_search` (for non-escape-hatch plugins only) | "Fix plugin name, or omit `suggestedPlugin` and let implementor pick" |
| Every note's `type` field is one of the 7 enum values | parse exploit.yml notes | "Fix type to a valid enum value" |
| Every note has `resolvesTo` OR `type: unresolvable_requires_user_input` | parse exploit.yml notes | "Add `resolvesTo: {pluginId\|techniqueId\|fileTypeEnum}` or change type to `unresolvable_requires_user_input`" |
| New-VLAN loopback consistency: any entity with `authoredIn: phase_4_greenfield` has characters in `_part2.yml` + plugins in `_part3.yml` | cross-read all 3 YMLs | "Complete the mini-loopback via brainstorm update mode" |
| Crown jewel machine (from `exploit.yml` top-level `crownJewel.machine` field) exists on canvas (`architect_canvas_get_overview` or `architect_machine_get`) AND equals the final hop's `machineTo` | cross-read exploit.yml crownJewel block + canvas + hop list | "Re-order hops so the final hop targets the crown jewel machine, or correct `crownJewel.machine` to match the intended endgame machine" |
| Every note's `machine` field references a machine used by at least one hop | parse exploit.yml | "Drop the orphan note, or add a hop that touches the machine" |
| Every bypass surfaced during per-hop audit has a logged `bypassDecisions` entry | parse exploit.yml | "Complete bypass audit via brainstorm update mode; every bypass needs a decision" |
| Bypasses tagged `bonus_shortcut` or `red_herring` are NOT simultaneously the subject of an invariant failure (i.e., the author explicitly said "leave it", so don't flag as drift) | cross-check bypassDecisions against other invariant results | Suppresses false positives; no user action required |

## Group C — Slim quality invariant

| Check | Rule | Fix suggestion on fail |
|-------|------|------------------------|
| Credential location diversity | Distinct credential-location patterns (6 categories defined in `exploit-design.md` Section 4) across the path ≥ `max(3, ceil(hops/3))` | "Swap 1-2 hops to use different credential-location categories (file seed → memory dump → AD attribute, etc.)" |

Honestly labeled: this is a quality floor, not a truth check. Autopilot-mode users (who default-accept every recommendation) would otherwise ship single-pattern paths.

## Group D — Escape-hatch cap

| Check | Rule | Fix suggestion on fail |
|-------|------|------------------------|
| Escape-hatch density | Hops citing `Run PowerShell Script` OR `Run Bash Script` ≤ `min(2, ceil(hops * 0.20))` per path | "Refactor 1-2 escape-hatch hops to use catalog techniques, or add `escapeHatchOverride: \"<reason>\"` per hop that needs to exceed cap" |

Override detection: if an escape-hatch hop has `escapeHatchOverride` set, count it against the cap anyway BUT pass the check (overrides are per-hop allowances, not path-level exemptions). If the count still exceeds cap even after override allowances, fail.

## Report output

### On pass

```
✓ Canvas↔YML reconciliation: matched
✓ Group A (8 mechanical invariants): all pass
✓ Group B (cross-phase checks): all pass
✓ Group C (credential location diversity): 4 distinct patterns across 8 hops — floor is 3, pass
✓ Group D (escape-hatch cap): 1 of 8 hops cite Run PS/Bash (cap: min(2, 2)=2), pass

Ready to hand off to architect-implementor?
```

One-line summary per group, not a wall of green checkmarks. User confirms → invoke `Skill("rogue-build-scenario:architect-implementor")` with the scenario directory path.

### On fail

Group failures inline with specific remediation. Example:

```
✗ Invariant 5 — Domain not touched
  `warehouse.dundermifflin.local` declared in Phase 1 but no hop uses it.
  Fix: add a hop through warehouse, remove it from Phase 1, or add it to
  `intentionallyUntouchedDomains` in exploit.yml.

✗ Invariant 6 — Narrative citation incomplete (hop 3)
  narrativeContext cites a real field but lacks the "why this motivates" sentence.
  Current text: "cites architect_machine_get.backstory.securityHabits"
  Fix: add a sentence explaining why the cited backstory motivates the hop.

✗ Group D — Escape-hatch cap exceeded
  3 of 8 hops (38%) cite Run PowerShell Script. Cap: min(2, ceil(8*0.20))=2.
  Fix: refactor at least 1 hop to a catalog technique, or add
  `escapeHatchOverride: "<reason>"` to 1 hop.
```

User options:
- **Fix in place** — user provides edits; Claude updates the YMLs and re-runs validator (loop counter increments).
- **Loop back** — Claude invokes `architect-brainstorm` in update mode for the relevant phase.
- **Override** — user adds explicit override fields; validator accepts with the justification logged.

## Loop termination

Increment a loop counter per full validator run in this session. On reaching 3 runs:

```
⚠ Hard escalate: validator has now run 3 times this session.

Initial failures: [list]
Fixes attempted loop 1: [list]
Fixes attempted loop 2: [list]
Remaining failures: [list]

I will not auto-revise further. You can:
  1. Hand-edit the YMLs directly.
  2. Accept partial failure with explicit overrides (add escapeHatchOverride,
     intentionallyUntouchedDomains, or other justification fields).
  3. Restart brainstorm from the relevant phase.
```

No more auto-revise after 3 loops.

## Standalone mode contract

When invoked standalone (not auto-triggered from Phase 4):

- Accept a scenario directory path as the skill argument.
- Read the 4 YML files from that directory; extract the canvas ID stamped in the YMLs.
- Call `rogue_set_canvas` with that canvas ID — this selects the active canvas so subsequent MCP calls resolve against the right context. (`rogue_set_canvas` only sets the active canvas; it does NOT run the reconciliation.)
- Run the Pre-check: Canvas↔YML Reconciliation (calling `architect_vlan_list`, `architect_machine_list`, `architect_machine_get`, `architect_assigned_plugin_get` as usual).
- Run Groups A-D.
- Report as above.

No conversation context is required. This is the "run validator on a scenario someone else authored" path.

## Key principles

- Trust live canvas over stale YML. Reconcile first.
- Report every failure with a specific remediation suggestion.
- No auto-revision cycles. User drives fixes.
- Hard-escalate after 3 loops.
- All checks are mechanical — no subjective judgment.
- Standalone-safe (no brainstorm context required).
