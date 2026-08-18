# Flow — The Build

> Loaded by `architect-brainstorm` after Gate 2. Do not invoke as a skill.

## Canvas ID

Before catalog search, collect the canvas ID.

> "Before I search the plugin catalog, I need your canvas ID.
> Create a new canvas in the Rogue Arena UI (or browse to an existing one),
> click the animated Rogue Oracle button at the top left of the toolbar,
> and click 'Get Started'. Then paste the canvas ID here."

Set the canvas via `rogue_set_canvas` before proceeding.

## Plugin mapping

Search the plugin catalog on the main agent (MCP tools required — subagents cannot access them). Use `architect_plugin_catalog_search` and `architect_plugin_catalog_list_templates` to find plugins for non-default machine roles. Standard roles (workstations, DCs, file servers) need no plugin entry.

**Surface Addon Config Sample counts during catalog search.** `architect_plugin_catalog_search` returns `addonConfigSampleCount` per result, and `architect_plugin_catalog_list_full` returns the per-sample summaries (`{ sampleId, name, notes, language }`) without the code body. When a plugin candidate ships samples, list them in the Phase 3 visual so the user knows curated content exists — e.g., "Ghosts plugin (12 samples available — including 'office worker — Outlook + Chrome', 'developer — Stack Overflow + GitHub')." The implement step does the actual sample lookup at build time; this step just surfaces availability so the user can steer at Gate 3.

Once plugin mapping is determined, dispatch a **Haiku subagent** to generate `scenario_part3.yml`. Pass it: plugin mapping results, domain relationships, company size + security posture (for defaults), and paths to part1 + part2 YMLs. The subagent writes the file and returns.

If a requested role has no matching plugin, note the substitution and suggest alternatives.

Only map plugins, not params. Params belong to `refs/flow-implement.md`.

**Gate 3.** Present the plugin mapping (bullets, not code blocks). List substitutions with ⚠. Show defaults summary. **For each mapped plugin that ships samples, list the available sample notes (one line per sample) so the user can steer toward a preferred sample or defer the choice to the implement step.** Ask for swaps. On confirm, continue to the files-enrichment gate.

## Files enrichment

Hard gate — the implement step runs the whole build without further prompting, so commit this now.

<HARD-GATE>
One question. STOP. Wait for user response. Then write to `scenario_part1.yml`.
</HARD-GATE>

**Ask:**

> "One last thing before I validate and build — want me to seed realistic workplace files on each machine after deployment? Files pull from each user's role, hobbies, and `security_habits` — emails, docs, configs that look like real workplace artifacts. Once the build starts it runs straight through, so committing now keeps it hands-off.
>
> Recommended density per workstation by canvas size: small (3-8 machines) → 8 files; mid (8-15) → 12; large (15-25) → 15. Servers and DCs use platform defaults.
>
> Pick a number per workstation, or say 'skip'."

**Wait** — STOP. Do not proceed until the user answers.

**Write** — to `scenario_part1.yml`:

- **Skip** → set `enrichment.files: false`. Servers and DCs also skipped.
- **Number N** → set `enrichment.files: true` and `defaults.files_per_workstation: N`. Servers and DCs use platform defaults from `refs/scenario-schema.md`.

Then return to the orchestrator. Stamp `canvas_id` into all three YML files, self-review against `refs/scenario-schema.md`, and load `refs/flow-validate.md`.
