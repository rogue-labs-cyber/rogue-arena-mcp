# Scenario YML Schema Reference

> **For:** architect-brainstorm (loaded JIT when writing YML files)
> **Purpose:** Examples and guidance for the four brainstorm output files

The brainstorm produces four files:

| File | Nickname | Gate | Contents |
|------|----------|------|----------|
| scenario_part1.yml | "The Shape" | Gate 1 | Company, domains with nested VLANs, machine roles |
| scenario_part2.yml | "The Cast" | Gate 2 | Characters with backgrounds, hobbies, security habits |
| scenario_part3.yml | "The Build" | Gate 3 | Plugin mapping, domain relationships, substitutions, defaults |
| exploit.yml | "The Heist" | Gate 4 | Crown jewels, attack paths, phases |

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
- No `exploit_paths`, no `defaults`, no `plugin_mapping` — those belong in later files
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

---

## exploit.yml — "The Heist"

Fully self-contained exploit plan. The brainstorm declares EVERYTHING the attack chain needs — users, passwords, file locations, technique chain, breadcrumbs. The implementor's job is pure execution: build exactly what this file says.

Key rules:
- Crown jewels reference VLANs from part1
- Paths use real technique names from the platform's exploit technique catalog (validated via MCP)
- Machine flow uses hostnames/labels from part1 and part3
- Reachability between hop pairs verified via MCP before writing
- Characters from part2 explain WHY each vulnerability exists
- **Credentials are declared in this file** — username, password, where they live, who finds them, who uses them. The implementor creates these users on top of the part2 cast and seeds the credential locations exactly as specified.
- **No "implementor figures it out" fields** — the brainstorm + user own every detail

