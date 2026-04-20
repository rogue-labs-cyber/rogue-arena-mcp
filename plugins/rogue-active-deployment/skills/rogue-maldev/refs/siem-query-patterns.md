# SIEM Query Patterns

Single source of truth for detection observation. Phases 5 and 7 both rely on this.

## The `test_id` marker

### Generation

One `test_id` per run, shared across all techniques in that run. Format: `RM-{YYYYMMDD}-{short-hash}` (example: `RM-20260420-a7f3`). Generate once during Phase 7 pre-flight, store in `runs/{ts}/test_id.txt` per `refs/workspace-layout.md`.

If Mode A (BYO tool, no playbook), still generate a `test_id` for this run. Embed it before every execution.

### Injection

Embed the marker wherever the VM records artifacts that reach the SIEM:

- **Filenames**: `loader_RM-20260420-a7f3.exe`
- **Scheduled task names**: `UpdateCheck_RM-20260420-a7f3`
- **Registry values**: `RunOnce\Update_RM-20260420-a7f3`
- **Process cmdline arguments**: `--log=C:\temp\RM-20260420-a7f3.log`
- **File contents (canary tokens)**: drop a file with the marker before execution

Pick the injection point that the target rule inspects. Persistence techniques → filenames/task names. Process-injection techniques → cmdline args or module names. Credential-access techniques → output-file names.

## Correlation rules

### Filter order

1. **`test_id` marker first** — filter by the marker in `file.name`, `process.command_line`, `process.name`, `registry.path`, `winlog.event_data.TaskName`
2. **Then time window** (see below)
3. **Then host scope** (see below)

Never rely on time alone — it's indistinguishable from background noise.

### Time window

Minimum **15 minutes** from exec start. Elastic alerts group at 15-minute boundaries; shorter windows miss delayed alerts and rule-building blocks.

### Host scope

Don't filter by exec-target host alone. Correlation fields that matter:

- `user.name` — cross-host activity under the same account
- `process.entity_id` — parent-child process trees spanning hosts
- `test_id` — always the strongest signal when injected correctly

Lateral-movement telltales surface on the DC / SIEM box, not the exec target. Credential-access telltales surface on the DC (Kerberoast, DCSync).

## Broaden-on-empty ladder

If a query returns empty or truncated, **broaden in this order** — never narrow:

1. Widen time window (15 min → 30 min → 60 min)
2. Drop the `test_id` filter (last resort — you lose correlation but catch mis-embedded markers)
3. Drop the host scope filter
4. Fall back from `.alerts-security.*` to raw event indices (see below)
5. If still empty across raw indices, classify as "no detection signal" — don't classify as "detection missed" until the ladder is exhausted

Narrowing an empty result only confirms smaller empty subsets.

## Elastic index patterns

Scope SIEM queries to the relevant indices for the technique:

| Index pattern | Contents | Use for |
|---|---|---|
| `.alerts-security.*` | Rule hits / signals | Primary detection check |
| `logs-endpoint.events.*` | EDR events (Elastic Endpoint) | Process, file, network |
| `logs-windows.sysmon_operational-*` | Sysmon events | Process trees, image loads, named pipes |
| `winlogbeat-*` | Windows event logs | Security log, PowerShell log |
| `logs-system.security-*` | Windows Security log (alternate shape) | Kerberos, account logon |

Probe which indices exist on this deployment during Phase 1 (per `refs/phase-1-gates.md`). Not all deployments have the endpoint integration — adapt.

## Baseline diff

Before any technique fires, capture a **baseline** by running the same query (without the `test_id` filter, without a time bound on "new" alerts) and storing it as `runs/{ts}/baseline.json`. Post-exec results are diff'd against this baseline, not reported as absolute counts. "5 alerts fired" is meaningless without the idle-rate comparison.

## No-SIEM fallback

If Phase 1 identified no SIEM box, use direct target inspection instead of the query path above. Same `test_id` filter applies where possible.

- **Windows:** `wevtutil qe Security /q:"*[System[TimeCreated[@SystemTime>='{iso}']]]"`, `Get-WinEvent -FilterHashtable`, Sysmon logs via `wevtutil` on `Microsoft-Windows-Sysmon/Operational`, `Get-MpThreatDetection` for Defender, process-list diffs
- **Linux:** `journalctl --since`, `auditd` logs via `ausearch`, `ps -ef` snapshots, filesystem inotify diffs

Report the same fields the SIEM path would have produced: rule/event names, severities, host, indicator that matched.

## Time-sync sanity check

Run once at Phase 1 (per `refs/phase-1-gates.md`). Compare Windows VM clock (`w32tm /query /status`) or Linux VM clock (`date -u`) to Elastic `@timestamp` on a recent event. Warn if drift exceeds 60 seconds — time skew breaks correlation and invalidates time-window filtering.
