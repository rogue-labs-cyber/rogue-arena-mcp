# Scenario YML Schema Reference

> **For:** architect-brainstorm (loaded JIT when writing YML files)
> **Purpose:** Examples and guidance for the three brainstorm output files

The brainstorm produces three files:

| File | Nickname | Gate | Contents |
|------|----------|------|----------|
| scenario_part1.yml | "The Shape" | Gate 1 | Company, domains with nested VLANs, machine roles |
| scenario_part2.yml | "The Cast" | Gate 2 | Characters with backgrounds, hobbies, security habits |
| scenario_part3.yml | "The Build" | Gate 3 | Plugin mapping, domain relationships, substitutions, defaults |

---

## scenario_part1.yml — "The Shape"

Infrastructure skeleton. Company identity, domains with nested VLANs, machine roles. No plugins, no characters, no defaults.

Key rules:
- **One domain = one VLAN.** Always 1:1. Never split a domain across VLANs or put two domains in one VLAN.
- VLANs are nested inside their parent domain in the YML
- If you need network segmentation (office vs warehouse), use separate domains in separate VLANs
- A DMZ can be its own domain, standalone with `ad_domain_enabled: false`, or joined to an existing domain — user decides
- Each domain should have a minimum of ~50 users, ~10 OUs, ~12 security groups (unless it's a lean parent/admin domain)
- Prefer going bigger — more domains with rich user populations over fewer domains with sparse users
- Machines are listed by **role** (not plugin) with optional `note` for user intent
- Use `count` for multiples of the same role (e.g., workstation ×6)
- `trusts` are top-level (between domains), not nested
- No `defaults`, no `plugin_mapping` — those belong in later files
- All `fqdn` values MUST end in `.local` (e.g., `sienar.local`, `cygnus.sienar.local`) — Rogue Arena lab convention, enforced by the platform at write time
- Standalone VLANs with no AD domain use `fqdn: null` and `type: standalone`

```yaml
schema_version: 1

meta:
  name: "Sienar Fleet Systems"
  created: 2026-04-15
  canvas_id: null                     # stamped before implementation

company:
  name: "Sienar Fleet Systems"
  industry: "defense-contractor"
  description: "Imperial defense contractor, TIE fighter manufacturer. Recently acquired Cygnus Spaceworks. IT department of 3 runs everything from a basement they call 'the sub-level'."
  size: mid                           # small | mid | large | enterprise | enterprise-jumbo
  security_posture: neglected         # chaotic | neglected | standard | hardened | fortress
  narrative_hooks:
    - "Acquired Cygnus Spaceworks — integration is a disaster"
    - "CISO position open for 18 months, intern is interim security lead"
  milestones:                         # optional — seeds forest event generation
    - year: 2015
      event: "Founded as Imperial defense subcontractor"
    - year: 2025
      event: "Acquired Cygnus Spaceworks"
  locations:
    primary: "Corulag"

characters:
  style: popculture                   # realistic | popculture
  franchises: ["Star Wars", "IT Crowd"]

# VLANs nested inside their parent domain
domains:
  - fqdn: "sienar.local"
    type: root
    description: "Corporate HQ domain"
    vlans:
      - name: "Holonet Gateway"
        zone: dmz                     # dmz | management | internal | isolated
        machine_count: 3
        purpose: "Internet-facing services — web portal, mail relay, VPN concentrator"
        machines:
          - role: web_server
            note: "Vulnerable HTTP server exposed to the internet"
          - role: mail_relay
          - role: vpn_gateway

      - name: "The Sub-Level"
        zone: internal
        machine_count: 7
        purpose: "IT department basement + executive and department workstations"
        machines:
          - role: domain_controller
          - role: workstation
            count: 6

      - name: "Imperial Data Vault"
        zone: management
        machine_count: 4
        purpose: "Core infrastructure — file servers, database, ticketing system, backup DC"
        machines:
          - role: domain_controller
          - role: file_server
          - role: db_server
          - role: app_server
            note: "Internal wiki — the ticketing system running 'temporarily' for 5 years"

  - fqdn: "cygnus.sienar.local"
    type: child
    description: "Acquired subsidiary — nobody configured the trust properly"
    vlans:
      - name: "Cygnus R&D Lab"
        zone: internal
        machine_count: 5
        purpose: "Cygnus engineers — dev servers with prototype schematics"
        machines:
          - role: domain_controller
          - role: workstation
            count: 3
          - role: dev_server
            note: "Holds classified Project Phantom prototype files"
            # standard Ubuntu box — no plugin needed in part3

trusts:
  - from: "cygnus.sienar.local"
    to: "sienar.local"
    direction: bidirectional           # inbound | outbound | bidirectional
```

---

## scenario_part2.yml — "The Cast"

Characters only. One per workstation. Grouped by domain.

Key rules:
- One character per workstation — these are the primary signed-in users students encounter
- Implementor generates additional users (abandoned profiles, service accounts) to hit target counts
- DCs and servers don't get primary characters
- `machine` is the hostname label (e.g., "SUBLVL-WS-01")
- `security_habits` is the fun part — password habits, misconfigs, DA status

```yaml
schema_version: 1

meta:
  name: "Sienar Fleet Systems — The Cast"
  created: 2026-04-15
  canvas_id: null
  scenario_ref: "scenario_part1.yml"

# One character per workstation. Implementor adds more during build
# to hit target user count (abandoned profiles, service accounts, etc.)

characters:
  # ── sienar.local ──────────────────────────────────────────

  - name: "Darth Vader"
    domain: "sienar.local"
    machine: "SUBLVL-WS-01"
    company_role: "CEO / Grand Moff"
    background: "Founded the company. Rules through fear. IT avoids him."
    hobbies: ["Force-choking keyboards", "collecting Sith holocrons", "competitive pod racing stats"]
    security_habits: "Has Domain Admin because nobody dares revoke it. Password is Padme123. Reuses it everywhere."

  - name: "Roy"
    domain: "sienar.local"
    machine: "SUBLVL-WS-02"
    company_role: "Reluctant Sysadmin"
    background: "Has been here since day one. Does the absolute minimum. Somehow holds the keys to everything."
    hobbies: ["avoiding work", "vintage synthesizers", "German football"]
    security_habits: "Domain Admin on everything. Password is password123. Has a script running as DA 'because it was the only way to make it work.'"

  - name: "Moss"
    domain: "sienar.local"
    machine: "SUBLVL-WS-03"
    company_role: "Network Engineer"
    background: "Brilliant but oblivious. Documents everything in plaintext. Built the entire network but never locked anything down."
    hobbies: ["Dungeons & Dragons", "building computers from scrap", "sea shanties"]
    security_habits: "passwords.txt on desktop with every credential he's ever used. Left an SMB share wide open 'for testing.' That was 3 years ago."

  - name: "Jen"
    domain: "sienar.local"
    machine: "SUBLVL-WS-04"
    company_role: "IT Manager"
    background: "Somehow got promoted to manage IT despite not understanding what IT does. Got the job because she 'has people skills.'"
    hobbies: ["shoes", "theatre", "pretending to understand computers"]
    security_habits: "Has DA from an HR onboarding error. Doesn't know she has it. Doesn't know what a firewall is. Clicks every link."

  - name: "Denholm"
    domain: "sienar.local"
    machine: "SUBLVL-WS-05"
    company_role: "VP Operations"
    background: "Old money. Inherited his position. Sends company-wide emails about 'cyber hygiene' while his password is on a sticky note."
    hobbies: ["yacht racing", "motivational speeches", "tax evasion"]
    security_habits: "Password on a sticky note: SienarRules2025!. Forwards suspicious emails to the entire company 'as a warning.'"

  - name: "Boba Fett"
    domain: "sienar.local"
    machine: "SUBLVL-WS-06"
    company_role: "Security Contractor (interim CISO)"
    background: "Hired as a 3-month interim CISO. It's been 18 months. Still has an intern badge. Actually competent but nobody listens to him."
    hobbies: ["bounty hunting", "jetpack maintenance", "Mandalorian history"]
    security_habits: "The only person who uses MFA. Wrote a 40-page security policy that nobody has read. Password is actually strong."

  # ── cygnus.sienar.local ───────────────────────────────────

  - name: "Admiral Piett"
    domain: "cygnus.sienar.local"
    machine: "CYG-WS-01"
    company_role: "IT Director (Cygnus)"
    background: "Ran Cygnus IT before the acquisition. Refuses to migrate to sienar.local out of principle. Runs shadow IT from his desk."
    hobbies: ["model Star Destroyers", "spreadsheets", "avoiding Vader"]
    security_habits: "Still has admin on the old Cygnus domain. Uses a completely separate password scheme. Keeps a local backup of everything 'just in case.'"

  - name: "Wedge Antilles"
    domain: "cygnus.sienar.local"
    machine: "CYG-WS-02"
    company_role: "Senior Engineer"
    background: "10-year veteran. Knows where all the bodies are buried. Quietly furious about the acquisition."
    hobbies: ["flight simulators", "open source advocacy", "homebrew beer"]
    security_habits: "Still has admin on old Cygnus file shares nobody decommissioned. SSH keys on 4 different servers."

  - name: "Jyn Erso"
    domain: "cygnus.sienar.local"
    machine: "CYG-WS-03"
    company_role: "Junior Engineer"
    background: "New hire. Asks too many questions. Has been poking around network shares she shouldn't have access to."
    hobbies: ["rock climbing", "lock picking", "rebellious graffiti"]
    security_habits: "Overly curious about classified project folders. Has been caught browsing the executive share 'by accident' twice."
```

---

## scenario_part3.yml — "The Build"

Plugin mapping (non-default software only), domain relationships, substitutions, verbose defaults.

Key rules:
- Only machines with non-default software get plugin entries — workstations, DCs, file servers are standard
- Each plugin entry has `label` (hostname hint), `plugin` (name), `plugin_id` (validated via MCP)
- Domain relationships are narrative context for the implementor (acquisition dynamics, org politics)
- Defaults are auto-calculated from company size + security posture — user can override any

```yaml
schema_version: 1

meta:
  name: "Sienar Fleet Systems — The Build"
  created: 2026-04-15
  canvas_id: null
  scenario_ref: "scenario_part1.yml"
  cast_ref: "scenario_part2.yml"

# ONLY machines that need non-default software.
# Workstations, DCs, file servers are standard platform roles.
plugin_mapping:
  - vlan: "Holonet Gateway"
    machines:
      - role: web_server
        label: "HOLO-WEB-01"
        plugin: "vuln-nostromo"
        plugin_id: "plg-abc123"
        note: "No IIS in catalog — Nostromo is closest HTTP vuln"
      - role: mail_relay
        label: "HOLO-MAIL-01"
        plugin: "postfix-mail-relay"
        plugin_id: "plg-def456"
      - role: vpn_gateway
        label: "HOLO-VPN-01"
        plugin: "openvpn-server"
        plugin_id: "plg-ghi789"

  - vlan: "Imperial Data Vault"
    machines:
      - role: db_server
        label: "VAULT-DB-01"
        plugin: "mssql-server"
        plugin_id: "plg-mssql"
      - role: app_server
        label: "VAULT-WIKI-01"
        plugin: "internal-wiki"
        plugin_id: "plg-wiki01"

# Business context between domains — narrative flavor for the implementor.
relationships:
  - from: "cygnus.sienar.local"
    to: "sienar.local"
    type: acquisition
    description: "Messy acquisition, engineers resistant to AD migration"

# Deviations from user's original request.
substitutions:
  - requested: "IIS web server"
    assigned: "vuln-nostromo"
    reason: "No IIS plugin in catalog. Nostromo provides similar HTTP vulnerability surface."

# Auto-calculated from company size + security posture. User can override any.
defaults:
  files_per_workstation: 15
  files_per_server: 8
  users_per_workstation: 1
  abandoned_profiles: 2
  default_technical_skill: mixed        # power_user | general_user | beginner | mixed
  default_filing_habits: mixed          # everything_on_desktop | organized_folders | minimal_files | mixed
  contractor_ratio: 15%
  network_policy: segmented             # flat | segmented | zero-trust
  dc_redundancy: 1
  workstation_server_ratio: 70/30
  ou_depth: 2
  security_groups_count: 12
  forest_event_count: 4
  relationship_density: moderate        # light | moderate | dense
  user_events_per_user: 3
  shared_events_per_vlan: 4
```

## Update Mode — Merge Semantics

When scenario files are used to update an existing canvas:

| Top-Level Key | Behavior |
|---------------|----------|
| `company` | **Merge** — present fields update, absent fields untouched |
| `defaults` | **Merge** — present fields override, absent fields keep current |
| `characters` | **Replace** — if present, full character regeneration |
| `domains[]` | **Match by FQDN** — present domains updated, absent untouched, new FQDNs added |
| `domains.trusts[]` | **Replace** — if present, all trusts rewritten |
| `vlans[]` | **Match by name** — present VLANs updated, absent untouched, new names added |
| `vlans[].machine_count` | **Delta** — if VLAN exists and count differs, add/remove machines to match |
| `plugin_mapping[]` | **Match by vlan + role** — present mappings updated, absent untouched |
| `characters[]` (part2) | **Replace** — if present, full character regeneration |

To delete a VLAN or domain, use the `delete: true` marker:
```yaml
vlans:
  - name: "Old DMZ"
    delete: true
```