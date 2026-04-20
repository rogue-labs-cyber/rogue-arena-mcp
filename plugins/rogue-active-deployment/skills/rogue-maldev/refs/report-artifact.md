# Report Artifact

The final deliverable of a run. Generated at the end of Phase 7 (when the user says "stop" or all playbook techniques have executed).

Location: `runs/{ts}/report.md` (per `refs/workspace-layout.md`).

## Per-technique result shape

Each entry in `runs/{ts}/per-technique/{MITRE-ID}.json` uses this shape:

```json
{
  "technique_id": "T1053.005",
  "technique_name": "Scheduled Task Persistence",
  "test_id": "RM-20260420-a7f3",
  "exec_ts_utc": "2026-04-20T15:12:33Z",
  "target_hosts": ["ws01.contoso.local"],
  "payload_path": "tools/loader-v1/my-loader.exe",
  "payload_scoped": false,
  "verify_status": "success | failed | blocked-by-av",
  "verify_detail": "Scheduled task 'UpdateCheck_RM-...' created; next run 2026-04-20T15:30Z",
  "expected_rule_ids": ["elastic:9a1a2dae-...", "sigma:proc_creation_win_schtasks_persistence.yml"],
  "observed_rule_ids": ["elastic:9a1a2dae-..."],
  "observed_raw_events": [{"index": "logs-windows.sysmon_operational-*", "event_id": 1, "count": 3}],
  "detection_verdict": "partial | full | missed | payload-blocked | no-signal",
  "latency_seconds": 42,
  "notes": "Sigma rule not installed on this Elastic deployment."
}
```

## `report.md` template

```markdown
# Maldev Run Report

**Run:** {timestamp}
**Deployment:** {deployment-name}
**test_id:** {test_id}
**Tool:** {tool-name}-{version}
**Techniques executed:** {N}

## Detection Coverage Summary

| Technique | Expected Rules | Observed Rules | Verdict | Latency |
|---|---|---|---|---|
| T1053.005 | 2 | 1 | partial | 42s |
| T1003.001 | 3 | 0 | missed | — |
| ...

## Gaps — expected rules NOT observed

| Technique | Missing Rule ID | Rule Source | Notes |
|---|---|---|---|
| T1003.001 | elastic:<uuid> | LSASS memory access | Rule exists but did not fire. Worth investigating: rule tuning, payload behavior, or false-negative baseline. |
| ...

## Unexpected detections

| Technique | Observed Rule ID | Not in expected set | Context |
|---|---|---|---|
| ... | ... | ... | ... |

## Failures / AV blocks

| Technique | Failure Mode | Evidence |
|---|---|---|
| T1003.002 | blocked-by-av | Defender EventID 1117, `Trojan:Win32/Meterpreter` signature hit |

## Baseline delta

Alerts in the 15-minute window BEFORE execution: {baseline_count}.
Alerts in the 15-minute window DURING execution: {exec_count}.
Delta attributable to this run: {exec_count - baseline_count}, correlated by `test_id`: {test_id_attributed}.

## C2 re-test reminder

These results reflect direct-shell execution. Detection surface will shift when TTPs flow through a C2's staging, encoding, and transport layers. Rerun the techniques above through your implant to see the production detection picture.

## Artifacts

- Playbook used: `{path-to-playbook}` (hash: {sha256})
- Per-technique JSONs: `runs/{ts}/per-technique/`
- Baseline snapshot: `runs/{ts}/baseline.json`
```

## Detection verdict taxonomy

| Verdict | Meaning |
|---|---|
| `full` | All expected rule IDs observed |
| `partial` | Some but not all expected rule IDs observed |
| `missed` | Zero expected rule IDs observed, but the technique did execute |
| `payload-blocked` | Payload was blocked by AV/EDR before it ran (e.g., Defender 1116/1117); technique never fired |
| `no-signal` | Query ladder exhausted with no results across alert + raw indices — distinct from "missed" |

## Generation rules

- Write `per-technique/{ID}.json` immediately after each technique in Phase 7, not at the end. This makes the run resumable.
- Generate `report.md` at end-of-run. It's derived from the per-technique JSONs + baseline + run-spec.
- Do not overwrite prior reports. Each run has its own `runs/{ts}/report.md`.
- If the user stops mid-run, still write a partial report with what was completed.

## Run-over-run comparison

Comparing v1 vs v2 of a tool across runs is out of scope for this ref — it's a separate `refs/run-comparison.md` (not yet written). The per-technique JSON schema above is forward-compatible with that future ref.
