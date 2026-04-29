# Validation: Infrastructure — Reference Doc

> **For:** architect-implementor Phase E; architect-freeform on-demand validation
> **Do not add:** persona blocks, trigger phrases, user interaction framing

## Purpose

A read-only technical audit of scenario infrastructure. Verify correctness, report findings, never mutate canvas state.

## Core Rules

1. **Run every check in the scope.** If the scope defines 6 check categories, all 6 run. Skipping a category skips the class of bugs it catches.
2. **Query every machine.** Call `architect_vlan_get` for every VLAN and inspect every machine — sampling is not validation. A credential mismatch on machine 9 of 12 is still a broken lab.
3. **Severity classifications are final.** Reclassification requires new confirming tool data, not user sentiment.
4. **PASS requires confirming tool output.** Findings without confirming tool output are classified WARN with the `UNVERIFIED` tag (see Finding Classifications below). "Should be fine" is not evidence.
5. **Every finding gets an error code** from the tables below.
6. **Report "Ready for implementation: YES" only when every finding is PASS or WARN+UNVERIFIED.** A single FAIL (or a non-UNVERIFIED WARN) is disqualifying.
7. **Every finding cites evidence** — the tool call, the data point, expected vs. actual values.

## Finding Classifications

Findings take one of three classifications:

- **PASS** — tool output confirms the check succeeded.
- **WARN** — either a soft issue that can be safely ignored, OR data was unavailable to run the check (tag these as `WARN (UNVERIFIED)`). The Ready verdict treats non-UNVERIFIED WARNs as blocking.
- **FAIL** — tool output confirms the check failed. Always blocking.

Tool-call failures (e.g., `architect_machine_get` returns an error for one machine) produce a `WARN (UNVERIFIED)` finding for the checks that depended on that data, not a silent skip.

## Validation Scopes

| Scope | Purpose | When to Use |
|---|---|---|
| `pre_deployment` | Credential matching, dependencies, IP conflicts, plugin params, naming, orphans, budget | After building, before deploying |
| `post_deployment` | Verify deployed state matches schema | After deployment completes |
| `full` | Run both pre and post deployment checks | Full audit pass |
| `exploit_path_plan` | Privilege chain, credential flow, technique availability | After exploit path is planned |
| `exploit_path_post` | Reachability, trust paths, deployed state | After exploit path is implemented |

## Infrastructure Checks (pre_deployment, post_deployment, full)

### 1. Producer/Consumer Consistency
Credentials defined on DCs (producers) match credentials used on workstations/servers (consumers). OU paths referenced in domain-join plugins exist in DC OU definitions. Domain names match across all machines in the same domain. Admin passwords on domain-join plugins match the DC's configured admin password.

### 2. Plugin Completeness
All required plugin parameters are set. Parameter values match expected types/formats. No orphan machines exist without any plugins. To audit all configured parameters across machines in bulk, call `discover_tools(search: "list params")`.

### 3. AD Structure Consistency
DC plugin params (CreateUsers, CreateOUs, CreateGroups) are internally consistent. Every user referenced in CreateUsers has a valid OU path in CreateOUs, and group memberships reference groups defined in CreateGroups. VLAN AD blueprint matches DC plugin params — every userArchetype, securityGroup, and serviceAccount in the blueprint has a corresponding entry on the DC. Additionally, verify the total user count across every DC's CreateUsers matches `constraints.maxUsers` from `architect_canvas_get_context` within +/-5% (per [shared-rules.md § Department Requirements — Headcount Math](../../refs/shared-rules.md#headcount-math-critical)); drift produces `HEADCOUNT_DRIFT`.

### 4. Cross-Domain Connectivity
VLANs hosting domains with trust relationships have VLAN connections configured. Connectivity direction matches trust type (bidirectional trust needs two-way VLAN connectivity).

### 5. Blueprint User Assignments & Profile Plugins
Machines with user assignments require corresponding plugins to actually create the user profiles at deploy time — the DB assignment is metadata only and does not trigger any Ansible play.

