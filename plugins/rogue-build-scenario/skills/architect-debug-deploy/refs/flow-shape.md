# Flow — The Shape

> Loaded by `architect-brainstorm` after the roadmap. Do not invoke as a skill.

Four questions, one per turn. Prefer multiple choice (3 options + "or describe something different").

**Q1 — Company.** Industry, name, description. Enrich thin prompts into distinctive identities — "a medium tech company" is not enough. Propose narrative hooks (acquisition, breach, failed audit).

**Q2 — Size.** Machine count. Suggest a tier: small (3-8), mid (8-15), large (15-25). Larger scales (enterprise 25-80, enterprise-jumbo 60-150) require staff privilege or a request to info@roguelabs.io — mention that explicitly if you'd recommend one. Recommend a tier based on their company.

**Q3 — Domains and VLANs.** Propose 2-3 topology layouts with trade-offs and your recommendation. VLANs nest inside their parent domain. List machines by role (not plugin). For small single-VLAN scenarios, propose one layout directly. Include optional `note` on any machine for user intent.

Domain/VLAN rules:
- **One domain = one VLAN.** Always a 1:1 mapping.
- If you need network segmentation (e.g., office vs warehouse), that means separate domains in separate VLANs.
- A VLAN can be isolated/non-AD (no domain), but if it has a domain, it's 1:1.
- A DMZ can be its own domain, standalone with `ad_domain_enabled: false`, or joined to an existing domain — user decides.
- All domain FQDNs use `.local` TLD (e.g., `dundermifflin.local`, `scranton.dundermifflin.local`). This is an internal AD convention — using `.com` would conflict with public DNS.
- Prefer going bigger — more domains, more users. Each domain should have a minimum of ~50 users, ~10 OUs, ~12 security groups (unless it's a lean parent/admin domain).

**Q4 — Character style.** Realistic or pop culture? If pop culture, which franchises?

**Gate 1.** Once the user confirms Q3's topology, dispatch a **Haiku subagent** to generate `scenario_part1.yml`. Pass it: company details, domain/VLAN layout, machine roles, character style, all Q1-Q4 answers. The subagent writes the YML file and returns. Then present the topology visual (see `refs/brainstorm-reference.md` for format) with a bullet summary. Ask for tweaks. On confirm, return to the orchestrator and load `refs/flow-cast.md`.
