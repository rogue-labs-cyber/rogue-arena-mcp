# Validation: Infrastructure — Reference Doc

> **For:** architect-final-validate skill — infrastructure scope of the final audit
> **Do not add:** persona blocks, trigger phrases, user interaction framing

## Purpose

A read-only technical audit of scenario infrastructure. Verify correctness, report findings, never mutate canvas state.

## Core Rules

1. **Run every check.** Skipping a check skips the class of bugs it catches.
2. **Query every entity.** Call `architect_vlan_get` for every VLAN, `architect_machine_get` for every machine — sampling is not validation. A credential mismatch on machine 9 of 12 is still a broken lab.
3. **Severity classifications are final.** Reclassification requires new confirming tool data, not user sentiment.
4. **PASS requires confirming tool output.** Findings without confirming tool output are classified WARN with the `UNVERIFIED` tag. "Should be fine" is not evidence.
5. **Every finding gets an error code** from the tables below.
6. **Verdict (owned by SKILL.md):** the orchestrator computes the audit verdict from the consolidated findings. **Only FAILs block.** WARNs (including `UNVERIFIED`) are informational — surfaced in the report, not blocking. This ref produces findings; SKILL.md decides go/no-go.
7. **Every finding cites evidence** — the tool call, the data point, expected vs. actual values.

## Finding Classifications

Findings take one of three classifications:

- **PASS** — tool output confirms the check succeeded.
- **WARN** — soft issue worth surfacing, OR data was unavailable to run the check (tag these as `WARN (UNVERIFIED)`). Informational, not blocking.
- **FAIL** — tool output confirms the check failed. Blocking.

Tool-call failures (e.g., `architect_machine_get` returns an error for one machine) produce a `WARN (UNVERIFIED)` finding for the checks that depended on that data, not a silent skip.

## Infrastructure Checks

### 1. Producer/Consumer Consistency
Credentials defined on DCs (producers) match credentials used on workstations/servers (consumers). OU paths referenced in domain-join plugins exist in DC OU definitions. Domain names match across all machines in the same domain. Admin passwords on domain-join plugins match the DC's configured admin password.

### 2. Plugin Completeness
All required plugin parameters are set. Parameter values match expected types/formats. No orphan machines exist without any plugins. To audit all configured parameters across machines in bulk, call `discover_tools(search: "list params")`.

### 3. AD Structure Consistency
DC plugin params (CreateUsers, CreateOUs, CreateGroups) are internally consistent. Every user referenced in CreateUsers has a valid OU path in CreateOUs, and group memberships reference groups defined in CreateGroups. VLAN AD blueprint matches DC plugin params — every userArchetype, securityGroup, and serviceAccount in the blueprint has a corresponding entry on the DC. Additionally, verify the total user count across every DC's CreateUsers matches `constraints.maxUsers` from `architect_canvas_get_context` within +/-5% (per [shared-rules.md § Department Requirements — Headcount Math](../../../refs/shared-rules.md#headcount-math-critical)); drift produces `HEADCOUNT_DRIFT`.

### 4. Cross-Domain Connectivity
VLANs hosting domains with trust relationships have VLAN connections configured. Connectivity direction matches trust type (bidirectional trust needs two-way VLAN connectivity).

### 5. Blueprint User Assignments — User Existence
Every assigned user's `samAccountName` must exist in the `CreateUsers` param of the domain controller for the domain the machine is joined to. If the machine's domain has a trust relationship with another domain, the user may legitimately exist on the trusted domain's DC instead — check both before flagging. Produces `UNRESOLVED_ASSIGNED_USER`.

> **Independence from §1.** SKILL.md §1 step 1 (Auto Login plugin coupling) walks the same set of user assignments but answers a different question: *"Does the orchestration plugin exist?"* This Check 5 answers: *"Does the user actually exist on a DC?"* Both run on every machine with assignments, both can produce findings on the same machine, neither replaces the other. Don't dedupe.

### 6. Orphaned Machines
Every machine has at least one plugin and a clear purpose in the scenario. Machines with no plugins and no role produce `ORPHANED_MACHINE`.

