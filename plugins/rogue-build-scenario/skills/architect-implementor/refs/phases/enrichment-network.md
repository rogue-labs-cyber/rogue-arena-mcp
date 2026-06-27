# Enrichment: Network Phase — Reference Doc

> **For:** architect-implementor Phase B (enrichment step — network)
> **Do not add:** persona blocks, trigger phrases, user interaction framing

The network enrichment phase wires inter-VLAN connectivity for existing infrastructure — firewall rules, domain trust direction, traffic flow policies, and VLAN connections. This phase implements what the domains phase declared.

## Zone Classification

Zones are set by the domains phase at VLAN creation. See [shared-rules.md -- VLAN Zone Classification](../shared-rules.md#vlan-zone-classification) for the canonical zone table and flag semantics.

**Fallback:** If a VLAN has no zone set, the implementor must halt and ask for a zone assignment. The implementor must not re-assign zones in enrichment.

## Domain Trust Configuration

See [shared-rules.md -- Domain Relationship Vocabularies](../shared-rules.md#domain-relationship-vocabularies) for the canonical `BlueprintDomainTrustEnum` values and default AD direction per business relationship type.

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
- Trust pairs (any non-`none` `domainTrust`: same domain, parent/child, external, forest)
- Same-zone peers in a high-trust segment
- Internal workstation VLAN → DC VLAN in the same forest

`block_all` + specific allow rules cases (enumerate ports here, not between trusted segments):
- Internet / untrusted → DMZ: allow only the exposed service ports (80/443 to a webserver, 25 to a mail relay, etc.)
- DMZ → internal: allow only the specific app port the DMZ host needs
- Isolated VLAN → anything: `block_all`, no allow rules
- Management → workstation when the scenario teaches just-in-time admin

**Why this matters for trust pairs specifically:** DC-to-DC replication uses a dynamic RPC range (`49152-65535`) plus a dozen well-known ports. Threading 445 and the NetBIOS ports between domains "to be specific" buys nothing pedagogically and silently breaks replication when the dynamic range is omitted. Just `allow_all`.

If the scenario *does* call for a segmented trust (rare — usually a pen-test lesson about a misconfigured trust), document the deviation in `aiNotes` on the connection and enumerate the full DC-to-DC set: `53, 88, 135, 137-139, 389, 445, 464, 636, 3268, 3269, 49152-65535`. The validator's `TRUST_PAIR_RESTRICTED` check fires when a trust pair is `block_all` with rules missing any of those ports.

**Priority bands:**

| Range | Use |
|---|---|
| 1-100 | Critical allow rules |
| 101-500 | Standard allow rules |
| 501-900 | Specific deny rules |
| 901-999 | Catch-all rules |

**Protocol values:** `tcp`, `udp`, or `both` only (no `icmp` or `any`).

**Common port mappings:** See [shared-rules.md -- Common Port Mappings](../shared-rules.md#common-port-mappings).

## Traffic Flow Principles

- **Standard flows (usually allowed):** Workstations to DCs (AD auth, DNS, LDAP), workstations to file servers (SMB/445), management to everything, servers to DCs.
- **DMZ flows (strict isolation):** Internet to DMZ on specific ports only (80, 443). DMZ to internal defaults to deny; DMZ to database allows specific app ports only.
- **Isolation patterns:** Guest VLAN has no internal access. IoT/OT limits to management servers. Dev/test is isolated from production.

## Manual Rule Preservation

If `manualRuleCount > 0` on any pair, the implementor must add new rules alongside the existing ones and preserve the existing default policy. Manual rules are user-authored and stay untouched.

## 8-Point Verification

For every VLAN pair, the implementor must verify before reporting completion:

1. **Zone check** — both VLANs have a zone assigned matching their contents.
2. **Default policy** — trust pairs and same-zone high-trust peers use `allow_all` with no rules. `block_all` + enumerated allows is reserved for restricting *untrusted inbound* (DMZ from internet, DMZ → internal, isolated, management).
3. **Trust alignment** — `domainTrust` matches what `architect_forest_get_events` declared.
4. **Trust-pair simplicity** — every non-`none` trust pair is `defaultPolicy: allow_all` with no rules. If a scenario explicitly needs a segmented trust, the connection's `aiNotes` documents why and rules cover the full DC-to-DC set (53, 88, 135, 137-139, 389, 445, 464, 636, 3268, 3269, 49152-65535). Anything in between trips `TRUST_PAIR_RESTRICTED`.
5. **Priority band compliance** — allow rules in 1-500, deny rules in 501-900, catch-alls in 901-999.
6. **Manual rule preservation** — if `manualRuleCount > 0`, default policy unchanged.
7. **Isolated VLAN integrity** — every `isolated` VLAN has `block_all` to every other VLAN and trust `none`.
8. **DMZ inbound check** — every DMZ VLAN has `block_all` default for inbound from internal.

## Checklist

1. Read VLANs and machines — `architect_vlan_list`, `architect_vlan_get` per VLAN, `architect_machine_list`.
2. Read forest topology — `architect_forest_get_events` for trust relationships.
3. Verify zones — every VLAN has a zone set (halt and ask if any is missing).
4. Create firewall rules — `architect_vlan_manage_connection` per VLAN pair with trust level, rules, and default policy.
5. Run 8-point verification — walk every VLAN pair through the protocol above.
6. The implementor verifies state via `architect_canvas_get_overview` after this phase completes.

## Constraints

- Every VLAN pair sharing a domain trust uses `defaultPolicy: allow_all` with no rules. Don't enumerate ports between trusted domains — threading 445/NetBIOS/etc. buys nothing and silently breaks replication when the dynamic RPC range is omitted.
- Enumerate ports only when restricting untrusted inbound to a specific exposed service (e.g., 80/443 to a DMZ webserver). That's the case where `block_all` + targeted allows teaches something.
- Isolated VLANs get `block_all` to all others. DMZ VLANs get `block_all` inbound from internal except for the specific app port the DMZ host actually needs.
- Manual firewall rules stay intact — the implementor must add alongside and preserve the default policy.
- At least 2 VLANs must exist (if fewer, the implementor must stop and report).