**Active user (isActivelyLoggedIn: true):**
The machine must have an auto-logon plugin (e.g., "Auto Log User Into Machine") with `username` and `password` params matching the assigned user's `samAccountName` and `password`. If this plugin is missing, the assigned user will never actually be logged in on the machine. Produces `MISSING_AUTOLOGON_PLUGIN`.

**Past profiles (isActivelyLoggedIn: false):**
Each past-profile assignment represents a user whose Windows profile directory (`C:\Users\{username}`) must exist on the machine for realism (abandoned credentials, orphaned home directories, stale tokens). Creating a profile requires a plugin that logs in as that user at least once (currently the same auto-logon plugin, run per user). The machine must have one profile-seeding plugin instance per past-profile assignment with matching credentials. Missing instances produce `MISSING_PROFILE_SEED_PLUGIN`.

**User existence on DC:**
Every assigned user's `samAccountName` must exist in the `CreateUsers` param of the domain controller for the domain that machine is joined to. If the machine's domain has a trust relationship with another domain, the user may legitimately exist on the trusted domain's DC instead — check both before flagging. Produces `UNRESOLVED_ASSIGNED_USER`.

### 6. Orphaned Machines
Every machine has at least one plugin and a clear purpose in the scenario. Machines with no plugins and no role produce `ORPHANED_MACHINE`.

### 7. IP Conflicts
No two machines share an IP address within the same VLAN. Compare IP assignments across `architect_machine_get` results per VLAN. Duplicates produce `IP_CONFLICT`.

### 8. Naming Consistency
Hostnames and domain names follow an established pattern across a domain (servers and workstations share a base pattern; only the type code differs). Outliers produce `NAMING_INCONSISTENCY`.

### 9. Plugin Dependencies
Every assigned plugin's prerequisite plugins exist on the same machine. For example, a domain-join plugin requires the base OS plugin; a database plugin requires the DB engine plugin. Missing prerequisites produce `MISSING_DEPENDENCY`.

### 10. Vulnerability Coverage
Call `discover_tools(search: "vulnerability state")` to audit vulnerability plugin distribution. Confirm every VLAN that should have attack surface has at least one vulnerability plugin. Proportional spread and pedagogical balance belong to `validate-realism` — this check is presence/absence only.

### 11. Resource Budget
Call `architect_canvas_get_budget` or read `resourceBudget` from `architect_canvas_get_overview`. Verify all three dimensions (RAM, CPU, machines) are within quotas. Overages produce `BUDGET_EXCEEDED`.

### 12. Post-Deployment State Match (post_deployment and full scopes only)
After deployment, verify the deployed state matches the schema. Call `architect_deploy_list_status` to enumerate deployed machines and their plugins; compare to the draft schema. Missing deployments or drift produce `DEPLOY_STATE_MISMATCH`.

### 13. Plugin Parameter User Resolution
Any plugin parameter that references a username, samAccountName, or login credential must resolve to a real user on the appropriate domain controller. This catches typos, misspellings, and references to users that were never created.

**Efficient strategy:** For each domain, first collect the full user list from the DC's `CreateUsers` param (this may contain 200+ users in a CSV). Then sweep all machines in that domain, extracting usernames from every plugin parameter (auto-logon `username`, domain-join credentials, service account names, file-ownership references, etc.). Batch-compare against the DC user list rather than checking one machine at a time.

**Cross-domain trusts:** A plugin parameter may reference a user from a trusted domain (e.g., `YOURCOMPANY\john.smith` on a machine in `YOURCOMPANY.LOCAL` referencing a user in `YOURCOMPANYPARTNER.LOCAL`). Before flagging `UNRESOLVED_PLUGIN_USER`, check the DCs of all domains that have a trust relationship with the machine's domain.

**Credential matching:** When both a username and password appear in plugin params, verify the password matches what the DC has for that user. Password mismatches between plugin params and the DC's `CreateUsers` definition are a common cause of failed builds. Produces `PLUGIN_CREDENTIAL_MISMATCH`.