### 7. IP Conflicts
No two machines share an IP address within the same VLAN. Compare IP assignments across `architect_machine_get` results per VLAN. Duplicates produce `IP_CONFLICT`.

### 8. Naming Consistency
Hostnames and domain names follow an established pattern across a domain (servers and workstations share a base pattern; only the type code differs). Outliers produce `NAMING_INCONSISTENCY`.

### 9. Plugin Dependencies
Every assigned plugin's prerequisite plugins exist on the same machine. For example, a domain-join plugin requires the base OS plugin; a database plugin requires the DB engine plugin. Missing prerequisites produce `MISSING_DEPENDENCY`.

### 10. Vulnerability Coverage
Call `discover_tools(search: "vulnerability state")` to audit vulnerability plugin distribution. Confirm every VLAN that should have attack surface has at least one vulnerability plugin. Proportional spread and pedagogical balance belong to `realism-checks.md` — this check is presence/absence only.

### 11. Resource Budget
Call `architect_canvas_get_budget` or read `resourceBudget` from `architect_canvas_get_overview`. Verify all three dimensions (RAM, CPU, machines) are within quotas. Overages produce `BUDGET_EXCEEDED`.

### 12. Plugin Parameter User Resolution
Any plugin parameter that references a username, samAccountName, or login credential must resolve to a real user on the appropriate domain controller. This catches typos, misspellings, and references to users that were never created.

**Efficient strategy:** For each domain, first collect the full user list from the DC's `CreateUsers` param (this may contain 200+ users in a CSV). Then sweep all machines in that domain, extracting usernames from every plugin parameter (auto-logon `username`, domain-join credentials, service account names, file-ownership references, etc.). Batch-compare against the DC user list rather than checking one machine at a time.

**Cross-domain trusts:** A plugin parameter may reference a user from a trusted domain (e.g., `YOURCOMPANY\john.smith` on a machine in `YOURCOMPANY.LOCAL` referencing a user in `YOURCOMPANYPARTNER.LOCAL`). Before flagging `UNRESOLVED_PLUGIN_USER`, check the DCs of all domains that have a trust relationship with the machine's domain.

**Credential matching:** When both a username and password appear in plugin params, verify the password matches what the DC has for that user. Password mismatches between plugin params and the DC's `CreateUsers` definition are a common cause of failed builds. Produces `PLUGIN_CREDENTIAL_MISMATCH` (FAIL — deterministic, **soft tone does NOT apply**; passwords either match or they don't).

**`UNRESOLVED_PLUGIN_USER` framing:** Out-of-band provisioning (custom scripts, prior canvas state) may legitimately create users the audit can't see. Surface as a directive — *"Username `{x}` is not in any reachable DC's `CreateUsers`. Verify it's provisioned out-of-band, or fix the typo."* No hedge phrases ("may be safe to ignore", "probably fine") — the reviewer decides.

`UNRESOLVED_PLUGIN_USER` is WARN (informational) because of the legitimate out-of-band case. **`PLUGIN_CREDENTIAL_MISMATCH` is always FAIL** — passwords either match or they don't; no soft tone, no downgrade.

### 13. Plugin Parameter IP & Port Cross-Reference
Plugin parameters frequently contain hardcoded IPs and ports that reference other machines in the scenario (e.g., a Windows workstation plugin connecting to an FTP server at `10.0.1.50:21`). These references must resolve to actual machines with matching static IPs and the expected service.

**Strategy:** Scan all plugin parameters across all machines for values that look like IP addresses (with or without ports). For each discovered IP reference:

1. **Resolve the IP to a machine** — find the machine in the canvas whose static IP matches. If no machine has that IP, produce `UNRESOLVED_PARAM_IP`.
2. **Verify the target has a static IP** — if the referenced machine uses DHCP or has no explicit static IP configuration, the hardcoded IP will break when DHCP assigns a different address. Produces `DYNAMIC_IP_HARDCODED`.
3. **Verify the service exists on the target** — if the reference includes a port or the context implies a service (FTP, SSH, HTTP, SMB, etc.), check that the target machine has a plugin that provisions that service. For example, if machine A's plugin param says `ftp_server=10.0.1.50`, then the machine at `10.0.1.50` should have an FTP-related plugin (bash script, role plugin, etc.). Missing service produces `MISSING_REFERENCED_SERVICE`.
4. **Verify VLAN reachability** — the source and target machines must be on the same VLAN or connected VLANs. If not, produce `UNREACHABLE_PARAM_IP`.

