# Canvas Phase — Reference Doc

> **For:** flow-implement Phase B (canvas context step)
> **Do not add:** persona blocks, trigger phrases, user interaction framing

---

## Overview

The canvas phase is the first phase of the build cascade. No upstream dependencies. It produces the company (the world record: organization, story clock, executives), the settings the lab is built to, and the naming decisions consumed by all downstream phases (domains, machines, enrichment).

The canvas phase brainstorms company context through a focused discovery session, then generates the foundational canvas blueprint — the organization with its departments and dated history, the executive team, the naming conventions, and the lab's settings. Everything downstream (domains, VLANs, machines, files) builds on what this phase produces.

## Core Rules

Do not use TodoWrite during build execution. The phase's gate sequence is the progress tracker.

These are the load-bearing moves for this phase. Every one must happen on every canvas session.

1. **Enrich vague prompts.** "tech company" is not enough detail. Infer regulatory landscape, propose a narrative hook, and confirm with the user before proceeding.
2. **Run the calibration protocol.** Every scenario is unique. Reusing a mental template means you are not listening to THIS user.
3. **Verify technologies via `architect_plugin_catalog_search`.** Assumptions about plugin availability cause cascading failures in every downstream phase.
4. **Read reference files before validating Haiku output.** Refs contain size limits, hostname rules, and domain constraints that change.
5. **Inspect Haiku output before storing.** Haiku can hallucinate naming patterns, miss content policy, or invert prominence distributions. You are the gate.
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

If the user names specific technologies or attack techniques, verify via `architect_plugin_catalog_search` before including them in the brief. If no matching plugin exists, inform the user honestly, suggest available alternatives, and let them decide. Note substitutions in the brief.

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

> **Staging:** The company is staged per the Staged Dispatch Pattern in `refs/shared-rules.md`, under `staging/canvas-context/` as named sections (`organization.json`, `story-clock.json`, `executives.json`, `settings.json`); the orchestrator handles assembly and push. The hub refuses a part over its limits (for example, more than 100 history entries) and names the field at fault.

Once the user confirms the brief, transition directly into generation:

"Scenario brief is ready. Generating the canvas blueprint — the company, its executives, and its naming conventions."

### What Is Written Where

Two tools hold this phase's output:

