# Enrichment: Network Phase — Reference Doc

> **For:** flow-implement Phase B (enrichment step — network)
> **Do not add:** persona blocks, trigger phrases, user interaction framing

The network enrichment phase wires inter-VLAN connectivity for existing infrastructure — firewall rules, domain trust direction, traffic flow policies, and VLAN connections. This phase implements what the domains phase declared.

## Zone Classification

Zones are set by the domains phase at VLAN creation, in each VLAN's `aiNotes`. See [shared-rules.md -- VLAN Zone Classification](../shared-rules.md#vlan-zone-classification) for the canonical zone table and flag semantics.

**Fallback:** If a VLAN's `aiNotes` name no zone, halt and ask for a zone assignment. Do not re-assign zones in enrichment.

## Domain Trust Configuration

See [shared-rules.md -- Domain Relationship Vocabularies](../shared-rules.md#domain-relationship-vocabularies) for the canonical `BlueprintDomainTrustEnum` values and default AD direction per business relationship type.

The connection tool takes no trust input: its answer reports the pair's `domainTrust`, and `architect_forest_get_domain_trusts` reports the trusts that stand (a connection's own trust, or a parent-child trust the forest's domain names imply). The decision rules below give the trust each pair is treated as having when you set its firewall policy.

Decision rules:
- Either VLAN not AD-enabled: `none`
- Same domain: `bidirectional`
- DMZ to internal: `we_trust_them`
- Isolated: `none` always
- Absence of a forest trust event: `none` (trusts are declarative, never inferred)

## Firewall Rules

**Default policy values:** `allow_all` or `block_all` only (no `allow`/`deny`/`block`/`permit`).

| Pair Type | Default |
|---|---|
| **Any trust pair (same domain, parent/child, external, forest)** | **`allow_all`, no rules** |
| Same-zone peers in a high-trust segment | `allow_all`, no rules |
| Internet / untrusted → DMZ | `block_all` + allow rules for the exposed service ports only |
| DMZ → internal | `block_all` + allow rules for the specific app port only |
| Isolated VLAN → anything | `block_all`, no allow rules |
| Management → anything | `block_all` (use just-in-time admin if the scenario teaches it) |

### When to use `allow_all` vs. enumerated rules

The default mental model: **between anything that should mutually trust each other, use `allow_all` with no rules.** Enumerate ports only when the scenario explicitly needs to restrict traffic — and the canonical case for that is *untrusted inbound to a specific exposed service* (e.g., internet → DMZ webserver on 80/443, where blocking everything else is the security posture being taught).

`allow_all` cases (default — no rules needed):
- Trust pairs (same domain, parent/child, external, forest, per the decision rules above)
- Same-zone peers in a high-trust segment
- Internal workstation VLAN → DC VLAN in the same forest

`block_all` + specific allow rules cases (enumerate ports here, not between trusted segments):
- Internet / untrusted → DMZ: allow only the exposed service ports (80/443 to a webserver, 25 to a mail relay, etc.)
- DMZ → internal: allow only the specific app port the DMZ host needs
- Isolated VLAN → anything: `block_all`, no allow rules
- Management → workstation when the scenario teaches just-in-time admin

**Why this matters for trust pairs specifically:** DC-to-DC replication uses a dynamic RPC range (`49152-65535`) plus a dozen well-known ports. Threading 445 and the NetBIOS ports between domains "to be specific" buys nothing pedagogically and silently breaks replication when the dynamic range is omitted. Just `allow_all`.

If the scenario *does* call for a segmented trust (rare — usually a pen-test lesson about a misconfigured trust), document the deviation in the source VLAN's `aiNotes` (`architect_vlan_update`; a connection has no notes field) and enumerate the full DC-to-DC set: `53, 88, 135, 137-139, 389, 445, 464, 636, 3268, 3269, 49152-65535`. `/architect-final-validate`'s `TRUST_PAIR_RESTRICTED` check fires when a trust pair is `block_all` with rules missing any of those ports.

**Rule order:** a rule set has no priority numbers. Rules apply in the order sent (each answers its `sortOrder`), the first match wins, and `defaultPolicy` decides the rest. Send critical allow rules first, then standard allow rules, then specific deny rules, then catch-all rules.

**Protocol values:** `tcp`, `udp`, or `both` only (no `icmp` or `any`).

**Common port mappings:** See [shared-rules.md -- Common Port Mappings](../shared-rules.md#common-port-mappings).

## Traffic Flow Principles

- **Standard flows (usually allowed):** Workstations to DCs (AD auth, DNS, LDAP), workstations to file servers (SMB/445), management to everything, servers to DCs.
- **DMZ flows (strict isolation):** Internet to DMZ on specific ports only (80, 443). DMZ to internal defaults to deny; DMZ to database allows specific app ports only.
- **Isolation patterns:** Guest VLAN has no internal access. IoT/OT limits to management servers. Dev/test is isolated from production.

## Manual Rule Preservation

`set_firewall_rules` replaces a direction's whole rule set. If a pair already has rules (`architect_vlan_get` `connections`: `ruleCount`, `rules`), send them back with the new ones and keep the existing default policy. Rules a person wrote stay untouched.

## 8-Point Verification

For every VLAN pair, verify before reporting completion:

1. **Zone check** — both VLANs have a zone assigned matching their contents.
2. **Default policy** — trust pairs and same-zone high-trust peers use `allow_all` with no rules. `block_all` + enumerated allows is reserved for restricting *untrusted inbound* (DMZ from internet, DMZ → internal, isolated, management).
3. **Trust alignment** — every pair the decision rules make a trust pair (from `architect_forest_get_events` and `architect_forest_get_domain_trusts`) is handled as one in item 4.
4. **Trust-pair simplicity** — every trust pair is `defaultPolicy: allow_all` with no rules. If a scenario explicitly needs a segmented trust, the source VLAN's `aiNotes` documents why and rules cover the full DC-to-DC set (53, 88, 135, 137-139, 389, 445, 464, 636, 3268, 3269, 49152-65535). Anything in between trips `TRUST_PAIR_RESTRICTED`.
5. **Rule order** — allow rules before specific deny rules, catch-alls last.
6. **Existing rule preservation** — a pair that had rules keeps them and its default policy.
7. **Isolated VLAN integrity** — every `isolated` VLAN has `block_all` to every other VLAN and is in no trust pair.
8. **DMZ inbound check** — every DMZ VLAN has `block_all` default for inbound from internal.

## Checklist

1. Read VLANs and machines — `architect_vlan_list`, `architect_vlan_get` per VLAN, `architect_machine_list`.
2. Read forest topology — `architect_forest_get_events` for trust relationships.
3. Verify zones — every VLAN has a zone set (halt and ask if any is missing).
4. Create firewall rules — `architect_vlan_manage_connection` with `operation: set_firewall_rules`, `sourceVlan`, `targetVlan` and `firewallRules` (`defaultPolicy`, `rules`), once per direction (it takes no trust level).
5. Run 8-point verification — walk every VLAN pair through the protocol above.
6. Verify state via `architect_canvas_get_overview` after this phase completes.

## Constraints

- Every VLAN pair sharing a domain trust uses `defaultPolicy: allow_all` with no rules. Don't enumerate ports between trusted domains — threading 445/NetBIOS/etc. buys nothing and silently breaks replication when the dynamic RPC range is omitted.
- Enumerate ports only when restricting untrusted inbound to a specific exposed service (e.g., 80/443 to a DMZ webserver). That's the case where `block_all` + targeted allows teaches something.
- Isolated VLANs get `block_all` to all others. DMZ VLANs get `block_all` inbound from internal except for the specific app port the DMZ host actually needs.
- Existing firewall rules stay intact — send them back with the new ones and preserve the default policy.
- At least 2 VLANs must exist (if fewer, stop and report).
