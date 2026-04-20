# Atomic Red Team Adapter

Atomic Red Team provides executable YAML atomics with literal shell commands. When a technique has an ART atomic, prefer it over prose research — the output is already machine-executable.

## Fetch URL pattern

```
https://raw.githubusercontent.com/redcanaryco/atomic-red-team/master/atomics/{MITRE-ID}/{MITRE-ID}.yaml
```

Example: `https://raw.githubusercontent.com/redcanaryco/atomic-red-team/master/atomics/T1003.001/T1003.001.yaml`

Use `WebFetch` to pull the YAML. If it 404s, the technique has no ART atomic — fall back to the secondary sources in `refs/phase-3-research.md`.

## YAML structure

An ART file contains one technique (matching the filename) with multiple `atomic_tests`. Each test has:

```yaml
attack_technique: T1003.001
display_name: OS Credential Dumping - LSASS Memory

atomic_tests:
- name: Dump LSASS.exe Memory using ProcDump
  auto_generated_guid: ...
  description: The memory of lsass.exe is often dumped for offline credential extraction...
  supported_platforms:
    - windows
  input_arguments:
    output_file:
      description: Path where dump will be written
      type: path
      default: '%tmp%\lsass_dump.dmp'
    procdump_exe:
      description: ...
      type: path
      default: '...'
  dependency_executor_name: powershell
  dependencies:
    - description: ProcDump tool must exist on disk
      prereq_command: |
        if (Test-Path "#{procdump_exe}") {exit 0} else {exit 1}
      get_prereq_command: |
        Invoke-WebRequest "https://download.sysinternals.com/files/Procdump.zip" -OutFile $env:TEMP\Procdump.zip
  executor:
    name: command_prompt
    elevation_required: true
    command: |
      "#{procdump_exe}" -accepteula -ma lsass.exe "#{output_file}"
    cleanup_command: |
      del "#{output_file}" >nul 2> nul
```

## Fields that matter

| Field | What it does |
|---|---|
| `input_arguments.{name}.default` | The default value you substitute when generating the playbook command |
| `dependencies[].prereq_command` | Probe command — run this BEFORE the technique to check if prereqs are met |
| `dependencies[].get_prereq_command` | Install command — skip this (we don't auto-install tooling) |
| `executor.name` | `command_prompt` / `powershell` / `sh` / `bash` — picks which shell to invoke on the target |
| `executor.elevation_required` | If true, the technique needs an elevated session — note this in the playbook |
| `executor.command` | The literal command to run (after `#{arg}` substitution) |
| `executor.cleanup_command` | Run after observation to restore state (in addition to snapshot revert) |

## Substitution rule

Replace every `#{arg_name}` in `command` and `cleanup_command` with the corresponding `input_arguments.{arg_name}.default`. If the user has a reason to override an argument (e.g., custom output path for `test_id` injection), substitute their value instead.

## Worked example — T1003.001

1. Fetch the YAML (URL above).
2. Select the first atomic test (`Dump LSASS.exe Memory using ProcDump`).
3. Check prereq: run `Test-Path "C:\temp\procdump.exe"` (or wherever `procdump_exe` default points). If missing → either upload ProcDump from the user's tools/ dir or skip with a note in the report.
4. Substitute `#{output_file}` with a test_id-tagged path: `C:\temp\lsass_RM-20260420-a7f3.dmp`.
5. Build the playbook entry:

```markdown
## T1003.001 — OS Credential Dumping via ProcDump
**Target:** ws01 (Windows)
**test_id:** RM-20260420-a7f3
**Payload-scoped:** false
**Required tools:** procdump.exe (must be on disk at C:\tools\procdump.exe)
**Elevation:** required

### Execute
"C:\tools\procdump.exe" -accepteula -ma lsass.exe "C:\temp\lsass_RM-20260420-a7f3.dmp"

### Verify
Test-Path "C:\temp\lsass_RM-20260420-a7f3.dmp"

### SIEM Query
Filter: `file.name : "*RM-20260420-a7f3*"` OR `process.command_line : "*lsass*RM-20260420-a7f3*"`
Indices: `.alerts-security.*`, `logs-endpoint.events.*`, `logs-windows.sysmon_operational-*`

### Cleanup
del "C:\temp\lsass_RM-20260420-a7f3.dmp"
```

## Fallback to prose research

If a technique has no ART atomic (the fetch 404s), fall back to the secondary sources in `refs/phase-3-research.md`. Mark the technique in the playbook with `source: prose-research` so reviewers know the command wasn't extracted from an executable atomic.

## Multi-atomic techniques

Some ART files have 5+ atomic tests for the same technique (different sub-variations). When the technique matters to the user, fetch ALL atomics and present them as sub-picks. Otherwise pick the first platform-matching atomic that has no external-install dependency.
