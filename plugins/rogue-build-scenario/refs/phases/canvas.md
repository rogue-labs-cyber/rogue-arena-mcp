# Canvas Phase — Reference Doc

> **For:** architect-implementor Phase B (canvas context step)
> **Source:** Migrated from skills/canvas/SKILL.md
> **Do not add:** persona blocks, trigger phrases, user interaction framing

---

## Overview

The canvas phase is the first phase of the build cascade. No upstream dependencies. It produces company profile, character pool, leadership team, and technical infrastructure naming decisions consumed by all downstream phases (domains, machines, enrichment, exploits).

The canvas phase brainstorms company context through a focused discovery session, then generates the foundational canvas blueprint — company profile, departments, fictional characters (50-150), leadership team, and technical infrastructure. Everything downstream (domains, VLANs, machines, files, exploit paths) builds on what this phase produces.

## Core Rules

Do not use TodoWrite during build execution. The phase's gate sequence is the progress tracker.

These are the load-bearing moves for this phase. Every one must happen on every canvas session.

1. **Enrich vague prompts.** "tech company" is not enough detail. Infer regulatory landscape, propose a narrative hook, and confirm with the user before proceeding.
2. **Run the calibration protocol.** Every scenario is unique. Reusing a mental template means the implementor is not listening to THIS user.
3. **Verify technologies via `architect_plugin_catalog_search`.** Assumptions about plugin availability cause cascading failures in every downstream phase.
4. **Read reference files before validating Haiku output.** Refs contain size limits, hostname rules, and domain constraints that change.
5. **Inspect Haiku output before storing.** Haiku can hallucinate naming patterns, miss content policy, or invert prominence distributions. The implementor is the gate.
6. **Produce the brief by round 3.** The hard limit exists because users disengage. Do not extend past 3 rounds of questions.

---

## Phase 1: Brainstorm

### Self-Calibration Protocol

Before asking questions, count how many of these 6 dimensions the user provided: scale/machine count, topology/VLANs, industry/theme, attack types, specific technologies, narrative hooks/characters.

| Level | Dimensions | Action |
|-------|-----------|--------|
| **HIGH** | 4+ | Generate brief immediately. Fill gaps with creative defaults. |
| **MEDIUM** | 2-3 | Ask 1-2 targeted questions about missing dimensions only. |
| **LOW** | 0-1 | Ask 2-3 questions. A zero-dimension prompt cannot produce a quality brief. |

**Hard limit: 3 rounds maximum.** After 3 rounds, produce the brief with reasonable creative decisions for anything unspecified. Treat non-answers ("you decide", "whatever") as implicit delegation.

State the calibration result in the first response:

> **Calibration: [HIGH/MEDIUM/LOW]** — [N]/6 dimensions provided: [list which ones].

### Question Guidelines

Ask ONE focused question per turn with exactly 3 concrete options + an invitation to suggest something different. Each option includes a brief description of what it implies for the scenario.

**Example — Industry:**
"What kind of organization should this simulate?
1. **Regional hospital** — HIPAA data, medical devices, patient records
2. **Investment bank** — PCI compliance, trading floor, wire transfers
3. **Manufacturing plant** — OT/IT convergence, SCADA systems, legacy Windows
Or describe something else entirely."

Contextualize questions to what the user already stated. Leave implementation details (hostnames, IPs, OU structures) to Phase 2.

### Design Brief Format

When enough information is gathered, produce a design brief with:

**Narrative section** (2,000-8,000 chars including JSON): Company identity, scale, attack intent, topology hints, constraints, and theme mapping. Write as a narrative that guides infrastructure decisions but leaves room for downstream expertise.

**Structured JSON summary:**
```json
{
  "companyName": "string",
  "industry": "string",
  "totalMachines": "number (VM count — hosts that will be created on the canvas)",
  "maxUsers": "number (directory user count — seats in the company, typically 2-5x totalMachines depending on workstation density)",
  "vlanCount": "number",
  "attackSurface": "string (1-2 sentences)",
  "constraints": ["user constraints verbatim"],
  "keyDecisions": ["decisions made during brainstorm"]
}
```

`totalMachines` and `maxUsers` are independent — machines are hosts, users are directory seats. A 10-machine scenario can serve 50 users (shared workstations or service accounts) or 5 users (dev lab). Both fields must fit the size tier from shared-rules.md.

**Completeness check before presenting:** Verify every field is present and substantive — `companyName` is a real-sounding name (not "TestCorp"), `industry` has operational detail, `totalMachines` and `maxUsers` both fit the size tier from shared-rules.md, `vlanCount` is at least 2, `attackSurface` names specific techniques, narrative covers identity + scale + topology + theme mapping, and `constraints` captures every user-stated requirement verbatim.

Checkpoint — present to user: the design brief summary (2-3 sentences) and ask for confirmation before proceeding to Phase 2.

