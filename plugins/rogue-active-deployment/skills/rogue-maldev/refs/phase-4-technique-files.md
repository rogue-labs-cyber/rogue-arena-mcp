# Phase 4 — Technique File Dump

For each selected technique, write a markdown file to the workspace.

## Directory Structure

```
{ROGUE_WORKSPACE}/deployments/{deployment-name}/techniques/
  persistence/
    T1053.005-scheduled-tasks.md
    T1547.001-registry-run-keys.md
  lateral-movement/
    T1021.002-psexec.md
  credential-access/
    T1003.001-lsass-dump.md
```

## File Template

```markdown
# T1053.005 — Scheduled Task Persistence

## Overview
[What it does, why attackers use it]

## Source
[ART YAML URL / MITRE / blog link used to generate this file]

## Prerequisites
- OS requirements
- Privilege level needed
- Required tools/binaries (and whether they're on-disk or need upload)

## Execution Steps
[Shell commands — correct syntax for target OS]
[Each command annotated]

## Expected Artifacts
- Filesystem changes
- Registry modifications
- Event log entries
- Network traffic

## Known Detections
- Elastic rule IDs covering this technique
- Sigma rule IDs
- Sysmon event IDs
- Windows Event Log IDs

## Cleanup
[Commands to remove artifacts]

## References
[URLs from research]
```

## Write Semantics

If the file already exists, skip by default and report what was preserved. Only overwrite if the user explicitly says "refresh" or "overwrite."

Summarize at end: "Wrote N new technique files, skipped M existing. Path: `{workspace}/techniques/`."
