# Enrichment: Files Phase — Reference Doc

> **For:** architect-implementor Phase B (enrichment step — files)
> **Source:** Migrated from skills/enrichment-files/SKILL.md
> **Do not add:** persona blocks, trigger phrases, user interaction framing

File seeding generates realistic workplace file manifests that reflect each user's personality, filing habits, and workplace history. Files are the artifacts a forensic investigator would find on a real machine.

## File Seeding Standards

1. Call `architect_files_get_seeding_context` before generating any manifest — context drives every subsequent decision.
2. Topic fields contain WHO/WHAT/WHY/WHEN in 50+ characters.
3. Every workstation manifest includes 1-2 email artifacts (OST, PST, or saved .eml).
4. Files span all 4 date-decay tiers, with at least 1 file older than 180 days.
5. File paths match the user's filing habit archetype.
6. Server/DC files reference only services actually installed on the machine.
7. Every machine receives file entries sized to its role: **workstations 10-18 entries, servers and DCs 5-10 entries, local/utility machines at least 3 entries**.

## Reference Data

See [shared-rules.md -- File Seeding Categories](../shared-rules.md#file-seeding-categories) for per-machine file targets, filing habit archetypes, category distribution, and the 4-tier date decay table.

All file paths use Windows conventions (`C:\Users\{username}\...`).

## File Content Richness

When generating actual file content (not just manifest entries), the implementor must follow the minimum depth table in [shared-rules.md -- File Content Richness](../shared-rules.md#file-content-richness).

Cross-reference rules: every business file names at least 2 real employees. Scripts reference only services actually installed on the machine. Names and emails stay consistent across all files in a batch.

**Good topic:** "Q3 2024 department budget showing $2.4M allocation across headcount (60%), equipment (25%), training (15%). Prepared by Sarah Chen for director review on Oct 15. Contains salary bands restricted to Finance."

**Bad topic:** "quarterly budget report"

## Parallel Dispatch

For 3+ machines, spawn haiku subagents in parallel (one per machine) — each machine's manifest is independent. See [shared-rules.md -- Haiku Subagent Dispatch Pattern](../shared-rules.md#haiku-subagent-dispatch-pattern) for the canonical template.

**Per-machine context block:** machineNodeId, hostname, machine role, assigned user profile (bio, hobbies, filingHabits, workStyle, department), target file count for the machine type, installed services/plugins from `architect_files_get_seeding_context`.

**Explicit task boundaries:** The implementor must not touch files on other machines. The implementor must not generate credential or SSH-key files (those belong to the exploits phase). The implementor must not reference services that are not installed on the target machine.

## Checklist

1. Identify machines — `architect_canvas_get_overview` + `architect_files_list_counts` to find machines needing files.
2. Get context — `architect_files_get_seeding_context({ machineIds: [machineNodeId] })` per machine.
3. Generate manifest — group file entries into 3-6 themed categories per machine (e.g., "recent projects", "admin scripts", "personal") and submit via `architect_files_create` with `bpData.machineFile`. Total entries per machine follows the targets in Standard #7; a single batch holds up to 20 entries, split into multiple calls if the target exceeds 20.
4. Include email artifacts (OST/PST/.eml), past-admin echoes (stale scripts, old config exports with former admins' names), and service-stack-matched configs for every machine.
5. Verify — `architect_files_list_counts` again confirms all machines have files. Spot-check topic lengths (50+ chars), date distribution (4 tiers), and filing habit path compliance.

## Constraints

- The implementor runs completeness verification (`architect_canvas_get_completeness`) after this phase completes.
- For 5+ machines, the implementor must confirm scope before generating — see [shared-rules.md -- Large Generation Confirmation Gate](../shared-rules.md#large-generation-confirmation-gate).
- Vulnerable files (credentials, SSH keys, breadcrumbs) with `isVulnerabilityFile: true` are placed by the exploits phase, not here.