### Plugin Reality Check

If the user names specific technologies or attack techniques, the implementor must verify via `architect_plugin_catalog_search` before including them in the brief. If no matching plugin exists, inform the user honestly, suggest available alternatives, and let them decide. Note substitutions in the brief.

This check is lightweight — one search call. Skip it for generic requests ("some workstations", "a file server"). Do it for specific software, vulnerability techniques, or niche technologies.

### Enrichment Duty

Enrich thin prompts into distinctive company identities before dispatching Haiku. Infer from the industry, propose at least one narrative hook (acquisition, breach, compliance audit, rapid growth), state the enriched version, and let the user confirm.

**Thin:** "A medium tech company" — generic, no regulatory pressure, no narrative hooks.

**Enriched:** "A mid-size cloud infrastructure provider (~75 users) undergoing SOC 2 Type II certification. They acquired a smaller DevOps startup 6 months ago — integration is messy, two AD forests not yet consolidated. Security posture: neglected."

### Conversational Style

- Run a design session, not a form. Match the user's expertise level: technical users get depth, vague users get accessible language.
- When constraints conflict with platform limits (shared-rules.md), state the constraint, explain why, and propose an alternative rather than silently complying.
- Work in concepts ("a vulnerable Kerberos setup", "a file server with sensitive HR documents") and let downstream phases handle implementations.
- Fill gaps creatively and note inferred decisions in the brief.
- Respect existing canvas state — ask whether to extend or start fresh before overwriting.
- Evaluate before agreeing; skip "Great idea!" openers that arrive before the platform constraint check.

---

## Phase 2: Canvas Generation

Once the user confirms the brief, transition directly into generation:

"Scenario brief is ready. Generating the canvas blueprint — company profile, character pool, and infrastructure naming."

### Generation Gates

**GATE 1: Content policy is absolute.** The authoritative content policy lives in shared-rules.md. Violations are rejected regardless of user request, franchise fidelity, or narrative justification.

**GATE 2: Context before generation.** Dispatch Haiku only after company context is gathered (industry, size, and at least one narrative dimension).

**GATE 3: Reference file paths in every dispatch.** Every Haiku dispatch includes ref file paths so Haiku can read size limits, hostname rules, and content policy before generating.

**GATE 4: Inspect before storing.** After Haiku returns JSON, spot-check before calling `architect_canvas_set_context`: character count >= 50, leadership includes CEO + security leader, no content policy violations, prominence distribution not inverted. Re-dispatch with corrections if any check fails.

The implementor runs completeness verification (`architect_canvas_get_completeness`) after this phase completes.

### Haiku Subagent Dispatch

The implementor (orchestrator) handles workflow: reading state, deciding what to build, calling MCP tools. subagents handle bpData generation: the implementor gives them ref file paths + context, they return JSON. The implementor assembles their outputs into the final bpData payload and calls `architect_canvas_set_context` exactly ONCE with the complete payload.