**Soft finding tone:** These findings should be presented as potential gaps rather than definitive failures, since the validator cannot see custom scripting or out-of-band provisioning. Frame as: "These usernames could not be found in the DC's CreateUsers — if you've added them via additional scripting that the validator can't see, this may be safe to ignore. Otherwise, double-check for typos or missing user definitions."

Unresolvable usernames produce `UNRESOLVED_PLUGIN_USER` (WARN, not FAIL) due to the possibility of external provisioning.

### 14. Plugin Parameter IP & Port Cross-Reference
Plugin parameters frequently contain hardcoded IPs and ports that reference other machines in the scenario (e.g., a Windows workstation plugin connecting to an FTP server at `10.0.1.50:21`). These references must resolve to actual machines with matching static IPs and the expected service.

**Strategy:** Scan all plugin parameters across all machines for values that look like IP addresses (with or without ports). For each discovered IP reference:

1. **Resolve the IP to a machine** — find the machine in the canvas whose static IP matches. If no machine has that IP, produce `UNRESOLVED_PARAM_IP`.
2. **Verify the target has a static IP** — if the referenced machine uses DHCP or has no explicit static IP configuration, the hardcoded IP will break when DHCP assigns a different address. Produces `DYNAMIC_IP_HARDCODED`.
3. **Verify the service exists on the target** — if the reference includes a port or the context implies a service (FTP, SSH, HTTP, SMB, etc.), check that the target machine has a plugin that provisions that service. For example, if machine A's plugin param says `ftp_server=10.0.1.50`, then the machine at `10.0.1.50` should have an FTP-related plugin (bash script, role plugin, etc.). Missing service produces `MISSING_REFERENCED_SERVICE`.
4. **Verify VLAN reachability** — the source and target machines must be on the same VLAN or connected VLANs. If not, produce `UNREACHABLE_PARAM_IP`.

**Scope:** This check is best-effort. Plugin params are freeform text and may contain IPs in non-obvious formats (embedded in scripts, config file contents, CSV data). The validator should grep param values for IPv4 patterns (`\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}`) and flag what it can find. Unrecognized references are acceptable to miss — this is a safety net, not an exhaustive parser.

**Soft finding tone:** Like Check 13, frame findings as potential gaps: "This IP in plugin params doesn't match any machine's static IP — if this is configured via custom scripting or refers to an external resource, it may be safe to ignore."

### 15. Firewall & Network Flow Consistency
VLAN connections carry full firewall rule sets (ordered rules with ports, protocols, source/destination IPs, allow/deny states, and a default policy of BLOCK_ALL or ALLOW_ALL). This check validates that the firewall configuration actually permits the traffic that the scenario's plugins and services require.

**Strategy:** For each VLAN connection, read the firewall rules and default policy. Then evaluate whether the services running on machines in those VLANs can communicate as intended.

**Required service flows:**
Infer required network flows from the plugins and services deployed on machines. Common examples:

| Service / Plugin | Required Ports | Direction |
|---|---|---|
| Domain join | 88 (Kerberos), 389/636 (LDAP), 445 (SMB), 53 (DNS) | Workstation → DC |
| File share access | 445 (SMB) | Client → File server |
| RDP access | 3389 | Client → Target |
| FTP | 21 (control), 20 or passive range | Client → FTP server |
| Web / HTTP services | 80, 443 | Client → Web server |
| Elastic agent enrollment | 8220 (Fleet), 9200 (ES) | Agent → Elastic server |
| Syslog forwarding | 514 (UDP), 1514 | Source → Log collector |
| WinRM / Ansible | 5985, 5986 | Controller → Target |

This table is non-exhaustive — the validator should infer required ports from any plugin that implies network communication.

