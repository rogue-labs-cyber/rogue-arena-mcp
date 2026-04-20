# Enrichment: Relationships Phase — Reference Doc

> **For:** architect-implementor Phase B (enrichment step — relationships)
> **Source:** Migrated from skills/enrichment-relationships/SKILL.md
> **Do not add:** persona blocks, trigger phrases, user interaction framing

Relationships drive the social fabric that exploit paths exploit — mentorship trust, information asymmetry, cross-department access patterns, and shared file collaboration.

## Prerequisite: Shared Events Already Exist

Shared workplace events per VLAN are owned by the backstory phase — it calls `architect_machine_manage_backstory(operation: 'generate_shared_events')` and persists the result. This phase reads those events but does not generate them.

If shared events do not exist when this phase runs (backstory was skipped), the implementor must halt and report: "Shared workplace events are missing. Run the backstory enrichment phase first, or approve falling back to role-only relationships without event references." The implementor must never call `generate_shared_events` from this phase — it is a single-owner write belonging to backstory.

## Relationship Generation

Call `architect_machine_manage_backstory(operation: 'generate')` once per assigned user with a rich prompt containing role, workStyle, hobbies, referenced shared events from backstory, and asymmetry context.

## WorkStyle Caps

Each number is an upper cap on relationship count per user, not a range. There is no floor — fewer relationships are fine when the narrative does not support more. The implementor uses the cap only when role or seniority justifies it; padding to the cap produces hollow relationships.

| workStyle | Cap (relationships per user) |
|-----------|:---:|
| collaborative | 5 |
| methodical | 3 |
| independent | 2 |

## Prompt Requirements

Every `operation: 'generate'` call includes a prompt of 100+ characters covering:

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

1. Read profiles — `architect_canvas_get_context` for company, departments, characters.
2. Read existing shared events — `architect_machine_manage_backstory` (read operation) per VLAN. If events are missing, halt and direct to backstory first.
3. Read crown jewels (if designated) — understand guardian context for trust chains.
4. Per-user relationships — `architect_machine_manage_backstory(operation: 'generate')` per assigned user with 100+ character prompts referencing shared events from step 2.
5. Verify — count relationships per user against workStyle caps. Confirm at least one cross-VLAN relationship exists when multiple VLANs have users. Confirm cross-trust pairings when AD trusts exist.

## Constraints

- The implementor runs completeness verification (`architect_canvas_get_completeness`) after this phase completes.
- For 10+ users, the implementor must confirm scope before generating — see [shared-rules.md -- Large Generation Confirmation Gate](../shared-rules.md#large-generation-confirmation-gate).