See [shared-rules.md -- Haiku Subagent Dispatch Pattern](../shared-rules.md#haiku-subagent-dispatch-pattern) for the canonical template shape.

**Split generation into 2 subagent calls to avoid the Read tool's 10K token limit:**

1. **Subagent A — context sections (~15KB).** Dispatch a Haiku subagent to generate `companyProfile`, `leadership`, and `technicalInfra`. This fits within the Read tool's token limit and returns inline. Per-phase context block: include `<canvas-context>[architect_canvas_get_overview result]</canvas-context>` and `<user-request>[industry, size, themes, character style]</user-request>`.

2. **Subagent B — characters (~50KB).** Dispatch a second Haiku subagent to generate `fictionalCharacters` ONLY. Instruct it to write the JSON array to `/tmp/canvas-characters.json` using the Write tool and return only the file path — do NOT have it return 50KB inline. **Critical:** This subagent MUST receive the companyProfile output from Subagent A (specifically `departments`, `characterStyle`, `allowedFranchises`, `industry`, and `companyName`) so that character `suggestedBusinessUnit` values align with actual departments and `franchise` values match `characterStyle`.

**Inline in the characters subagent dispatch:** "Character prominence distribution MUST follow: 9-10 (exec/C-suite) ~5%, 7-8 (directors/managers) ~10%, 5-6 (senior ICs) ~20%, 3-4 (regular employees) ~30%, 1-2 (entry-level/support) ~35%. Generate exact counts matching your pool size. Inverted distributions will be rejected and re-dispatched."

**Assembly and storage:** After both subagents complete, spawn a single assembly subagent that: (1) receives the 3 context sections from Subagent A as prompt context, (2) reads `/tmp/canvas-characters.json`, (3) assembles the full bpData object with all sections, (4) calls `architect_canvas_set_context` ONCE with the complete payload. Do NOT call set_context twice — it uses REPLACE semantics and the second call would destroy the first call's data.

### Validation Checklist

Execution sequence — run before reporting success:

1. **Character count** — 50+ characters in bpData (below 50 fails).
2. **Prominence distribution** — executives ~5%, directors/managers ~10%, senior staff ~20%, regular ~30%, entry-level ~35%.
3. **Leadership completeness** — CEO + security leader present; industry-specific roles included (CTO for tech, CFO for finance); team size matches size tier.
4. **Headcount math** — maxUsers aligns with size tier from shared-rules.md; department headcounts sum to maxUsers (+/-5%).
5. **Naming conventions** — hostname patterns match company size tier; OU structure matches maturity; security group prefixes correct (GG-/DL-/UG-).
6. **Content policy** — zero violations; one violation rejects and re-dispatches.
7. **Thematic fidelity** — company profile reflects requested industry/franchise/themes, not a generic placeholder.

### Modify Flow

When modifying an existing canvas:
1. Read current state via `architect_canvas_get_overview`.
2. Identify what needs changing.
3. Dispatch Haiku with current state + modification request (preserve unchanged sections).
4. Store via `architect_canvas_set_context` (replaces entire BP).
5. Trust the set_context success response. Post-routing verification (overview + completeness) is handled by the root orchestrator.

If the modification is downstream (VLAN or machine changes), skip this phase — the appropriate downstream phase handles it.

### Error Handling

If `architect_canvas_set_context` returns validation errors: read the Zod error messages, fix the specific fields, and re-dispatch or fix directly if the error is simple. If `architect_canvas_get_completeness` shows missing sections after a successful call, re-run with full bpData to overwrite.

---

## Canvas-Specific Domain Knowledge

Shared reference data (company size tiers, security posture enum, industry regulatory frameworks, content policy, hostname rules, character prominence, trait archetypes) lives in [shared-rules.md](../shared-rules.md). The behavioral rules below are canvas-specific.

### Company Profile Inference

- **Industry from the user's prompt, not universe stereotypes.** Red Rising can be mining, military, biotech, or government. Star Wars can be military, logistics, or education. Pick what makes the universe distinct rather than the obvious default or a generic industry that works anywhere.
- **Thematic fidelity.** "Star Wars Empire" becomes an authoritarian logistics megacorp with military departments — not "Meridian Logistics Corporation." A company name containing "Studios" or "Entertainment" for a non-media prompt signals the theme got sanitized.
- **Departments:** Always required — IT/Technology, Finance/Accounting, HR/Personnel. Add as size permits — Operations, Sales/Marketing, Legal, Facilities. Headcounts sum to maxUsers (+/-5%). Fictional scenarios can theme department names, but functions map to standard enterprise roles.
- **Leadership team:** CEO plus at least one security leader (CISO/CIO/VP IT). Industry-specific additions — CTO (tech), CFO (finance), CMO (healthcare). Background split 40-60% internal promotions / 40-60% external hires. At least one leader with security-relevant vulnerabilities.
- **Corporate structure to AD forest:** Subsidiaries become parent-child domains. Recent acquisitions become separate forests with trusts. Business units become domain trees. Geographic divisions become site-based child domains.

### Character Pool Modes

- **REALISTIC** — modern professional names, diverse global ethnicities, no franchise association. Default for ambiguous cases.
- **POPCULTURE** — canonical fictional characters from allowed franchises. Exhaust the canonical pool (main cast through named background characters) before creating originals. Sub-modes: single franchise, restricted multi-franchise, mixed. Originals feel native — use franchise naming conventions and cultural patterns. Single-name characters get universe-appropriate surnames. No duplicate firstName+lastName combinations; no reused first or last names within a batch.

### Infrastructure Naming

Canvas produces the *decision* of which naming conventions the company uses (picking one admin account convention, choosing parent-child vs resource forest topology, etc.) and records it in the brief. The canonical pattern rules (username formats, domain suffixes, hostname rules) live in [shared-rules.md](../shared-rules.md) — this phase doc does not restate them. Record the picks in `keyDecisions` so downstream phases know which variant to apply.

---

## Constraints

- Haiku generates bpData; the canvas phase passes it through to the `bpData` field on `architect_canvas_set_context`.
- The `prompt` field is optional metadata for the audit trail.
- `architect_canvas_set_context` auto-stores `company_context` and `user_profiles` for downstream consumers — no extra storage calls needed.
- Target 50-150 quality characters; the hub auto-pads to target count.
- The implementor runs completeness verification (`architect_canvas_get_completeness`) after this phase completes.
- Every company uses modern enterprise IT infrastructure (Active Directory, contemporary databases, standard networking) regardless of fictional setting. Department names and themes can be fictional; IT infrastructure stays modern.
- If a machine or VM limit is specified, reflect that limit exactly in `totalMachines` and capture the constraint verbatim.