**Scope:** Best-effort. Plugin params are freeform text and may contain IPs in non-obvious formats (embedded in scripts, config file contents, CSV data). Grep param values for IPv4 patterns (`\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}`) and flag what surfaces. Unrecognized references are acceptable to miss — this is a safety net, not an exhaustive parser.

**Soft finding tone:** Like Check 12, frame findings as potential gaps: "This IP in plugin params doesn't match any machine's static IP — if this is configured via custom scripting or refers to an external resource, it may be safe to ignore."

### 14. Firewall & Network Flow Consistency
VLAN connections carry full firewall rule sets (ordered rules with ports, protocols, source/destination IPs, allow/deny states, and a default policy of BLOCK_ALL or ALLOW_ALL). This check validates that the firewall configuration actually permits the traffic that the scenario's plugins and services require.

**Strategy:** For each VLAN connection, read the firewall rules and default policy. Then evaluate whether the services running on machines in those VLANs can communicate as intended.

**Required service flows:**
Infer required network flows from the plugins and services deployed. **Resolve ports per plugin at runtime** via `architect_plugin_catalog_get_example` or `architect_plugin_catalog_list_full`; do not guess from plugin names. The illustrative cases below cover a few canonical patterns — they are not a complete reference:

| Service / Plugin | Common Ports | Direction |
|---|---|---|
| Domain join | 88 (Kerberos), 389/636 (LDAP), 445 (SMB), 53 (DNS) | Workstation → DC |
| File share access | 445 (SMB) | Client → File server |
| RDP access | 3389 | Client → Target |

For any plugin not above (FTP, web, syslog, WinRM, agent enrollment, etc.), pull the port list from the plugin's catalog metadata.

**Checks:**
1. **Service flow permitted** — For each cross-VLAN service dependency, verify the firewall rules (evaluated in sort order, with the default policy as fallback) permit the required ports and protocol. A blocked required flow produces `FIREWALL_BLOCKS_REQUIRED_FLOW`.
2. **Default policy sanity** — If a connection's default policy is `ALLOW_ALL` but the scenario includes security infrastructure (SIEM, IDS, segmentation), flag as `PERMISSIVE_DEFAULT_POLICY` (WARN). Real segmented networks use BLOCK_ALL with explicit allows.
3. **Stale or contradictory rules** — Flag rules that are shadowed by a higher-priority rule (same port/protocol, opposite action at a lower sort order). Produces `SHADOWED_FIREWALL_RULE` (WARN).
4. **Missing firewall rules on connection** — If two VLANs are connected but have zero firewall rules and a BLOCK_ALL default, all cross-VLAN traffic is blocked. If machines on those VLANs have cross-VLAN dependencies, produce `CONNECTION_BLOCKS_ALL_TRAFFIC`.

**Soft finding tone for permissive policies:** ALLOW_ALL may be intentional for flat lab networks or early-stage builds. Frame as: "This connection uses ALLOW_ALL — if segmentation is intentional for this scenario, consider adding explicit firewall rules."

### 15. Local Group Membership Enforcement
When a domain defines granular administrative groups in its DC's `CreateGroups` param (e.g., "Workstation Admins", "File Server Admins", "SQL Server Admins" — any group whose name or description implies scoped local admin rights rather than blanket domain-wide admin), those groups are only meaningful if machines actually assign them to local admin via a local group membership plugin.

**Why this matters:** Without explicit local group assignments, Windows defaults to giving Domain Admins local administrator access on every domain-joined machine. If the scenario went to the trouble of creating tight, role-specific admin groups, but no machine uses them, the groups are decorative — every Domain Admin still has full local admin everywhere, defeating the segmentation.

