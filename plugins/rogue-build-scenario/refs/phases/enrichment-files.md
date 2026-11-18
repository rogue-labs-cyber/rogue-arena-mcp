# Enrichment: Files Phase — Reference Doc

> **Staging:** File content is staged per `refs/shared-rules.md`; each file goes to the write tool for its kind (`architect_files_write_text`, `architect_files_write_log`, `architect_files_write_document`, `architect_files_write_sheet`, `architect_files_write_deck` or `architect_files_write_mail`). Text-based files (plaintext, script, config, email, log) use the concat pattern (single fragment, typically `01-body.<ext>`); structured files (docx, xlsx, pptx) use named-sections — one fragment per sheet / section / slide (e.g. `sheet-sales.json`, `section-intro.json`, `slide-01.json`). Content over 1,048,576 bytes (JSON-stringified) is refused.

> **For:** flow-implement Phase B (enrichment step — files)
> **Do not add:** persona blocks, trigger phrases, user interaction framing

File seeding generates realistic workplace file manifests that reflect each user's personality, filing habits, and workplace history. Files are the artifacts a forensic investigator would find on a real machine.

## Prerequisite: the world record

A file write for a machine with people on it is refused until the world record holds the organization (with its one mail domain, `conventions.mailDomain`, ending in `.local`), the story clock (`storyClock.today`: nothing is dated after it) and every account assigned to the machine on the roster. Set them with `architect_forest_manage` before writing files:

- `world`: `organization` (`name`, `business`, `conventions.mailDomain`, plus departments, sites, other organizations and dated history where the scenario has them) and `storyClock` (`today`).
- `addPeople`: one entry per assigned account (`account`, `name`, `kind`, and `title`, `department`, `manager`, `mail`, `groups` where known).

`architect_files_get_seeding_context` answers `storyReady` and `storyMissing`, overall and per machine: write nothing for a machine whose `storyReady` is false, and fix what its `storyMissing` names first.

## File Seeding Standards

1. Call `architect_files_get_seeding_context` before generating any manifest — context drives every subsequent decision.
2. Each file's `summary` (the write tools take 10 to 500 characters) contains WHO/WHAT/WHY/WHEN in 50+ characters.
3. Every workstation manifest includes 1-2 email artifacts (OST, PST, or saved .eml).
4. Files span all 4 date-decay tiers, with at least 1 file older than 180 days: set each file's `modifiedAt` (`properties.modifiedAt` for a document, sheet or deck) counting back from the story clock's `today`, never after it.
5. File paths match the user's filing habit archetype.
6. Server/DC files reference only services actually installed on the machine.
7. Every machine receives file entries sized to its role: **workstations 10-18 entries, servers and DCs 5-10 entries, local/utility machines at least 3 entries**.

## Reference Data

See [shared-rules.md -- File Seeding Categories](../shared-rules.md#file-seeding-categories) for per-machine file targets, filing habit archetypes, category distribution, and the 4-tier date decay table.

All file paths use Windows conventions (`C:\Users\{username}\...`).

## File Content Richness

When generating actual file content (not just manifest entries), follow the minimum depth table in [shared-rules.md -- File Content Richness](../shared-rules.md#file-content-richness).

Cross-reference rules: every business file names at least 2 real employees. Scripts reference only services actually installed on the machine. Names and emails stay consistent across all files in a batch.

**Good summary:** "Q3 2024 department budget showing $2.4M allocation across headcount (60%), equipment (25%), training (15%). Prepared by Sarah Chen for director review on Oct 15. Contains salary bands restricted to Finance."

**Bad summary:** "quarterly budget report"

## Parallel Dispatch

For 3+ machines, spawn haiku subagents in parallel (one per machine) — each machine's manifest is independent. See [shared-rules.md -- Haiku Subagent Dispatch Pattern](../shared-rules.md#haiku-subagent-dispatch-pattern) for the canonical template.

**Per-machine context block:** machine name (or id), hostname, machine role, assigned user profile (bio, hobbies, filingHabits, workStyle, department), target file count for the machine type, installed services/plugins from `architect_files_get_seeding_context`.

**Explicit task boundaries:** Do not touch files on other machines. Do not reference services that are not installed on the target machine.

## Checklist

1. Identify machines — `architect_canvas_get_overview` + `architect_files_list_counts` to find machines needing files.
2. Get context — `architect_files_get_seeding_context({ machines: ["<machine name or id>"] })` (up to 10 machines per call). Skip any machine whose `storyReady` is false and report what its `storyMissing` names.
3. Generate manifest — group file entries into 3-6 themed categories per machine (e.g., "recent projects", "admin scripts", "personal") and write each file with one call to the write tool for its kind, with `machine`, `fileName` (its ending gives the format), `targetPath`, `summary` and `content`. Total entries per machine follows the targets in Standard #7.

   **File type mix.** Before generating the manifest, read the machine's context (backstory, role, installed plugins), the assigned user's context (department, level, day-to-day work), and the seeding goal (what story the files should tell). Choose file types that would realistically exist on THAT specific machine for THAT specific user. A real corporate filesystem reflects real work — generic "office machine" templates are a tell. `.md` is for README-style notes only; never the default, never a majority of files.

4. Include email artifacts (OST/PST/.eml), past-admin echoes (stale scripts, old config exports with former admins' names), and service-stack-matched configs for every machine.
5. Verify — `architect_files_list_counts` again confirms all machines have files. Spot-check `summary` lengths (50+ chars), date distribution (4 tiers), and filing habit path compliance.

## Constraints

- Verify state via `architect_canvas_get_overview` after this phase completes.
- For 5+ machines, confirm scope before generating — see [shared-rules.md -- Large Generation Confirmation Gate](../shared-rules.md#large-generation-confirmation-gate).
- Do not seed credential dumps, SSH keys, or other vulnerability breadcrumbs here.
