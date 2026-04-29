# Phase 5 — Playbook Generation

Write `{ROGUE_WORKSPACE}/deployments/{deployment-name}/playbook.md` — ordered shell commands mapped to real VMs from `deployment_list_vms`. Archive any prior `playbook.md` to `playbook-history/` per `refs/workspace-layout.md`.

## Required sections per technique

- **Target** — hostname + IP from `deployment_list_vms`
- **MITRE ID + name**
- **Source** — ART YAML URL (preferred) or prose-research URL (per `refs/art-adapter.md`)
- **Snapshot point** — yes/no
- **test_id** — the run-scoped marker (see `refs/siem-query-patterns.md`)
- **Payload-scoped** — true/false (see `refs/phase-6-payload.md`)
- **Expected rule IDs** — concrete Elastic/Sigma/Sysmon rule IDs the technique should trip
- **Required tools** — binaries that must be on-disk (Rubeus, ProcDump, impacket, etc.)
- **Execute** — shell commands with `test_id` embedded, OS-correct syntax
- **Verify** — command to confirm technique landed (exit code + artifact check)
- **SIEM Query** — filter by `test_id` first, then time window (15 min min), then host scope. Pattern in `refs/siem-query-patterns.md`.
- **Cleanup** — removal commands (ART `cleanup_command` if from ART; otherwise authored)

## Canonical example

```markdown
## T1003.001 — OS Credential Dumping via ProcDump
**Target:** ws01 (Windows)
**Source:** https://github.com/redcanaryco/atomic-red-team/blob/master/atomics/T1003.001/T1003.001.yaml
**Snapshot point:** yes
**test_id:** RM-20260420-a7f3
**Payload-scoped:** false
**Expected rule IDs:** elastic:<uuid-for-lsass-access>, sigma:proc_access_win_lsass_memdump.yml, sysmon:EventID=10
**Required tools:** procdump.exe at C:\tools\procdump.exe (will upload in Phase 6 if missing)
**Elevation:** required

### Execute
"C:\tools\procdump.exe" -accepteula -ma lsass.exe "C:\temp\lsass_RM-20260420-a7f3.dmp"

### Verify
Test-Path "C:\temp\lsass_RM-20260420-a7f3.dmp"

### SIEM Query
Filter first: `file.name : "*RM-20260420-a7f3*" OR process.command_line : "*RM-20260420-a7f3*"`
Window: 15 minutes from exec start
Indices: `.alerts-security.*`, `logs-endpoint.events.*`, `logs-windows.sysmon_operational-*`

### Cleanup
del "C:\temp\lsass_RM-20260420-a7f3.dmp"
```

## Rules

- Shell syntax matches the target VM's `operatingSystem` from `deployment_list_vms`.
- Credentials for target hosts are included inline so Phase 7 can execute without re-lookup.
- Snapshot points at logical boundaries (before each technique or group).
- For ART-sourced techniques, use the adapter substitution rules in `refs/art-adapter.md`. For prose-researched techniques, mark `Source: prose-research` so the report flags lower confidence.
- Every `test_id` in a playbook is the **same** value — one test_id per run, not per technique. Generation rule in `refs/siem-query-patterns.md`.