**Strategy:**
1. **Identify scoped admin groups** — Read each DC's `CreateGroups` param. Flag any group whose name or description suggests scoped administrative rights (keywords: "admin", "admins", "administrators", "elevated", "local admin", combined with a scope like "workstation", "server", "file", "SQL", "database", "HR", "finance", etc.). Exclude universal groups like "Domain Admins", "Enterprise Admins", and "Schema Admins" — those are expected to be domain-wide.
2. **Check machines for local group plugins** — For each machine in the domain, check whether it has a plugin that configures local group membership (e.g., a plugin that adds specific AD groups to the machine's local Administrators group). The plugin name or params should reference local group assignment, restricted groups, or Group Policy Preferences for local admin.
3. **Match groups to machines** — Verify that the scoped admin groups are actually being applied to appropriate machines. "Workstation Admins" should appear on workstations, "File Server Admins" on file servers, etc. A scoped admin group that exists on the DC but is never referenced in any machine's local group plugin produces `UNUSED_SCOPED_ADMIN_GROUP`.
4. **Check for missing local group plugins entirely** — If a domain has 2+ scoped admin groups but zero machines in that domain have any local group membership plugin, produce `NO_LOCAL_GROUP_ENFORCEMENT` (FAIL). This means the entire local admin segmentation is unenforced.

**Soft finding tone for partial coverage:** If some machines have local group plugins but others don't, frame as: "These machines have no local group membership plugin — Domain Admins will have local admin by default. If this is intentional for these specific machines, this may be acceptable."

### 16. User Account Name Validity
Every account name authored on the canvas must satisfy Windows account-name rules. Failures here mean the platform (AD or local Windows) rejects the row at deploy and the build silently loses users.

**Sources to sweep — every place samAccountName / username is authored:**

1. **DC `CreateUsers` params** — for every DC in every domain, read `CreateUsers` via `architect_assigned_plugin_get_param`. Validate every row's `samAccountName`.
2. **Local-user plugin params** — many plugins create *local* (non-domain) accounts: "Create Local User", auto-login plugins, RDP-enable plugins, sudoers plugins, service-account plugins, and bash/PowerShell scripts that run `New-LocalUser` / `useradd`. Plugin names vary; do not match by name alone. Instead:
   - Walk every assigned plugin on every machine via `architect_assigned_plugin_get`.
   - Inspect param values for fields named like `samAccountName`, `username`, `userName`, `account`, `login`, or `localUser`. Also inspect inline scripts in Run PowerShell / Run Bash plugins for `New-LocalUser`, `useradd`, or equivalent commands and extract the account name.
   - Apply the same length + character-set validation to every value found.
3. **AD blueprint user archetypes** (if present on VLAN AD blueprints) — same validation.

**Validation rules** (apply uniformly to every source above):

- **Length** — `samAccountName.length <= 20`. The pre-Windows-2000 logon name is capped at 20 characters; longer values are silently truncated or rejected. Produces `SAMACCOUNTNAME_TOO_LONG` (FAIL).
- **Character set** — must not contain spaces or any of these reserved characters: `\ / [ ] : ; | = , + * ? < > " @`. Period (`.`), hyphen (`-`), and underscore (`_`) are allowed. Produces `SAMACCOUNTNAME_INVALID_CHARS` (FAIL).

If a value fails validation, also note any plugin parameters elsewhere that reference that exact value — those references will silently break once the user fails to provision (cross-link with Check 12).

**Why scoping to DCs alone misses bugs:** A "Create Local User" plugin with `username: "this_is_a_username_that_is_way_too_long"` will fail at deploy time even though no DC ever sees that name. Same for inline `New-LocalUser` calls inside Run PowerShell scripts. Sweep the whole canvas.

### 17. Cross-Machine Plugin Dependency Reachability
Plugins on one machine frequently depend on services running on another machine (e.g., a child-domain DC depends on the parent-domain DC for forest replication; a workstation's domain-join plugin depends on the DC's AD plugin; a SQL client depends on the DB engine plugin). When the dependency crosses VLANs, the firewall on the connecting VLAN edge must actually permit the traffic the dependency needs.

This check is the union of three signals — declared deps, trust topology, and shared-service params — evaluated against the firewall rules on the connecting VLAN.

**Sources of cross-machine dependencies:**

1. **Explicitly declared** — `architect_assigned_plugin_get` returns `crossMachineDependencies: [{ pluginId, machineName, pluginName }]` for every plugin that was wired with `architect_assigned_plugin_set_cross_machine_deps`. These are the ground truth — the build orchestrator will block the dependent plugin until the dependency completes, so if the network can't carry the resulting runtime traffic the deploy succeeds but the service is broken.
2. **Implicit via domain trusts** — any two VLANs whose domains share a trust (same domain, parent/child, external, forest) should be `defaultPolicy: allow_all` with no rules. Threading individual ports between trusted domains buys nothing and breaks replication when the dynamic RPC range is omitted. Anything other than `allow_all` between a trust pair is suspicious and gets flagged.
3. **Implicit via shared-service plugin params** — a plugin parameter on machine A naming machine B's IP/hostname (covered by Check 13) implies a runtime flow from A to B. Check 13 already flags missing services and unreachable VLANs. This check adds the firewall-rule evaluation: even when VLANs are connected, the rules may block the required port.

**Strategy:**

1. **Build the dependency edge set.** Walk every assigned plugin via `architect_assigned_plugin_get` (use `discover_tools(search: "batch")` for bulk reads). For each plugin with non-empty `crossMachineDependencies`, emit an edge `{source: pluginMachine, target: depMachine, sourcePlugin, targetPlugin}`. Add edges from each domain trust pair (DC → DC in both directions for bidirectional trusts; one direction for unidirectional). Add edges harvested from Check 13's IP cross-reference pass.
2. **Resolve VLANs.** For each edge, look up the source and target machines' VLAN via `architect_machine_get`. Same VLAN → no firewall to evaluate, skip. Different VLANs → continue.
3. **Resolve required ports.** Pull the port list from `architect_plugin_catalog_get_example` / `architect_plugin_catalog_list_full` for the source and target plugins. **Trust edges short-circuit port resolution** — the canonical configuration between trusted domain VLANs is `defaultPolicy: allow_all` with no rules. Don't try to thread individual ports; flag the trust pair if it's anything other than `allow_all` (see step 5). Per-port evaluation (step 4) only runs for non-trust edges — declared deps and param-IP-derived flows.
4. **Evaluate firewall rules.** Read the connecting VLAN's firewall rules and `defaultPolicy` via `architect_vlan_get` (rules carry `state: allow|drop|deny`, `portsArray`, `protocol`, `sourceIPArray`, `destinationIPArray`, evaluated in sort order). Walk rules in order; first match wins; otherwise `defaultPolicy` decides. For each required port:
   - `defaultPolicy: allow_all` and no explicit `drop`/`deny` covering the port → PASS.
   - Explicit `allow` covering the port + protocol + source/dest IP scope → PASS.
   - Explicit `drop`/`deny` covering the port that fires before any `allow` → `FIREWALL_BLOCKS_DEPENDENCY` (FAIL).
   - `defaultPolicy: block_all` with no `allow` covering the port → `FIREWALL_BLOCKS_DEPENDENCY` (FAIL).
5. **Trust-pair-specific check.** For every trust pair from the §0 trust map, the connection should be `defaultPolicy: allow_all` with no rules. Flag deviations:
   - `defaultPolicy: block_all` (with or without rules) → `TRUST_PAIR_RESTRICTED` (FAIL). Threading individual ports between trusted domains breaks replication when the dynamic RPC range (`49152-65535`) is omitted, which is almost always.
   - `defaultPolicy: allow_all` with `drop`/`deny` rules layered on top → `TRUST_PAIR_RESTRICTED` (FAIL). The deny rules will block specific ports the trust needs.
   - `defaultPolicy: allow_all` with no rules → PASS. This is the canonical configuration.
   - Connection's `aiNotes` documents an explicit segmented-trust scenario (e.g., "this trust is intentionally restricted as a pen-test lesson") AND the rules cover the full DC-to-DC set (53, 88, 135, 137-139, 389, 445, 464, 636, 3268, 3269, 49152-65535) → PASS with WARN noting the unusual configuration.

   Trust pairs are an exception to Check 14's `PERMISSIVE_DEFAULT_POLICY` rule — between trusted domain VLANs, `allow_all` is the expected default, not a finding.
6. **No connection at all.** If two VLANs hosting machines connected by a dependency edge have no `architect_vlan_manage_connection` connection, emit `MISSING_DEPENDENCY_CONNECTION` (FAIL). This is a stronger version of `CONNECTION_BLOCKS_ALL_TRAFFIC` (Check 14) — a specific named dependency identifies what's broken.

**Why this is separate from Check 14:** Check 14 verifies "if a service is deployed, the firewall permits it." Check 17 verifies "if plugin A on machine M1 depends on plugin B on machine M2 — declared or via trust — the firewall permits the runtime flow." Check 14 surfaces broad service-flow problems; Check 17 ties findings back to specific plugin-pair dependencies, producing actionable remediation ("rule on connection {V1}↔{V2} blocks port {N} required by {plugin A on M1} → {plugin B on M2}").

**Coverage gate:** emit a count line in the report — *"Cross-machine dependency edges evaluated: {n} declared / {m} trust-pair / {p} param-IP-derived"* — and the count of edges that produced findings. An edge skipped because port resolution failed produces `WARN (UNVERIFIED)` for that edge, not a silent pass.

## Exploit Path Checks

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
| `MISSING_AUTOLOGON_PLUGIN` | Machine has a user assignment but no Auto Login plugin matching the user's credentials | SKILL §1 (Coupling) |
| `MISSING_FILECOPY_PLUGIN` | Files staged in the machine vault but no File Copy plugin to deliver them | SKILL §1 (Coupling) |
| `MISSING_OFFICE_PLUGIN` | Windows workstation with assigned user lacks an Office install (WARN) | SKILL §1 (Coupling) |
| `FILECOPY_PER_FILE_MAPPING` | File Copy plugin has 4+ mappings to the same dir; prefer folder content map (WARN) | SKILL §1 (Mapping quality) |
| `FILECOPY_RUN_ORDER_WRONG` | File Copy `run_order` not greater than every other plugin on the machine | SKILL §1 (Run-Order) |
| `DOMAINJOIN_RUN_ORDER_WRONG` | Domain Join `run_order` ≥ Auto Login `run_order` (Auto Login as a domain user fires before join) | SKILL §1 (Run-Order) |
| `CREDENTIAL_MISMATCH` | Password/username does not match between producer and consumer | Check 1 |
| `MISSING_PLUGIN_PARAMS` | Required parameter not configured | Check 2 |
| `ORPHANED_MACHINE` | Machine exists but has no plugins or purpose | Check 6 |
| `IP_CONFLICT` | Duplicate IP addresses within a VLAN | Check 7 |
| `NAMING_INCONSISTENCY` | Hostname or domain name does not follow established pattern | Check 8 |
| `MISSING_DEPENDENCY` | Plugin prerequisite not present on the machine | Check 9 |
| `HEADCOUNT_DRIFT` | DC CreateUsers totals drift from `constraints.maxUsers` by more than +/-5% | Check 3 |
| `BUDGET_EXCEEDED` | Total RAM, CPU, or machine count exceeds user quota | Check 11 |
| `UNRESOLVED_ASSIGNED_USER` | Assigned user's samAccountName not found on the machine's DC (or trusted domain DCs) | Check 5 |
| `UNRESOLVED_PLUGIN_USER` | Username in a plugin parameter not found on any reachable DC (WARN — may be externally provisioned) | Check 12 |
| `PLUGIN_CREDENTIAL_MISMATCH` | Password in plugin params does not match the DC's CreateUsers definition for that user | Check 12 |
| `UNRESOLVED_PARAM_IP` | IP address in plugin params does not match any machine's static IP | Check 13 |
| `DYNAMIC_IP_HARDCODED` | Plugin param hardcodes an IP for a machine that has no static IP (DHCP will break it) | Check 13 |
| `MISSING_REFERENCED_SERVICE` | Target machine at referenced IP has no plugin provisioning the expected service | Check 13 |
| `UNREACHABLE_PARAM_IP` | Source machine cannot reach referenced IP (no VLAN connectivity) | Check 13 |
| `FIREWALL_BLOCKS_REQUIRED_FLOW` | Firewall rules block a port/protocol required by a deployed service | Check 14 |
| `PERMISSIVE_DEFAULT_POLICY` | ALLOW_ALL default on a connection in a segmented/security-focused scenario | Check 14 |
| `SHADOWED_FIREWALL_RULE` | A rule is fully shadowed by a higher-priority rule with the opposite action | Check 14 |
| `CONNECTION_BLOCKS_ALL_TRAFFIC` | Connected VLANs have BLOCK_ALL default + zero rules, but machines need cross-VLAN traffic | Check 14 |
| `UNUSED_SCOPED_ADMIN_GROUP` | A scoped admin group exists on the DC but is never referenced in any machine's local group membership plugin | Check 15 |
| `NO_LOCAL_GROUP_ENFORCEMENT` | Domain has 2+ scoped admin groups but zero machines have local group membership plugins (segmentation is decorative) | Check 15 |
| `SAMACCOUNTNAME_TOO_LONG` | A user's samAccountName exceeds Windows AD's 20-character pre-Windows-2000 logon limit | Check 16 |
| `SAMACCOUNTNAME_INVALID_CHARS` | A user's samAccountName contains reserved characters (space or `\ / [ ] : ; \| = , + * ? < > " @`) | Check 16 |
| `FIREWALL_BLOCKS_DEPENDENCY` | A declared cross-machine plugin dependency, trust-pair flow, or param-IP-derived flow is blocked by an explicit `drop`/`deny` rule or by `block_all` default with no covering `allow` | Check 17 |
| `TRUST_PAIR_RESTRICTED` | A trust-pair connection is anything other than `defaultPolicy: allow_all` with no rules. Exception: an `aiNotes`-documented segmented-trust scenario whose rules cover the full DC-to-DC port set (53, 88, 135, 137-139, 389/636, 445, 464, 3268/3269, 49152-65535) — passes with WARN | Check 17 |
| `MISSING_DEPENDENCY_CONNECTION` | Source and target machines of a cross-machine dependency live on different VLANs with no connection configured | Check 17 |

## Exploit Path Error Codes

| Code | Meaning | Produced By |
|---|---|---|
| `MISSING_EXPLOIT_PATH_PLAN` | Canvas implies an exploit path (crown jewel note, scenario context) but no `EXPLOIT PATH ROLE:` stamps exist | SKILL §3 (Detection) |
| `EXPLOIT_TRACE_GAP` | Non-contiguous hop numbers in `aiNotes` stamps | SKILL §3.A (Trace walk) |
| `INVALID_PRIVILEGE_CHAIN` | Privilege level does not flow correctly between hops | Exploit Check 1 |
| `CREDENTIAL_FLOW_ERROR` | Credential used before it was discovered | Exploit Check 2 |
| `TECHNIQUE_UNAVAILABLE` | Technique not in catalog or incompatible OS | Exploit Check 3 |
| `UNREACHABLE_HOP` | Source cannot reach target (network/VLAN issue) | Exploit Check 4 |
| `INVALID_TRUST_PATH` | Trust relationship does not support the traversal | Exploit Check 5 |
| `DIFFICULTY_VIOLATION` | Technique does not match the requested difficulty | Exploit Check 6 |

## Reading the Canvas (efficient prep)

Before running checks, prep the data you'll need across multiple checks:

1. `architect_canvas_get_overview` for the full picture; `architect_canvas_get_projected_state` for the full draft state preview.
2. `architect_vlan_get` per VLAN for machines + plugins. For 3+ machines, `discover_tools(search: "batch")` for batch reads.
3. **DC user roster** — for each domain, read the DC's `CreateUsers` param once to build a complete user list before sweeping workstations. Note trust relationships for cross-domain user resolution.
4. **IP → machine map** — while reading machines, build a static-IP-to-machine lookup. This powers Check 13 (IP cross-referencing) without redundant queries. Note machines that lack a static IP.
5. **Diff against last apply** — `discover_tools(search: "diff")` to see what changed since the last apply, when relevant.

The orchestrator (SKILL.md) owns reporting and verdict. This ref is the check catalog + error code dictionary.
