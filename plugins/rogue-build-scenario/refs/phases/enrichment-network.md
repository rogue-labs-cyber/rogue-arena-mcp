# Enrichment: Network Phase — Reference Doc

> **For:** architect-implementor Phase B (enrichment step — network)
> **Source:** Migrated from skills/enrichment-network/SKILL.md
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
| Cross-zone (DMZ to Internal, Isolated to any) | `block_all` |
| Same-zone peers | `allow_all` if high trust, `block_all` if segmentation needed |
| Management to anything | `block_all` |

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
2. **Default policy** — cross-zone pairs use `block_all`. Same-zone pairs have justification if `allow_all`.
3. **Trust alignment** — `domainTrust` matches what `architect_forest_get_events` declared.
4. **AD port completeness** — every non-`none` trust includes rules for AD ports (88, 389, 636, 445, 53, 3268, 3269).
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
6. The implementor runs completeness verification (`architect_canvas_get_completeness`) after this phase completes.

## Constraints

- Every VLAN pair sharing a domain trust has firewall rules allowing AD ports.
- Isolated VLANs get `block_all` to all others. DMZ VLANs get `block_all` inbound from internal.
- Manual firewall rules stay intact — the implementor must add alongside and preserve the default policy.
- At least 2 VLANs must exist (if fewer, the implementor must stop and report).
