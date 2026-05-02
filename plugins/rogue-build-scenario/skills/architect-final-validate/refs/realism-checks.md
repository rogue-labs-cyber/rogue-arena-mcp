# Validation: Realism — Reference Doc

> **For:** architect-final-validate skill — realism scope of the final audit
> **Do not add:** persona blocks, trigger phrases, user interaction framing

## Purpose

Evaluate whether the environment looks believable for its stated purpose. Read-only — no mutations. Technical correctness (credentials, plugin params, reachability) belongs to `infrastructure-checks.md`; this validation doc asks "does a medium-sized law firm actually look like a law firm?"

## The Proportionality Principle

Scale checks to the stated goal, not Fortune 500 standards. This is the most important rule — violating it produces inflated findings that are correctly ignored.

- A "small law firm with 5 machines" does not need SIEM, print servers, or backup infrastructure. Those findings stay LOW at most.
- A "3-machine test lab" draws no enterprise-infrastructure findings at all.
- A "large enterprise healthcare network" draws findings for missing clinical systems, sparse AD structure, or inadequate user counts.
- Severity matches what was specified. If the scenario says "small", judge by small-company standards.

When in doubt, ask: "Would a real company of this size and type have this?"

## Seven Finding Categories

### 1. user_population
User count vs stated company size. See [shared-rules.md § Company Size Limits](../../../refs/shared-rules.md#company-size-limits) for the authoritative per-tier user and machine ranges. Flag if DC has 5 users but scenario says "medium company."

### 2. file_services
File share completeness and organization. Real file servers have multiple shares: Shared (company-wide), department folders (HR, Finance, Engineering), user home directories, IT/Admin tools share, possibly Archives, Projects, Templates. Flag if file server has only 1-2 shares.

**Per-user document seeding (logged-in workstations).** A real user's machine has documents — work artifacts, role-aligned drafts, hobby-related items, scattered notes. Empty desktops are obviously synthetic. For each machine where a user is `isActivelyLoggedIn: true`:

1. Call `architect_files_get_seeding_context([machineId])` once to pull the user's `filingHabits`, `workStyle`, `hobbies`, and `workplaceEvents.potentialFiles` hints.
2. Call `architect_machine_list_files([machineId])` and count files seeded under user-relevant paths (e.g., `C:\Users\{sam}\Desktop`, `Documents`, `Downloads`).
3. Score against threshold (default 20 user-relevant docs):

   | File count | Severity |
   |---|---|
   | 0–5 | **HIGH** |
   | 6–15 | **MEDIUM** |
   | 16–19 | **LOW** |
   | 20+ | no finding |

When flagging, surface the seeding-context hints inline so the user knows *what* would fit — e.g., *"User `jdoe` has 4 seeded files. Hobbies: cycling, photography. Recent workplaceEvent suggests draft expense reports. Add ~16 more user-relevant docs (cycling route GPX, photo metadata, expense draft .xlsx, role-aligned project notes)."*

This sub-check applies only to logged-in user machines. Servers, DCs, and machines without active user assignments are exempt.

### 3. industry_infrastructure
Industry-specific systems and applications. See [shared-rules.md § Industry-Specific Infrastructure](../../../refs/shared-rules.md#industry-specific-infrastructure) for the expected systems per industry. Flag if "Healthcare company" has no clinical systems.

### 4. ad_structure
OU layout, groups, service accounts. OUs reflect real departments (not just "Users" and "Computers"). Group structure has role-based groups (not just "Domain Users"). Service accounts for each major application. Nested groups for delegated permissions. Flag if all users are in a single OU with no security groups defined.

### 5. network_services
DNS, DHCP, print, backup, monitoring. Most environments need DNS (usually on DC), DHCP, file services, print services, backup system, and monitoring/management for medium+ environments. Flag if no print server in a 50+ employee company.

### 6. security_infrastructure
SIEM or log aggregation, endpoint protection management, vulnerability scanner, network monitoring. Flag if "security-focused scenario" has no security tooling.

### 7. general_realism
Anything else that affects believability.

## Severity Classification

Each finding gets one severity. Severity is about the finding itself, not the final score.

| Severity | Example |
|----------|---------|
| **CRITICAL** | 3 users for "large enterprise", completely wrong industry |
| **HIGH** | Law firm with no document management, healthcare with no clinical systems |
| **MEDIUM** | No print server, no backup, sparse file shares |
| **LOW** | More detailed OU structure, additional service accounts |

## Score Ceiling Rules

After classifying each finding's severity (using the Proportionality Principle), apply the lowest applicable ceiling to the overall realism score:

| Condition | Ceiling |
|-----------|:------------:|
| Any CRITICAL finding | **4** |
| 2 or more HIGH findings | **6** |
| Any HIGH finding | **7** |
| Any realism category not evaluated | **6** |

## Honest Scoring

The validator gives honest scores, not nice ones — score inflation is the single most common failure in realism scoring. The environment gets scored, not the person who built it.

- Lead with data. No "Great news!" or "Looking good overall!" openers before the findings.
- FAIL findings stay FAIL. Softeners like "minor," "probably fine," or "easy fix" shift classification without evidence.
- "Roughly right" is not evidence. Call `architect_machine_get` on the DC, count actual users in createusers, and compare to the company size table with the exact number.
- AD structure is the forensic backbone of every pentest scenario. Flat OUs, missing service accounts, and absent security groups are trivially unrealistic to anyone running `Get-ADUser` or `BloodHound`.

## Score Justification

Before assigning a score:

1. **Count findings by severity** — state the exact count: "X CRITICAL, Y HIGH, Z MEDIUM, W LOW"
2. **Apply ceiling rules** — state which ceiling applies and why
3. **Justify why not one lower** — cite the positive evidence that prevents the score from dropping a point
4. **State what would raise by one** — name the specific improvement that would earn the next point up

If the "why not one lower" justification is missing, the score is one lower.

## Scoring Guide

| Score | Meaning |
|-------|---------|
| 9-10 | Excellent — would fool an experienced sysadmin at first glance |
| 7-8 | Good — solid foundation, minor gaps a real environment would have |
| 5-6 | Adequate — functional but noticeably missing common infrastructure |
| 3-4 | Weak — major gaps in expected infrastructure or population |
| 1-2 | Poor — fundamental mismatch between goal and what was built |

## Reading the Canvas (efficient prep)

Before scoring, prep the data the categories need:

1. `architect_canvas_get_overview` for VLANs, machines, domains, and `resourceBudget`.
2. `architect_canvas_get_context` for intended industry, size, and culture (drives the Proportionality Principle).
3. `architect_forest_get_events` for narrative + AD topology.
4. `architect_vlan_list` then `architect_vlan_get` per VLAN to inspect AD blueprints, user archetypes, and security groups.
5. `architect_machine_get` on every DC and every file server (use `discover_tools(search: "batch")` for 3+ machines). Count actual users from `CreateUsers` rather than estimating.
6. `discover_tools(search: "vulnerability state")` to audit attack-surface proportionality.

Every one of the 7 categories must be evaluated. A category left unevaluated drops the score ceiling to 6 (per Score Ceiling Rules above). The orchestrator (SKILL.md) owns the consolidated report and verdict — this ref's job is the score, the findings, and the justification.
