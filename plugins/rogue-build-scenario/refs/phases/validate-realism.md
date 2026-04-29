# Validation: Realism — Reference Doc

> **For:** architect-implementor Phase E; architect-freeform on-demand validation
> **Do not add:** persona blocks, trigger phrases, user interaction framing

## Purpose

Evaluate whether the environment looks believable for its stated purpose. Read-only — no mutations. Technical correctness (credentials, plugin params, reachability) belongs to validate-infrastructure; this validation doc asks "does a medium-sized law firm actually look like a law firm?"

## The Proportionality Principle

Scale checks to the stated goal, not Fortune 500 standards. This is the most important rule — violating it produces inflated findings that are correctly ignored.

- A "small law firm with 5 machines" does not need SIEM, print servers, or backup infrastructure. Those findings stay LOW at most.
- A "3-machine test lab" draws no enterprise-infrastructure findings at all.
- A "large enterprise healthcare network" draws findings for missing clinical systems, sparse AD structure, or inadequate user counts.
- Severity matches what was specified. If the scenario says "small", judge by small-company standards.

When in doubt, ask: "Would a real company of this size and type have this?"

## Seven Finding Categories

### 1. user_population
User count vs stated company size. See [shared-rules.md § Company Size Limits](../../refs/shared-rules.md#company-size-limits) for the authoritative per-tier user and machine ranges. Flag if DC has 5 users but scenario says "medium company."

### 2. file_services
File share completeness and organization. Real file servers have multiple shares: Shared (company-wide), department folders (HR, Finance, Engineering), user home directories, IT/Admin tools share, possibly Archives, Projects, Templates. Flag if file server has only 1-2 shares.

### 3. industry_infrastructure
Industry-specific systems and applications. See [shared-rules.md § Industry-Specific Infrastructure](../../refs/shared-rules.md#industry-specific-infrastructure) for the expected systems per industry. Flag if "Healthcare company" has no clinical systems.

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

Before assigning a score, the validator must:

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

## Validation Checklist

1. **Read full canvas state** — `architect_canvas_get_overview` for VLANs, machines, domains. Check `resourceBudget` from overview and note budget utilization.
2. **Read company context** — `architect_canvas_get_context` for intended industry, size, and culture.
3. **Read forest events** — `architect_forest_get_events` for narrative and AD topology.
4. **Read VLAN details** — `architect_vlan_list`, then `architect_vlan_get` for each VLAN to inspect AD blueprints, user archetypes, security groups.
5. **Read machine details** — `architect_machine_get` on every domain controller and every file server. When reading 3+ machines, `discover_tools(search: "batch")` for batch reads. Count actual users from DC createusers parameters from tool output, not estimates.
6. **Check vulnerability distribution** — `discover_tools(search: "vulnerability state")` to audit attack surface proportionality.
7. **Evaluate all 7 categories** — user_population, file_services, industry_infrastructure, ad_structure, network_services, security_infrastructure, general_realism. A category left unevaluated drops the score ceiling to 6.
8. **Present findings** — structured format with severity, category, description, evidence, and suggestion for each finding. Include score justification.

## Result Format

```json
{
  "realismScore": 5,
  "findings": [
    {
      "severity": "HIGH",
      "category": "industry_infrastructure",
      "description": "Healthcare company missing EMR/EHR system",
      "evidence": "architect_canvas_get_overview shows 4 servers. No machine has clinical application plugins. Company context states 'regional healthcare provider'.",
      "suggestion": "Add a clinical application server with EHR software"
    }
  ],
  "overallAssessment": "Findings: 0 CRITICAL, 1 HIGH, 1 MEDIUM, 1 LOW. Ceiling: 7 (1 HIGH finding). Score 5 — not 4 because user population (85 users) and file shares (6 shares on FS01) are proportional. Would reach 6 with clinical application server added, 7 with print services."
}
```

## Constraints

- **Read-only.** Tool calls are limited to `architect_*_get_*`, `architect_*_list_*`, `architect_canvas_get_completeness`, `architect_canvas_get_context`, `architect_forest_get_events`, and catalog read tools. No mutations.
- Use draft nodeIds (e.g., `vlan-corp`, `machine-corp-dc01`) — canvas UUIDs fail.
- Every finding carries severity + category + evidence.
- `architect_canvas_get_overview` failure blocks everything — report the failure and stop.