**Checks:**
1. **Service flow permitted** — For each cross-VLAN service dependency, verify the firewall rules (evaluated in sort order, with the default policy as fallback) permit the required ports and protocol. A blocked required flow produces `FIREWALL_BLOCKS_REQUIRED_FLOW`.
2. **Default policy sanity** — If a connection's default policy is `ALLOW_ALL` but the scenario includes security infrastructure (SIEM, IDS, segmentation), flag as `PERMISSIVE_DEFAULT_POLICY` (WARN). Real segmented networks use BLOCK_ALL with explicit allows.
3. **Stale or contradictory rules** — Flag rules that are shadowed by a higher-priority rule (same port/protocol, opposite action at a lower sort order). Produces `SHADOWED_FIREWALL_RULE` (WARN).
4. **Missing firewall rules on connection** — If two VLANs are connected but have zero firewall rules and a BLOCK_ALL default, all cross-VLAN traffic is blocked. If machines on those VLANs have cross-VLAN dependencies, produce `CONNECTION_BLOCKS_ALL_TRAFFIC`.

**Soft finding tone for permissive policies:** ALLOW_ALL may be intentional for flat lab networks or early-stage builds. Frame as: "This connection uses ALLOW_ALL — if segmentation is intentional for this scenario, consider adding explicit firewall rules."

### 16. Local Group Membership Enforcement
When a domain defines granular administrative groups in its DC's `CreateGroups` param (e.g., "Workstation Admins", "File Server Admins", "SQL Server Admins" — any group whose name or description implies scoped local admin rights rather than blanket domain-wide admin), those groups are only meaningful if machines actually assign them to local admin via a local group membership plugin.

**Why this matters:** Without explicit local group assignments, Windows defaults to giving Domain Admins local administrator access on every domain-joined machine. If the scenario went to the trouble of creating tight, role-specific admin groups, but no machine uses them, the groups are decorative — every Domain Admin still has full local admin everywhere, defeating the segmentation.

