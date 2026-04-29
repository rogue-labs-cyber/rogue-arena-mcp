# Escape-Hatch Plugins — Reference Doc

> **Loaded by:** `architect-brainstorm` Phase 4, `architect-validator`.
> **Purpose:** Define the two canvas-universal plugins Claude may use when the native catalog doesn't cover a setup step, and the discipline that governs their use.

---

## The two canvas-universal plugins

These two plugins are **assumed available on every canvas**. Claude may cite them in `implementorNotes.suggestedPlugin` without pre-checking the canvas's plugin catalog.

### `Run PowerShell Script`

- Target: Windows machines.
- Parameters: `scriptContent` (string), `runAsUser` (optional), `delay` (optional).
- Used for: AD-native setup Claude can sketch — create user, set SPN, modify ACL, add group membership, plant registry keys.

### `Run Bash Script`

- Target: Linux machines.
- Parameters: `scriptContent` (string), `sudo` (bool, optional), `delay` (optional).
- Used for: Linux-side setup — install packages, modify sshd/xrdp, chmod files, create keytabs.

---

## Query-First Discipline (5-source order)

Before reaching for the escape hatch, Claude queries the catalog surface in strict order:

1. **Vuln plugins** — `architect_exploit_plugin_find` with keyword + OS filters.
2. **Exploit enum / attacker actions** — `architect_exploit_technique_list` filtered by `implementationTypes: ['attacker_action']`.
3. **Pathway plugins** — same tool, filtered by plugins that open non-default services (Enable RDP, Enable PSRemoting).
4. **File-seeding patterns** — `architect_exploit_technique_list` filtered by `implementationTypes: ['file_seeding']`.
5. **Default infrastructure** — verify network paths by calling `architect_vlan_get` on the relevant VLANs to inspect zone membership and firewall rules before assuming a service is reachable.

Only if **all five** return no match does Claude fall back to `Run PowerShell Script` / `Run Bash Script`.

**Expert-declaration skip:** if the user explicitly names an uncataloged technique (`"I want ESC1"`, `"install xrdp"`, `"set up RBCD"`), Claude MAY skip the ceremonial 5-query walk and log an assertion in `exploit.yml`:

```yaml
- hopNumber: 6
  expertDeclaration: "User asserted ESC1 is uncataloged; 5-source walk skipped"
```

The assertion is journaled. No ceremony when the user's domain knowledge is clearly ahead of the catalog.

---

## Cap invariant (hard fail in validator)

Per path:

- Hops citing `Run PowerShell Script` OR `Run Bash Script` ≤ `min(2, ceil(hops * 0.20))`.
- Override: add `escapeHatchOverride: "<reason>"` on the specific hop. The override is journaled in `exploit.yml`.

**Free-a-slot refactor prompt.** Before asking the user to override the cap, Claude MUST first scan already-committed hops and ask:

> "This would put us at 3 escape-hatch hops (cap: 2). Before I ask you to override, want me to refactor hop 1 — its ACL config could use default SMB behavior instead of a Run PS Script, which would free a slot. OK?"

User can accept the refactor (clean path), reject (triggers `escapeHatchOverride` on the new hop), or redirect.

---

## When to use

- AD-native setup with no plugin coverage: creating service accounts with specific SPNs, publishing vulnerable ADCS templates (ESC1), setting RBCD via `msDS-AllowedToActOnBehalfOfOtherIdentity`, configuring GPP cpasswords, ACL chain configuration (GenericWrite, WriteDACL, AddMember).
- Linux-side setup the catalog doesn't cover: installing xrdp, configuring a fake keytab, chmod'ing files to create a privesc, setting up sudoers misconfigurations.
- Registry-based credential material planting on Windows.
- Local admin group membership when a dedicated plugin doesn't exist.

## When NOT to use

- Don't wrap a script around something the catalog already does cleanly. If an `Enable RDP` plugin exists, use it — don't write a PS script that enables RDP.
- Don't use for the *attacker's* side of a hop. Run-Script is for scenario *setup* (what the admin accidentally did or mis-configured), not for the attacker's exploit technique.
- Don't use to re-implement a catalog-present attacker_action (no Mimikatz-via-PS-Script when `credential_harvest_lsass` is an attacker_action in the catalog).

---

## Note pattern (copy-paste reference)

```yaml
implementorNotes:
  - type: machine_config
    machine: DM-DC-01
    intent: "One-line: what the script accomplishes"
    resolvesTo:
      pluginId: "run_powershell_script"
    details: "Rough PS pseudocode or parameter sketch. Do NOT write full script — that's implementor's job."
    suggestedPlugin: "Run PowerShell Script"
```

For Linux — note how a compound setup splits into type-pure notes:

```yaml
implementorNotes:
  - type: machine_config
    machine: BASTION-01
    intent: "Install xrdp package + enable service so a Windows→Linux RDP pivot is possible"
    resolvesTo:
      pluginId: "run_bash_script"
    details: "apt install xrdp; systemctl enable --now xrdp. Bind user shell to Xfce."
    suggestedPlugin: "Run Bash Script"
  - type: network_config
    machine: BASTION-01
    intent: "Open TCP 3389 on bastion firewall so the RDP hop is reachable"
    resolvesTo:
      pluginId: "run_bash_script"
    details: "ufw allow 3389/tcp comment 'xrdp pivot for Linux→Windows bridge'"
    suggestedPlugin: "Run Bash Script"
```

---

## Maintenance

When a new canvas-universal plugin gets added to the platform, append to this doc. Single source of truth for "what's always available."
