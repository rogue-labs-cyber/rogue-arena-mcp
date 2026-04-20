# Debug Deploy — Reference Doc

> **For:** architect-debug-deploy skill
> **Source:** Migrated from skills/debug-deploy/SKILL.md
> **Do not add:** persona blocks, trigger phrases, user interaction framing

## Purpose

The investigator diagnoses deployment failures. Given a deployment ID, the investigator systematically traces the root cause through logs, ansible code, and machine state, then presents findings with a suggested fix.

## Prerequisite

A **deployment ID** is required before investigation can begin. The investigation is always scoped to a specific deployment.

## Investigation Checklist

Complete these steps in order:

1. **Get deployment ID** — Confirm a deployment ID has been provided. If specific machines or error messages are mentioned, note those for targeted investigation.
2. **Discover deploy tools** — Call `discover_tools(category: "ROGUE_ARCHITECT_BUILDER", subcategory: "deploy")` to load all deploy monitoring tools. These are not available by default.
3. **Get deployment overview** — Call `architect_deploy_list_status` first to get the big picture: overall deployment status, per-machine status, completed/failed/in-progress counts. This is always the starting point.
4. **Triage failures** — Call `architect_deploy_list_failed` to get detailed error context for all failed machines: failed plugin names, error messages, and execution order. Use this to prioritize which machines to deep-dive into.
5. **Deep-dive into specific machines** — Call `architect_deploy_get_machine_details` for each machine of interest. Find the errored plugin and its `ymlId`. If specific failed machine IDs were provided, start with those.
6. **Search logs for errors** — Call `architect_deploy_log_query_raw` with `includeStructure: true`. Start with pattern 1 from the Ansible Error Search Patterns section below; broaden only if pattern 1 returns no matches. If specific error messages were provided, search for those patterns too.
7. **Understand what the plugin does** — Call `architect_deploy_get_ansible_code` using the `ymlId` from machine details. Also call `architect_plugin_catalog_get_example` to compare against a working configuration.
8. **Check configured parameters** — Call `architect_assigned_plugin_get` to see the exact params configured on the failing plugin. Call `list_applied_plugins` to check plugin ordering on the machine.
9. **Check machine and network context** — Call `architect_machine_get` for IP, template, and gateway config. Call `architect_vlan_get` for DNS forwarding, gateway, and parent domain. Call `discover_tools(search: "machine configs")` to check machine-level configuration if the failure is infrastructure-level. To inspect deployed file artifacts on a failed machine, call `discover_tools(search: "file_operations")` to access `architect_files_get`.
10. **Check cross-machine dependencies** — If the failure involves domain joins, DNS, or network connectivity, use `architect_machine_list` to find DCs or other machines this one depends on. Check if dependency machines finished building via `architect_deploy_list_status`.
11. **Live VM debugging** — If logs alone don't explain the failure, call `discover_tools(search: "exec vm command")` to run shell commands directly on the provisioning VM. Check service status, file existence, registry keys, or network connectivity from inside the failing machine.
12. **Check remaining work** — Call `architect_deploy_list_remaining` to see which Ansible plays are still pending across machines. Useful for estimating whether a partial deployment is worth continuing or should be restarted.
13. **Present findings** — Report per-machine: root cause, error pattern found, wrong configuration, suggested fix, and whether redeployment is required.

## Output Format

Present findings per machine:

- **machineId** — Which machine failed
- **rootCause** — What actually went wrong (the real cause, not the symptom)
- **errorPattern** — The error text found in logs
- **wrongConfig** — Which parameter or configuration is incorrect
- **suggestedFix** — Specific change to make (parameter value, plugin reorder, template change)
- **requiresRedeployment** — Whether the fix needs a full redeploy or can be applied in-place

## Investigation Discipline

Three load-bearing rules that protect every diagnosis:

1. **Root cause, not symptom.** Error messages point to symptoms; the cause often sits upstream (see Silent PowerShell Exe Failures below). Stated root causes trace a causal line from cause to error message.
2. **Read the ansible code.** `architect_deploy_get_ansible_code` for the failing plugin runs before the diagnosis is final. Diagnoses from log output alone miss what the plugin actually executes.
3. **Every failed machine gets reviewed.** Shared misconfigurations (passwords, DNS forwarders, VLAN settings) cause correlated failures — `architect_deploy_list_failed` enumerates them all.

## Error Handling