- **The world record** (`architect_forest_manage`, read back with `architect_forest_get_events`) is the one home of the company:
  - `world.organization`: `name`, `business` (what it does and for whom), `sector`, `headcount` (the whole company, not the lab), `sites`, `departments` (`name`, `headcount`, `head`: the head's roster account, `purpose`), `entities` (every other named organization: `name`, `relation`, `kind`, `mailDomain` ending in `.local`), `products`, `culture`, `situation` (what it is dealing with now: the brief's narrative hooks), `founded`, `history` (the one dated history: `date` and `text`, from the brief's milestones), and `conventions` (`mailDomain`, the one internal mail domain ending in `.local`; `accountFormat`; `hostnameFormat`).
  - `world.storyClock`: `today` (the day the player arrives; nothing is dated after it), optional `timeZone` and `note`.
  - `addPeople`: the executive team, one entry each: `account`, `name`, `kind: "staff"`, `title`, `department`, `manager`, `mail`, `executive: true`; and each department head who is not an executive, without `executive`.
- **The settings** (`architect_canvas_set_context`, read back with `architect_canvas_get_context`): `securityPosture`, `characterStyle`, `allowedFranchises` (popculture only) and `constraints` (`minMachines`, `maxMachines`, `minUsers`, `maxUsers`, `minDomains`, `maxDomains`, from the size tier in shared-rules.md). Every call replaces all four.

### Generation Gates

**GATE 1: Content policy is absolute.** The authoritative content policy lives in shared-rules.md. Violations are rejected regardless of user request, franchise fidelity, or narrative justification.

**GATE 2: Context before generation.** Dispatch Haiku only after company context is gathered (industry, size, and at least one narrative dimension).

**GATE 3: Reference file paths in every dispatch.** Every Haiku dispatch includes ref file paths so Haiku can read size limits, hostname rules, and content policy before generating.

**GATE 4: Inspect before storing.** After Haiku returns JSON, spot-check before calling `architect_forest_manage`: the executives include a CEO and a security leader, each department's `head` is an account in `addPeople`, every mail domain ends in `.local`, no `history` entry is dated after `storyClock.today` or before `founded`, no content policy violations. Re-dispatch with corrections if any check fails.

Verify state via `architect_canvas_get_overview` after this phase completes: its `blueprintSummary.missing` is empty.

### Haiku Subagent Dispatch

You (the orchestrator) handle the workflow: reading state, deciding what to build, calling MCP tools. Subagents handle context generation: you give them ref file paths + context, they return JSON. You assemble their output into one `architect_forest_manage` call and one `architect_canvas_set_context` call.

See [shared-rules.md -- Haiku Subagent Dispatch Pattern](../shared-rules.md#haiku-subagent-dispatch-pattern) for the canonical template shape.

**Use 1 subagent call:**

1. **Subagent — the company (~15KB).** Dispatch a Haiku subagent to generate `world.organization`, `world.storyClock` and the executives for `addPeople`. This fits within the Read tool's token limit and returns inline. Per-phase context block: include `<canvas-context>[architect_canvas_get_overview result]</canvas-context>` and `<user-request>[industry, size, themes]</user-request>`.

**Storage:** After the subagent completes:
1. `architect_canvas_set_context` with `securityPosture`, `characterStyle`, `allowedFranchises` and `constraints`.
2. `architect_forest_manage` with `world` (`organization` and `storyClock`) and `addPeople` (the executives) in ONE call: the keys are saved together or not at all. The organization and story clock are each replaced whole when sent, so a later change sends the whole part again.

### Validation Checklist

Execution sequence — run before reporting success:

1. **Executive completeness** — CEO + security leader in `addPeople` with `executive: true`; industry-specific roles included (CTO for tech, CFO for finance); team size matches size tier.
2. **Headcount math** — `constraints.maxUsers` aligns with the size tier from shared-rules.md; the organization's `headcount` is the whole company, so it may exceed the lab's users.
3. **Naming conventions** — `conventions.hostnameFormat` and `conventions.accountFormat` match the company size tier and the picks in `keyDecisions`; security group prefixes correct (GG-/DL-/UG-).
4. **Content policy** — zero violations; one violation rejects and re-dispatches.
5. **Thematic fidelity** — the organization reflects the requested industry/franchise/themes, not a generic placeholder.

### Modify Flow

When modifying an existing canvas:
1. Read current state via `architect_canvas_get_overview`, the company via `architect_forest_get_events` (its `world`) and the settings via `architect_canvas_get_context` (its `profile`).
2. Identify what needs changing.
3. Dispatch Haiku with the current part + modification request (preserve unchanged fields).
4. Store the changed part: the whole `world.organization` or `world.storyClock` via `architect_forest_manage`, changed people via `addPeople`, or all four settings via `architect_canvas_set_context`.
5. Trust a done answer, and read its notes first: **Not used** names a field the tool left out, and **Nothing was changed** means nothing was saved. Post-routing verification (overview) is handled by the root orchestrator.

If the modification is downstream (VLAN or machine changes), skip this phase — the appropriate downstream phase handles it.

### Error Handling

If `architect_forest_manage` or `architect_canvas_set_context` refuses the call: read its **Fields** (each with what was expected and what was sent) and its **Hint**, fix those fields, and re-dispatch or fix directly if the error is simple. Nothing was saved, so send the whole call again. If `architect_canvas_get_overview` lists parts in `blueprintSummary.missing` after a done call, write those parts.

---

## Canvas-Specific Domain Knowledge

Shared reference data (company size tiers, security posture enum, industry regulatory frameworks, content policy, hostname rules, character prominence, trait archetypes) lives in [shared-rules.md](../shared-rules.md). The behavioral rules below are canvas-specific.

### Company Profile Inference

- **Industry from the user's prompt, not universe stereotypes.** Red Rising can be mining, military, biotech, or government. Star Wars can be military, logistics, or education. Pick what makes the universe distinct rather than the obvious default or a generic industry that works anywhere.
- **Thematic fidelity.** "Star Wars Empire" becomes an authoritarian logistics megacorp with military departments — not "Meridian Logistics Corporation." A company name containing "Studios" or "Entertainment" for a non-media prompt signals the theme got sanitized.
- **Departments:** Always required — IT/Technology, Finance/Accounting, HR/Personnel. Add as size permits — Operations, Sales/Marketing, Legal, Facilities. Department `headcount`s sum to the organization's `headcount` (+/-5%). Fictional scenarios can theme department names, but functions map to standard enterprise roles.
- **Executive team:** CEO plus at least one security leader (CISO/CIO/VP IT), each an `addPeople` entry with `executive: true`. Industry-specific additions — CTO (tech), CFO (finance), CMO (healthcare). Background split 40-60% internal promotions / 40-60% external hires. At least one leader with security-relevant vulnerabilities.
- **Corporate structure to AD forest:** Subsidiaries (the organization's `entities` of kind `subsidiary`) become parent-child domains. Recent acquisitions become separate forests with trusts. Business units become domain trees. Geographic divisions become site-based child domains.

### Infrastructure Naming

Canvas produces the *decision* of which naming conventions the company uses (picking one admin account convention, choosing parent-child vs resource forest topology, etc.) and records it in the brief and in the organization's `conventions` (`accountFormat`, `hostnameFormat`). The canonical pattern rules (username formats, domain suffixes, hostname rules) live in [shared-rules.md](../shared-rules.md) — this phase doc does not restate them. Record the picks in `keyDecisions` so downstream phases know which variant to apply.

---

## Constraints

- Haiku generates the organization, story clock and executives; the canvas phase passes them through as `world` and `addPeople` of `architect_forest_manage`.
- `architect_canvas_set_context` takes only the four settings; a field a tool does not take is left out and named under **Not used** in the answer.
- Downstream phases read the company back with `architect_forest_get_events` and the settings with `architect_canvas_get_context`.
- Verify state via `architect_canvas_get_overview` after this phase completes.
- Every company uses modern enterprise IT infrastructure (Active Directory, contemporary databases, standard networking) regardless of fictional setting. Department names and themes can be fictional; IT infrastructure stays modern.
- If a machine or VM limit is specified, reflect that limit exactly in `totalMachines` and capture the constraint verbatim.
