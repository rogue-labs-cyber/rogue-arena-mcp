# Phase 7 — Go Live (the test loop)

Every entry path converges here. Read `refs/siem-query-patterns.md` alongside this ref — it owns all detection observation rules.

## Mode-A note (BYO payload, no prior playbook)

If the user entered via Mode A (ready payload, skipped phases 2–6), first synthesize a minimal playbook stub per the SKILL.md Entry Points section. Phase 7 needs a `test_id`, `payload_scoped` flag, and `target_hosts` for every execution — Mode A doesn't generate them automatically.

## Pre-flight

1. Create the run directory: `runs/{ISO8601-UTC}/` (layout in `refs/workspace-layout.md`).
2. Generate the run-scoped `test_id` and save to `runs/{ts}/test_id.txt`.
3. Capture the **SIEM baseline**: run the observation queries without the `test_id` filter, over the 15 minutes before any technique fires. Save to `runs/{ts}/baseline.json`. All post-exec results are diff'd against this.
4. Snapshot target VMs. Poll `deployment_get_active_tasks` every ~10s, max 12 polls. If still running, ask to keep waiting or move on.

## Execution loop (principle-form)

For each technique in the playbook:

- **Announce** the technique and target.
- **Snapshot** at marked points; poll to completion.
- **Upload** with `test_id` embedded in the artifact name — `loader_RM-20260420-a7f3.exe`, `procdump_RM-....exe`. Troubleshoot upload failures before proceeding: verify path with `deployment_dir_listing`, check disk space, confirm write permissions.
- **Execute** OS-aware via `deployment_exec_command`. Payloads longer than ~20s use `deployment_run_script_bg` + `deployment_bg_output` + `deployment_script_status` — the synchronous tool times out at 30s.
- **Verify** that the technique landed: exit code + artifact check. On failure, follow the classification branch below before retrying.
- **Observe** the SIEM per `refs/siem-query-patterns.md`: `test_id` filter first, 15-min window, broaden-on-empty ladder. Quote rule names / severities as evidence.
- **Record** the result to `runs/{ts}/per-technique/{MITRE-ID}.json` per `refs/report-artifact.md`, and write a diary entry via `deployment_diary_write`.
- **Decide** next move: continue, revert and retry, revert and move on, keep current state, or stop. If the user provided `auto: true` in the run spec, skip the confirmation — continue on verify+observe success, self-correct once then revert on failure.

After a revert: poll to completion, then refresh VM inventory with `deployment_list_vms` before the next iteration. The deployment is in a transitional state mid-revert and other tools return stale data.

## Verify-failure classification

Before proposing command variants, classify why verify failed:

| Evidence | Likely cause | Action |
|---|---|---|
| Defender Event 1116 (threat detected) or 1117 (threat remediated) in the last 2 min | AV blocked the payload | Record `verify_status: blocked-by-av`, `detection_verdict: payload-blocked`. Do NOT retry the same command — the payload needs mutation or Path B substitution check. |
| `Get-MpThreatDetection` returns a recent entry with the payload's filename | Defender quarantined the artifact | Same as above |
| Elastic Endpoint alert in `logs-endpoint.events.file` with `event.action: "deletion"` on the uploaded file | EDR removed the artifact | Same as above |
| Exit code non-zero, no AV evidence, stderr mentions "not recognized" / "cannot find" | Tool not on PATH or wrong path | Probe with `where`/`which`; if missing, upload from `tools/{version}/` |
| Exit code non-zero, no AV evidence, stderr mentions "Access is denied" | Privilege issue | Note `elevation_required`; if the session is non-elevated, flag for user |
| Exit code non-zero, stderr mentions syntax | Command parse failure | Re-fetch the source (ART YAML or prose), diff against the playbook command, propose a variant, retry once |
| Verify artifact missing, no stderr | Silent failure — payload ran but produced nothing | Broaden SIEM query to see if the process started; may indicate payload bug |

Record the classification in `verify_detail` in the per-technique JSON.

## Self-correction (syntax only)

After syntax classification:
1. Re-fetch the technique source (ART YAML or the prose-research URL in the playbook).
2. Diff against the playbook command. Common repairs: binary not on PATH, quoting, missing elevation, mis-substituted input argument.
3. Propose the variant. Update the playbook. Retry once.
4. If the second attempt fails, record `verify_status: failed` and move on — don't burn the run looping.

Do not self-correct when classification is AV-block — that needs payload mutation, not command mutation.

## Closing

On stop or end-of-playbook:
1. Write the final `runs/{ts}/report.md` per `refs/report-artifact.md`.
2. Log an `engagement_summary` diary entry pointing at the report path.
3. Deliver the closing advisory about direct-shell vs C2-wrapped detection surface.