```yaml
schema_version: 1

meta:
  name: "Sienar Fleet Systems — Attack Paths"
  created: 2026-04-15
  canvas_id: null
  scenario_ref: "scenario_part1.yml"

crown_jewels:
  - name: "Project Phantom Schematics"
    vlan: "Imperial Data Vault"
    type: data_repository
    description: "Classified next-gen stealth fighter prototype files on the file server — $200M Imperial contract dependent on IP confidentiality"

# All accounts the exploit chain requires. These are created on top of
# the part2 character cast. Some may overlap with cast members (e.g.,
# Jen's domain user) — list them here regardless so the chain is self-contained.
exploit_users:
  - id: "user-fred-ftp"
    domain: "sienar.local"
    username: "fred"
    password: "Password123"
    samaccountname: "fred"
    groups: ["Domain Users"]
    description: "Service account Ryan created for FTP backups, never disabled"
    overlaps_with_cast: false

  - id: "user-jen-sublvl"
    domain: "sienar.local"
    username: "jen"
    password: "Photoshop2019!"
    samaccountname: "jen"
    groups: ["Domain Users", "SUBLVL-WS-04 Local Admins"]
    description: "Jen's domain account — also local admin on SUBLVL-WS-04 from Photoshop install"
    overlaps_with_cast: true              # Jen is in part2

# All credentials referenced by hops. Each has a discovery point (where
# the attacker finds it) and a use point (which hop consumes it).
credentials:
  - id: "cred-hop1-fred-password"         # server-generated ref: cred-hop{N}-{account}-{sub}
    user_ref: "user-fred-ftp"
    type: password                         # password | hash | ticket | key
    discovered_at_hop: 1
    used_at_hop: 2
    discovery_location:
      machine: "HOLO-FTP-01"
      file_path: "/opt/ftp/sync.conf"
      content_hint: "USER=fred\nPASS=Password123  # for nightly backups - Ryan H., 2019"

  - id: "cred-hop3-jen-password"
    user_ref: "user-jen-sublvl"
    type: password
    discovered_at_hop: 3
    used_at_hop: 4
    discovery_location:
      machine: "SUBLVL-WS-04"
      file_path: "C:\\Users\\jen\\Desktop\\photoshop_install_notes.txt"
      content_hint: "domain login: jen / Photoshop2019! (saved so I dont forget)"

paths:
  - name: "The Phantom Heist"
    difficulty: hard
    entry: external
    includes_phishing: true
    phishing_target_vlan: "The Sub-Level"
    target_crown_jewel: "Project Phantom Schematics"
    reachability_verified: true
    narrative: |
      Attacker compromises the FTP server in the DMZ, finds Fred's
      hardcoded backup creds, pivots to Jen's workstation, dumps her
      Photoshop install note with her domain password, uses cross-domain
      trust to reach Cygnus, then exfils Project Phantom schematics.

    hops:
      - hop: 1
        source_machine: "external"
        target_machine: "HOLO-FTP-01"
        technique: "vsftpd_backdoor"          # from architect_exploit_technique_list
        implementation_type: plugin           # plugin | attacker_action | file_seeding
        privilege: "none → local_user"
        trust_boundary_crossed: null          # TrustBoundaryCrossingEnum value or null
        hop_environment_zone: "dmz"           # dmz | internal | isolated | air_gapped
        narrative_context: "Ryan set up FTP during the 2019 acquisition integration rush (cites architect_forest_get_events.trustHistory) and hardcoded backup creds per his known habit of prioritizing speed over security (cites architect_machine_get.backstory.securityHabits for ryan)"
        character_sam_account_name: "ryan"    # soft ref to scenario_part2 character
        credential_discovers: "cred-hop1-fred-password"   # ref is server-generated (cred-hop{N}-{account}-{sub})

      - hop: 2
        source_machine: "HOLO-FTP-01"
        target_machine: "SUBLVL-WS-04"
        technique: "make_token"
        implementation_type: attacker_action
        privilege: "local_user → local_admin"
        trust_boundary_crossed: null
        hop_environment_zone: "internal"
        narrative_context: "Fred's account retains local admin on Sub-Level workstations from old IT provisioning scripts that were never cleaned up (cites architect_machine_get.backstory.securityHabits for fred)"
        character_sam_account_name: "fred"
        credential_uses: "cred-hop1-fred-password"

      - hop: 3
        source_machine: "SUBLVL-WS-04"
        target_machine: "SUBLVL-WS-04"       # same machine, file discovery
        technique: "credentials_in_share"
        implementation_type: file_seeding
        privilege: "local_admin → local_admin"
        trust_boundary_crossed: null
        hop_environment_zone: "internal"
        narrative_context: "Jen saves her domain password in a desktop note 'so she doesn't forget' — documented in scenario_part2 security_habits (cites architect_machine_get.backstory.securityHabits for jen)"
        character_sam_account_name: "jen"
        credential_discovers: "cred-hop3-jen-password"

      - hop: 4
        source_machine: "SUBLVL-WS-04"
        target_machine: "CYG-WS-01"
        technique: "make_token"
        implementation_type: attacker_action
        privilege: "local_admin → domain_user"
        trust_boundary_crossed: child_to_parent   # TrustBoundaryCrossingEnum
        hop_environment_zone: "internal"
        narrative_context: "Bidirectional trust was never hardened after the Cygnus acquisition — cites architect_forest_get_events.trustHistory for the sienar.local / cygnus.sienar.local parent-child trust"
        character_sam_account_name: "jen"
        credential_uses: "cred-hop3-jen-password"

      - hop: 5
        source_machine: "CYG-WS-01"
        target_machine: "VAULT-FS-01"
        technique: "credentials_in_share"
        implementation_type: file_seeding
        privilege: "domain_user → domain_user"
        trust_boundary_crossed: null
        hop_environment_zone: "internal"
        narrative_context: "Roy is the only person who knows where the files are and left the share open — cites architect_machine_get.backstory.securityHabits for roy (open SMB share 'for testing')"
        character_sam_account_name: "roy"
        credential_uses: "cred-hop3-jen-password"

# Discovery breadcrumbs — files placed during build to guide students
breadcrumbs:
  - hop: 1
    machine: "HOLO-FTP-01"
    file: "/opt/ftp/sync.conf"
    purpose: "Reveals fred's creds + lateral movement target"
  - hop: 3
    machine: "SUBLVL-WS-04"
    file: "C:\\Users\\jen\\Desktop\\photoshop_install_notes.txt"
    purpose: "Reveals jen's domain creds for cross-VLAN pivot"
```

**Mapping note:** The YAML field `narrative_context` on each hop maps to `ExploitPathHop.narrativeContext` at implementor write-time. The `character_sam_account_name` field is a soft reference to a character in `scenario_part2.yml` — resolved by samAccountName match at read time against `architect_machine_get_users` output. There is no FK constraint on this field. `credentialRef` values in the `credentials:` and `credential_discovers` / `credential_uses` fields are server-generated — you declare the account + hop, the server picks the ref.

---

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
| `exploit_paths` | **Replace** — if present, re-plan exploits |

To delete a VLAN or domain, use the `delete: true` marker:
```yaml
vlans:
  - name: "Old DMZ"
    delete: true
```