**Strategy:**
1. **Identify scoped admin groups** — Read each DC's `CreateGroups` param. Flag any group whose name or description suggests scoped administrative rights (keywords: "admin", "admins", "administrators", "elevated", "local admin", combined with a scope like "workstation", "server", "file", "SQL", "database", "HR", "finance", etc.). Exclude universal groups like "Domain Admins", "Enterprise Admins", and "Schema Admins" — those are expected to be domain-wide.
2. **Check machines for local group plugins** — For each machine in the domain, check whether it has a plugin that configures local group membership (e.g., a plugin that adds specific AD groups to the machine's local Administrators group). The plugin name or params should reference local group assignment, restricted groups, or Group Policy Preferences for local admin.
3. **Match groups to machines** — Verify that the scoped admin groups are actually being applied to appropriate machines. "Workstation Admins" should appear on workstations, "File Server Admins" on file servers, etc. A scoped admin group that exists on the DC but is never referenced in any machine's local group plugin produces `UNUSED_SCOPED_ADMIN_GROUP`.
4. **Check for missing local group plugins entirely** — If a domain has 2+ scoped admin groups but zero machines in that domain have any local group membership plugin, produce `NO_LOCAL_GROUP_ENFORCEMENT` (FAIL). This means the entire local admin segmentation is unenforced.

**Soft finding tone for partial coverage:** If some machines have local group plugins but others don't, frame as: "These machines have no local group membership plugin — Domain Admins will have local admin by default. If this is intentional for these specific machines, this may be acceptable."

## Exploit Path Checks (exploit_path_plan, exploit_path_post)

### 1. Privilege Chain
Each hop's outputPrivilege meets or exceeds the next hop's inputPrivilege. Domain context matters: `domain_admin` in CORP.LOCAL is NOT the same as `domain_admin` in OTHER.LOCAL.

### 2. Credential Flow
Credentials are created before they are used (createdInHop < usageHop). Each credentialRef is unique. All credentialUsage references point to a valid earlier discovery.

### 3. Technique Availability
Each abstract technique maps to at least one plugin in the catalog. Plugin OS compatibility matches the target machine.

### 4. Network Reachability
Source machine can reach target machine for each hop. Cross-VLAN hops require a VLAN connection. If topology data is unavailable, mark as UNVERIFIED warning (not FAIL).

### 5. Domain Trust Paths
Cross-domain hops have valid trust relationships. Trust type supports the traversal technique (e.g., SID history needs parent-child trust). Trust direction is correct.

### 6. Difficulty Compliance
Techniques match the specified difficulty level. The validator queries the catalog to verify technique-to-difficulty mapping.

## Infrastructure Error Codes

| Code | Meaning | Produced By |
|---|---|---|
| `CREDENTIAL_MISMATCH` | Password/username does not match between producer and consumer | Check 1 |
| `MISSING_PLUGIN_PARAMS` | Required parameter not configured | Check 2 |
| `ORPHANED_MACHINE` | Machine exists but has no plugins or purpose | Check 6 |
| `IP_CONFLICT` | Duplicate IP addresses within a VLAN | Check 7 |
| `NAMING_INCONSISTENCY` | Hostname or domain name does not follow established pattern | Check 8 |
| `MISSING_DEPENDENCY` | Plugin prerequisite not present on the machine | Check 9 |
| `HEADCOUNT_DRIFT` | DC CreateUsers totals drift from `constraints.maxUsers` by more than +/-5% | Check 3 |
| `BUDGET_EXCEEDED` | Total RAM, CPU, or machine count exceeds user quota | Check 11 |
| `DEPLOY_STATE_MISMATCH` | Deployed state drifts from the draft schema | Check 12 |
| `MISSING_AUTOLOGON_PLUGIN` | Machine has an actively-logged-in user assignment but no auto-logon plugin with matching credentials | Check 5 |
| `MISSING_PROFILE_SEED_PLUGIN` | Machine has a past-profile user assignment but no plugin to create that user's profile | Check 5 |
| `UNRESOLVED_ASSIGNED_USER` | Assigned user's samAccountName not found on the machine's DC (or trusted domain DCs) | Check 5 |
| `UNRESOLVED_PLUGIN_USER` | Username in a plugin parameter not found on any reachable DC (WARN — may be externally provisioned) | Check 13 |
| `PLUGIN_CREDENTIAL_MISMATCH` | Password in plugin params does not match the DC's CreateUsers definition for that user | Check 13 |
| `UNRESOLVED_PARAM_IP` | IP address in plugin params does not match any machine's static IP | Check 14 |
| `DYNAMIC_IP_HARDCODED` | Plugin param hardcodes an IP for a machine that has no static IP (DHCP will break it) | Check 14 |
| `MISSING_REFERENCED_SERVICE` | Target machine at referenced IP has no plugin provisioning the expected service | Check 14 |
| `UNREACHABLE_PARAM_IP` | Source machine cannot reach referenced IP (no VLAN connectivity) | Check 14 |
| `FIREWALL_BLOCKS_REQUIRED_FLOW` | Firewall rules block a port/protocol required by a deployed service | Check 15 |
| `PERMISSIVE_DEFAULT_POLICY` | ALLOW_ALL default on a connection in a segmented/security-focused scenario | Check 15 |
| `SHADOWED_FIREWALL_RULE` | A rule is fully shadowed by a higher-priority rule with the opposite action | Check 15 |
| `CONNECTION_BLOCKS_ALL_TRAFFIC` | Connected VLANs have BLOCK_ALL default + zero rules, but machines need cross-VLAN traffic | Check 15 |
| `UNUSED_SCOPED_ADMIN_GROUP` | A scoped admin group exists on the DC but is never referenced in any machine's local group membership plugin | Check 16 |
| `NO_LOCAL_GROUP_ENFORCEMENT` | Domain has 2+ scoped admin groups but zero machines have local group membership plugins (segmentation is decorative) | Check 16 |

## Exploit Path Error Codes

| Code | Meaning |
|---|---|
| `INVALID_PRIVILEGE_CHAIN` | Privilege level does not flow correctly between hops |
| `CREDENTIAL_FLOW_ERROR` | Credential used before it was discovered |
| `TECHNIQUE_UNAVAILABLE` | Technique not in catalog or incompatible OS |
| `UNREACHABLE_HOP` | Source cannot reach target (network/VLAN issue) |
| `INVALID_TRUST_PATH` | Trust relationship does not support the traversal |
| `DIFFICULTY_VIOLATION` | Technique does not match the requested difficulty |
| `MISSING_EXPLOIT_PATH_PLAN` | No exploit path plan found to validate |

## Validation Checklist

1. **Determine validation scope** — infer from context or check the phase specification. If ambiguous, the implementor must clarify which scope to run.
2. **Read canvas state** — `architect_canvas_get_overview` for the full picture, `architect_canvas_get_completeness` for a summary of what is missing. For pre-deployment scopes, also call `architect_canvas_get_projected_state` to preview the full draft state.
3. **Read machine details** — `architect_vlan_get` for each VLAN to inspect machines and plugins. When reading 3+ machines, `discover_tools(search: "batch")` for batch machine reads. For exploit path scopes, read `exploit.yml` from the scenario directory to inspect hops and credentials.
4. **Collect DC user lists first** — For each domain, read the DC's `CreateUsers` param to build a complete user roster before checking workstations. This avoids redundant DC lookups when validating user references across many machines. Also note trust relationships so cross-domain user references can be resolved.
5. **Build IP-to-machine map** — While reading machine details, build a lookup of static IP → machine. This map powers Check 14 (IP cross-referencing) without redundant queries. Note which machines lack static IPs.
6. **Check what changed** — `discover_tools(search: "diff")` to see what changed since the last apply.
7. **Run scope-appropriate checks** — execute every check listed above for the scope. Classify each finding as PASS, WARN, or FAIL with a specific error code.
8. **Self-verify coverage** — count (a) machines queried vs machines existing, (b) check categories run vs categories the scope defines, (c) machines in results vs total. Any count mismatch goes back to fill the gap.
9. **Present results** — FAILs first, then WARNs, then PASS counts. Every finding includes its error code and affected entity.

## Pre-Flight Quick Check

Before running a full scope, `architect_canvas_get_completeness` alone returns a summary of what is missing, incomplete, or unprocessed. This is a pre-flight sanity check, not a substitute for a scoped audit — the full check set still runs afterward.

## Result Format

```
Scope: pre_deployment
Machines validated: 9
Results: 14 PASS | 3 WARN | 1 FAIL

FAIL:
  - CREDENTIAL_MISMATCH on DC02: admin password differs from DC01

WARN:
  - NAMING_INCONSISTENCY on WS03: hostname pattern breaks convention
  - MISSING_PLUGIN_PARAMS on SRV01: optional monitoring param not set
  - MISSING_PLUGIN_PARAMS on SRV02: optional monitoring param not set
```

For exploit path validation:

```
Scope: exploit_path_plan
Path hops: 5
Results: 8 PASS | 1 WARN | 0 FAIL
Ready for implementation: YES

WARN:
  - UNREACHABLE_HOP (UNVERIFIED) on hop 3: topology data unavailable
```

## Constraints

- **Read-only.** Tool calls are limited to `architect_*_get_*`, `architect_*_list_*`, `architect_canvas_get_completeness`, `architect_canvas_get_context`, `architect_forest_get_events`, and catalog read tools. No mutations.
- Use draft nodeIds (e.g., `vlan-corp`, `machine-corp-dc01`) — canvas UUIDs fail.
- Every finding carries an error code and a classification (PASS, WARN, or FAIL — see Finding Classifications above).
- `architect_canvas_get_overview` failure blocks everything — report the failure and stop.
- Individual machine query failures produce `WARN (UNVERIFIED)` findings for the affected checks; the audit continues with the remaining machines.
- Exploit path scopes with no `exploit.yml` in the scenario directory (or an empty `paths:` block) report `MISSING_EXPLOIT_PATH_PLAN` and stop.