- Check every tool result for `success` before proceeding.
- `architect_deploy_get_machine_details` failure for one machine notes the gap and continues with the rest.
- Empty log query results: broaden the pattern (`error`, `failed` case-insensitive) or use `tailLines` to see the last N lines without pattern matching. `installStatus: errored` in machine details confirms failure even when logs are empty.
- If `architect_deploy_log_query_raw` returns zero results across every broadening attempt, diagnose from machine state alone and note the limitation in the finding.

---

## Domain Knowledge

### Silent PowerShell Exe Failures

This is the **#1 deployment failure pattern**. `$ErrorActionPreference = 'Stop'` does not catch external executable failures.

When PowerShell calls an `.exe`, a non-zero exit code does not throw. The script continues, failing on the next line that depends on the exe having succeeded.

#### The Check-Do-Use Anti-Pattern

```powershell
# 1. CHECK if thing exists
$service = Get-Service -Name 'MyService' -ErrorAction SilentlyContinue
if (-not $service) {
    # 2. DO action to create it (can fail silently!)
    some-installer.exe install --args
}
# 3. USE the thing (fails because step 2 failed silently)
Start-Service -Name 'MyService'  # Error: 'Cannot find service MyService'
```

#### How to Identify

1. The error message points to a **symptom** (e.g., "service not found"), not a cause
2. The failing line is trying to USE something that should have been created earlier
3. There is a call to an external `.exe` between the check and the use
4. The script has `$ErrorActionPreference = 'Stop'` but it did not prevent the failure

#### Detection Steps

1. Look for `.exe` calls in the script before the failing line
2. Check if the exe is actually present at the specified path (file copy may have failed earlier)
3. Check if the exe requires dependencies (DLLs, runtimes, drivers like viosock)
4. The exe's output/error may appear in `host_out` or `host_err` in the ansible JSON output

#### Example

```
Error: Start-Service : Cannot find any service with service name 'RogueArenaOfflimitsAgent'
Script:
  c:\scripts\file-syncer-agent.exe install --port 5000  # <-- ACTUAL FAILURE (silent)
  Start-Service -Name 'RogueArenaOfflimitsAgent'         # <-- REPORTED FAILURE

Root cause: file-syncer-agent.exe install failed without throwing an exception.
The service was never registered, so Start-Service fails.
```

### LIVEDEPLOY Tools

Discovered via `discover_tools(category: "ROGUE_ARCHITECT_BUILDER", subcategory: "deploy")`. Investigation priority:

1. `architect_deploy_list_status` — big picture first
2. `architect_deploy_list_failed` — triage all errored machines at once
3. `architect_deploy_get_machine_details` — deep-dive per machine (batches up to 10 via `machineNicknames`)
4. `architect_deploy_log_query_raw` — grep logs (see Ansible Error Search Patterns below for the canonical pattern ladder)
5. `architect_deploy_get_ansible_code` — read the plugin source via `ymlId`; the raw log often contains the embedded PowerShell script in `module_args.script`
6. `architect_deploy_list_remaining` — find stuck builds, estimate remaining work

### Common Failure Patterns

**Credential mismatch** — Domain join fails because DC credentials do not match. Check DomainJoin plugin's `dcAdminPassword` against the DC setup plugin's admin password. Log pattern: `The specified network password is not correct`.

**Network/DNS errors** — Machine cannot reach DC due to VLAN isolation or wrong gateway. Check `dnsForwarder` field on the VLAN and verify the DNS forwarding chain to the parent domain's DC. Log pattern: `No route to host` or `could not resolve domain`.

**Template missing features** — Plugin requires a feature not present in the base template (e.g., .NET Framework version, Windows feature, wrong OS).

**Ordering errors** — Workstation tried to join domain before DC finished provisioning. Check if dependency machine's build completed via `architect_deploy_get_machine_details`.

**Resource constraints** — Insufficient RAM, CPU, or disk for the plugin's requirements.

### Windows Ansible Patterns

See [shared-rules.md - Windows Ansible Failure Patterns](../../refs/shared-rules.md#windows-ansible-failure-patterns).

### Ansible Error Search Patterns

Search logs with these patterns in priority order. Combine with `|` for OR matching.

1. **Critical failures**: `fatal:|FAILED!|unreachable`
2. **Error messages**: `msg:|stderr:`
3. **Exception traces**: `Exception|Traceback|Error:`
4. **Recap summary**: `PLAY RECAP`
5. **Service failures**: `Cannot find any service|service not found|Access denied`

Start with pattern 1. If it returns results, dig into those before broadening.
