# Shared Rules & Constants
These rules apply to ALL bpData generation. Load this file first before any other reference.

> **Build cascade:** For the full data flow diagram and tier-by-tier tool reference, see the root orchestrator skill (`rogue-build-scenario`).

## Content Appropriateness (Mandatory)
- This is a professional cybersecurity training platform
- ALL content must be appropriate for workplace/educational settings
- FORBIDDEN: Sexual content, adult themes, explicit material
- FORBIDDEN: References to escort services, "pleasure" industries
- Red Rising universe: Pinks may appear ONLY as diplomats, administrators, or protocol officers — NEVER in sexual/companion contexts
- When in doubt, choose a different industry, department, or role

## Infrastructure Philosophy
ALL companies use MODERN ENTERPRISE IT INFRASTRUCTURE regardless of fictional setting:
- Modern identity management (Active Directory)
- Contemporary databases, web servers, applications
- Standard networking (VLANs, firewalls, VPNs)
- Current cybersecurity practices

Fictional scenarios: Department NAMES/THEMES can be fictional, but IT INFRASTRUCTURE is ALWAYS modern enterprise.

## Domain Suffix Rule
All AD domains MUST use the `.local` suffix (e.g., `company.local`, `dev.company.local`) unless explicitly specified as WORKGROUP or NONE.

## Company Size Limits

| Property | Small | Mid | Large | Enterprise | Enterprise Jumbo |
|---|---|---|---|---|---|
| Machines | 3–8 | 8–20 | 15–40 | 30–80 | 60–150 |
| Users | 5–25 | 30–100 | 100–500 | 500–2000 | 2000–10000 |
| Domains | 1–1 | 1–2 | 1–3 | 2–5 | 3–10 |
| Require DMZ | No | No | Yes | Yes | Yes |
| DMZ Machines | 0–0 | 0–2 | 2–5 | 3–8 | 5–15 |
| Departments | 2–4 | 4–8 | 6–10 | 8–12 | 10–15 |
| OUs | 6–12 | 12–24 | 20–40 | 30–60 | 50–100 |
| Security Groups | 3–16 | 8–30 | 12–50 | 20–80 | 30–120 |
| Fake Computers | 9–24 | 15–45 | 24–75 | 36–105 | 45–150 |

Default size when unspecified: **mid**.

## Large Generation Confirmation Gate

Before generating output that will be large or time-consuming, PAUSE and confirm with the user. Do not silently produce massive structured data.

### When to Confirm

| Trigger | Example | What to Say |
|---------|---------|-------------|
| CSV param with 20+ expected rows | DC CreateUsers plugin for a Mid+ company | "This DC serves ~75 users — I'll generate a CSV with ~75 rows of user data (names, titles, departments, group memberships). This takes a moment. OK to proceed?" |
| bpData with 50+ entities | Canvas character pool, large AD OU structure | "I'm about to generate ~80 fictional characters with full trait profiles. This is a large generation. OK?" |
| File manifest across 5+ machines | File seeding for a full VLAN | "I'll generate file manifests for 8 machines (~100+ file entries with rich topics). This will take a while. Want me to proceed, or do a subset first?" |
| Relationship generation for 10+ users | Full relationship weave across 2+ VLANs | "There are 14 assigned users across 2 VLANs. I'll generate relationships + collaborative file artifacts for all of them. OK to proceed?" |
| Forest events for 3+ domains | Multi-domain forest with backstories and cross-domain relationships | "This forest has 4 domains — I'll generate 6+ forest events with backstories, domain portraits, and cross-domain relationships. OK?" |
| Exploit chain with 5+ hops | Multi-hop lateral movement path across VLANs | "This exploit path has 7 hops across 3 VLANs with credential chains and breadcrumbs at each hop. This is a large generation. Proceed?" |

### How to Confirm

1. State WHAT you're about to generate and roughly HOW MUCH
2. State WHY it will be large (company size, user count, machine count)
3. Ask if the user wants to proceed, do a subset, or adjust scope
4. If the user says "just do it" or "go for it," proceed without asking again for the remainder of that tier

### Do NOT Confirm For

- Small generations (< 20 CSV rows, < 5 machines, < 30 characters)
- Re-runs of previously approved scope
- Operations the user explicitly requested at that scale
- Single-domain forest events (bounded, not large)
- Exploit chains with fewer than 5 hops

## Server/Workstation Ratio (Critical)
- Small company (10–25 users): 70% workstations, 30% servers
- Medium company (25–100 users): 75% workstations, 25% servers
- Large company (100+ users): 80% workstations, 20% servers

Do NOT deploy more servers than workstations — this is unrealistic!

## Domain Controller Budget
- 1 DC per domain: Small scenarios (< 20 VMs total)
- 2 DCs per domain: Medium scenarios (20–100 VMs total)
- 3 DCs per domain: Large scenarios ONLY (100+ VMs total)

Reserve 75–80% of VMs for workstations; DCs + servers should use <= 25% of total VM budget.

## Resource Allocation Defaults

| Machine Type | RAM | CPU Cores | Trigger |
|-------------|-----|-----------|---------|
| Domain Controllers | 2 GB | 2 | Machine is a DC |
| Servers | 2 GB | 2 | Default for non-workstation machines |
| Workstations | 1 GB | 2 | Machine role is workstation |
| User-controllable | 6 GB | 4 | `isUserControllable = true` |

Disk defaults: DCs and servers get 60 GB; workstations and other machines get 40 GB.

Some plugins may auto-set higher RAM/CPU on installation. Check `architect_canvas_get_budget` for actual usage.

## Hostname Rules (Critical)
- Total hostname length MUST be <= 15 characters (NetBIOS limit for Windows)
- ALWAYS abbreviate location names to 3–4 characters (SPRINGFIELD -> SPR, CORUSCANT -> COR)
- Formula: PREFIX (3–4) + TYPE (2–4) + NUMBER (2–3) = <= 15 total
- Each domain gets ONE consistent naming pattern
- Servers and workstations MUST use the same base pattern within a domain
- ALL hostnames MUST be globally unique (no duplicates across domains)
- Only the type code changes between servers/workstations in same domain

### Hostname Pattern Examples
1. Location prefix: `spr-dc1`, `spr-ws01`
2. Asset tag style: `sprdc410001` (location + type + building + serial)
3. Condensed: `SPRDC01` (no separators, all caps)
4. Functional: `electro-dc1` (company prefix)
5. Industry-specific: `mvhdc01` (hospital), `acmenydc1` (finance)

## IP Addressing Strategy
- Unique Class C per VLAN (`192.168.X.0/24`, X = 10–254)
- Gateway ALWAYS at `.1`
- DHCP range: `.50`–`.254`
- Static reserve: `.1`–`.49`
- Primary DC: `.10`, Secondary: `.11`, Tertiary: `.12`
- Application Servers: Start at `.20`, increment sequentially
- Workstations: Start at `.50`, increment sequentially

## Server File Paths

### Windows Servers
- `C:\Scripts` — Admin scripts
- `C:\Admin` — Admin documentation
- `C:\Logs` — Log files
- `C:\inetpub\wwwroot` — IIS web content
- `D:\Backups` — Database/app backups
- `D:\SQLLogs` — SQL Server logs
- `E:\Shares` — File shares

### Linux Servers
- `/var/www/html` — Web content
- `/opt/scripts` — Admin scripts
- `/var/log` — System/service logs
- `/etc` — Configuration files
- `/mnt/backups` — Backup files

## Workstation File Paths (OS-Specific)
- Windows: `C:\Users\{username}\Desktop\`, `C:\Users\{username}\Documents\`, `C:\Users\{username}\Downloads\`
- Linux: `/home/{username}/Desktop/`, `/home/{username}/Documents/`
- macOS: `/Users/{username}/Desktop/`, `/Users/{username}/Documents/`

## Past Admin Echoes (Historical Depth)
Machines should feel lived-in, not freshly imaged. Create layered history from multiple users and time periods:
- Old log files referencing previous admins' usernames and activity timeframes
- Stale scripts with former admins' names in comments (use names from the assigned user list or character pool, NEVER "John Doe")
- Archived config exports dated from previous admins' tenures
- Abandoned project folders from completed or canceled initiatives
- Old documentation from a previous IT era (e.g., migration guides, decommission notes)

The machine should tell a story of who has been here and what they did over time.

## Industry Inference Rules (Critical)
- Infer industry from the USER'S ACTUAL PROMPT, not from universe stereotypes
- Red Rising can be Mining, Military, Biotechnology, Entertainment, Government, Medical
- Star Wars can be Military, Logistics, Entertainment, Government, Technology, Education
- DO NOT always default to the obvious (not all Star Wars = Military, not all Red Rising = Mining)
- DO NOT use generic industries (trade, logistics) that work in ANY universe
- Prioritize what makes the universe UNIQUE over generic business types

## Department Requirements

**Always Required:** IT/Technology, Finance/Accounting, HR/Personnel

**Add as size permits:** Operations, Sales/Marketing, Legal, Facilities

**For fictional scenarios:** Department NAMES/THEMES can be fictional (e.g., "Obsidian Security Corps"), but function must map to standard enterprise roles.

### Headcount Math (Critical)
- Department `estimatedHeadcount` values MUST sum to `constraints.maxUsers` (+/-5% tolerance)
- Example: If maxUsers is 1200, department headcounts must sum to 1140–1260
- Business units (in corporateStructure) are ORGANIZATIONAL GROUPINGS that OVERLAP with departments
- Do NOT treat business unit employees as ADDITIONAL to department employees
- Every employee belongs to exactly ONE department, but may work in multiple business units

**Headcount Example (1200 employees):**
IT: 200, Finance: 150, HR: 100, Sales: 250, Legal: 50, Operations: 200, Engineering: 250 = 1200

### Quality Requirements
- Name: 3+ characters
- Description: min 50 chars, combining what the department does AND its purpose
- Function: min 30 chars
- Key Responsibilities: 2–6 items, 10+ chars each

- BAD: "IT department handles technology"
- GOOD: "IT Infrastructure team manages Active Directory, network security, endpoint protection, and EMR system administration for 450-bed hospital. Responsible for 24/7 uptime of critical medical systems and HIPAA compliance."

## Account Type Separation (Enforced)
- Regular accounts (`accountType: "regular"`) -> Workstations ONLY
- Admin accounts (`accountType: "admin"`) -> Servers ONLY
- Example: `jane.smith` (regular) gets workstation, `jane.smith.sa` (admin) gets server access
- Each workstation gets exactly ONE primary user
- Each user gets at most ONE primary workstation
- Multiple admins can share server access

## File Content Richness (Critical)

### PowerPoint (.pptx)
- 4–8 bullet points per slide (NOT 1–2!)
- Nested sub-bullets (2–3 sub-items under main bullets)
- Each bullet: complete thought (10–30 words)
- 5–12 slides per presentation
- Mix content blocks: bullets + text paragraphs + stat callouts
- Vary themes: professional-blue, modern-orange, elegant-purple, minimal-black

### Spreadsheet (.xlsx/.csv)
- 20–100+ rows (NOT just 5–10!)
- Realistic variety in data
- Calculated columns with formulas if appropriate
- Mix data types (text, numbers, dates, booleans)

### Document (.docx/.pdf)
- Multiple heading levels (H1, H2, H3)
- 5–15 paragraphs with substantial content
- 3–8 sentences per paragraph
- Lists, tables, varied formatting

Make content feel HUMAN-CREATED, not AI-generated.

## VLAN Zone Classification

Every VLAN is assigned a zone. Zones drive firewall posture, trust direction, and domain membership rules. Priority order when multiple conditions match: `dmz` > `management` > `isolated` > `internal` (default).

| Condition | Zone | Flags |
|---|---|---|
| Internet-facing services or external access | `dmz` | `isDmzZone: true` |
| Administrative / privileged operations, bastion hosts | `management` | -- |
| Air-gapped or highly restricted connectivity | `isolated` | `shouldBeIsolated: true` |
| Standard business operations (default) | `internal` | -- |
| Domain controllers or domain-joined machines | (any zone) | `shouldBeADDomainEnabled: true` |

**DMZ domain membership** is posture-dependent: HARDENED = standalone/workgroup only; STANDARD = may be domain-joined; NEGLECTED = likely domain-joined (never enforced separation).

Zones are set once by the domains skill when the VLAN is created. Enrichment does not re-assign zones — if a VLAN has no zone set, halt and ask the user to pick one.

## Domain Relationship Vocabularies

Two independent axes describe how domains relate. A single forest relationship (e.g., `acquisition`) can pair with any AD trust direction.

- **`CrossDomainRelationshipType`** — business/forest relationship. Written by the domains skill via `architect_forest_manage`.
- **`BlueprintDomainTrustEnum`** — AD trust direction at the network wiring layer. Written by the enrichment skill via `architect_vlan_manage_connection`.

### CrossDomainRelationshipType

| Value | Business Meaning |
|---|---|
| `trust` | Explicit AD trust relationship (selective, forest, external) declared by the organization |
| `acquisition` | Domain exists because of a corporate acquisition; often legacy naming and culture |
| `partnership` | Domains collaborate on shared business goals as peers |
| `shared_services` | One domain provides services (IT, HR, billing) consumed by another |
| `parent_child` | Parent-child domain relationship in the AD tree |
| `sibling` | Peer domains under the same parent |

### BlueprintDomainTrustEnum

| Value | AD Trust Direction |
|---|---|
| `none` | No domain trust (different forests, non-AD VLANs) |
| `they_trust_us` | Target trusts source (one-way outbound from source's perspective) |
| `we_trust_them` | Source trusts target (one-way inbound from source's perspective) |
| `bidirectional` | Mutual trust (two-way) |

### Default AD Direction Per Business Relationship

| CrossDomainRelationshipType | Default BlueprintDomainTrustEnum |
|---|---|
| `parent_child` | child trusts parent (outbound) |
| `acquisition` | acquired trusts acquirer (outbound) |
| `partnership` | `bidirectional` |
| `trust` | `bidirectional` |
| `shared_services` | `bidirectional` |
| `sibling` | `bidirectional` |

NOTE: `architect_forest_get_domain_trusts` currently returns `trustDirection: 'bidirectional'` for all forest-event-derived trusts. Trust direction data may be inaccurate for acquisitions and parent_child relationships.

## Security Posture

Security posture is an enum on the company profile that shapes AD organization, password distribution, naming consistency, DMZ behavior, and VLAN purpose text.

| Value | Meaning |
|---|---|
| `CHAOTIC` | Organizationally chaotic — flat OUs, inconsistent naming from different eras, orphaned groups, broad trusts, minimal segmentation |
| `NEGLECTED` | Under-resourced IT — partially consistent, mix of naming conventions, one-time-project groups never deleted |
| `STANDARD` | Default. Functional but imperfect. Reasonable organization, minor cosmetic inconsistencies, some legacy objects |
| `HARDENED` | Tiered admin model, least-privilege, deep OU nesting, PAW infrastructure, clean hierarchy, audit-friendly naming |
| `FORTRESS` | Strict tiered model, application whitelisting, constrained language mode, LAPS, micro-segmentation, host-based IDS |

### Posture Effects

**Password distribution:**

| Posture | Weak | Medium | Strong |
|---------|------|--------|--------|
| CHAOTIC / NEGLECTED | 50-60% | 30-35% | 10-15% |
| STANDARD | 30% | 40% | 30% |
| HARDENED / FORTRESS | 10% | 30% | 60% |

Each user gets a unique 10-character password. Weak examples: "Summer2024!", "Changeme1". Strong examples: "kX9#mP2$vL7!".

**AD organization quality:** See the table above. Flat/orphaned for chaotic; strict tiered for hardened.

**DMZ domain membership:** HARDENED = standalone/workgroup only; STANDARD = may be domain-joined; NEGLECTED = likely domain-joined.

**VLAN purpose text:**
- **NEGLECTED/CHAOTIC**: Describe specific concrete problems — poorly maintained, undocumented, flat segmentation, orphaned configs.
- **STANDARD**: Functional but imperfect. Mention one specific gap or pragmatic shortcut unique to the company.
- **HARDENED/FORTRESS**: Defense-in-depth — application whitelisting, constrained language mode, LAPS, micro-segmentation, host-based IDS.

**Naming consistency:** chaotic = multiple conventions coexist; neglected = partial consistency with outliers; standard = one clear pattern; hardened/fortress = strict documented standards.

Mentioning "red team" alone does NOT trigger chaotic — the company itself must be organizationally chaotic.

## Haiku Subagent Dispatch Pattern

All bulk narrative content and bulk CSV content is generated by subagents, not inline in the orchestrator. The orchestrator handles workflow (reading state, deciding what to build, calling MCP tools); subagents handle bpData and CSV generation.

Use the Agent tool with `model: "haiku"`. Every dispatch MUST contain these 4 components:

1. **Objective** — one sentence stating what to generate and which tool call will consume it.
2. **Output format** — exact shape expected (JSON schema, CSV headers, or "raw string only — no prose, no code fences").
3. **Tool guidance** — "Read `${CLAUDE_SKILL_DIR}/../refs/shared-rules.md` first." Include any per-skill refs as additional Read targets.
4. **Task boundaries** — what the subagent must NOT do (no tool calls beyond Read, no explanation, no markdown fences when a raw string is requested).

**Canonical template shape:**

```
Agent tool:
  description: "<1-line purpose>"
  model: "haiku"
  prompt: |
    You are generating <bpData|CSV|...> for <tool call name>.

    Step 1: Read these reference files (use the Read tool):
    - ${CLAUDE_SKILL_DIR}/../refs/shared-rules.md
    - <any per-skill refs>

    Step 2: Use this context:
    <context>
      <per-skill context block — company, VLAN, user archetype, schema, row count, etc.>
    </context>

    Step 3: Generate <output> following the rules in shared-rules.md and the
    per-skill guidance in the context block. Return ONLY <JSON|raw CSV|...> —
    no explanation, no markdown fences.
```

Each skill customizes the per-skill context block and the Step 3 instructions, but the 4 components above are non-negotiable.

## Default Tool Discovery

All Rogue Arena MCP tools are pre-loaded at session start — no `discover_tools` call is needed for the common set. Call MCP tools directly by name.

When calling multiple MCP tools in sequence, batch-fetch their schemas with a single `ToolSearch(select: tool1,tool2,tool3)` call rather than fetching one at a time.

**Specialty extras (loaded by the sub-skill that needs them):**

- exploits: `discover_tools(category: "ROGUE_ARCHITECT_BUILDER", subcategory: "exploit")` for exploit technique list, hop, credential, reachability, journal, crown jewel.
- debug-deploy: `discover_tools(category: "ROGUE_ARCHITECT_BUILDER", subcategory: "deploy")` for the 6 LIVEDEPLOY tools.

## Industry Regulatory Frameworks

Regulated industries shape everything downstream — AD structure, file content, audit logging, segmentation.

| Industry | Frameworks | What It Drives |
|----------|-----------|----------------|
| Healthcare | HIPAA | Clinical data segmentation, audit logging, breach notification |
| Finance | SOX, PCI-DSS | Separation of duties, transaction logging, access reviews |
| Defense/Gov | ITAR, CMMC, FedRAMP | Data classification, CUI handling, supply chain security |
| Education | FERPA | Student record protection, access controls |

For regulated industries, at least ONE `currentChallenge` must reference a specific regulatory framework — not generic "regulatory requirements" but specific like "Failed PCI-DSS assessment on network segmentation."

### Industry-Specific Infrastructure

Realism assessment expects industry-specific systems to be present:

| Industry | Expected Systems |
|----------|-----------------|
| Healthcare | EMR/EHR system, PACS server, patient portal, pharmacy system |
| Finance | Trading systems, risk management, compliance monitoring |
| Legal | Document management, case management, e-discovery |
| Manufacturing | SCADA/HMI, inventory management, quality systems |
| Education | Student information system, LMS, library catalog |

## Character Generation

### Prominence Distribution

Characters are scored 1-10 by prominence and MUST be sorted descending.

| Score | Role | Target % |
|-------|------|----------|
| 9-10 | C-suite, founders | ~5% |
| 7-8 | Directors, managers | ~10% |
| 5-6 | Senior ICs | ~20% |
| 3-4 | Regular employees | ~30% |
| 1-2 | Entry-level, support | ~35% |

### Trait Archetypes

Assign ONE primary archetype per character; spread evenly (max 3 per archetype per batch of 20):

1. **behavioral_habit** — defined by something they always/never do
2. **contradiction** — two incompatible qualities coexist
3. **social_effect** — defined by how they make others feel
4. **irrational_belief** — holds a baffling conviction
5. **specific_obsession** — knows one topic to encyclopedic depth
6. **relationship_role** — the position they fill in office dynamics
7. **sensory_quirk** — physical mannerism or spatial habit
8. **dark_undertone** — something melancholy, unsettling, or grim

**Quality test:** Traits describe the PERSON, not the job. If it could appear on a LinkedIn profile, it is not a personality trait. Low-prominence characters (1-4) are office legends — give them the most vivid traits.

### Company Naming Strategies

| Strategy | Example |
|---|---|
| Geographic | Tidewater Marine Engineering |
| Founder-based | Morrison & Sons |
| Mythology / wordplay | Cobalt Dynamics |
| Industry jargon | Sovereign Mining Consortium |
| Evocative | Hyperion Logistics Syndicate |

The name should reflect the specific industry and be memorable in conversation.

## File Seeding Categories

### Per-Machine File Targets

Total file entries on the machine — not per user. Workstations usually have one primary user, so per-machine and per-user line up; servers and DCs are per-machine regardless of how many admin accounts share the machine.

| Machine Type | Files Per Machine |
|---|---|
| Workstation | 10-18 |
| Server | 5-10 |
| Domain Controller | 5-10 |
| Local / utility | 3+ |

### Filing Habit Archetypes

| Habit | Desktop | Downloads | Documents | Naming Style |
|---|---|---|---|---|
| `everything_on_desktop` | 80% | 15% | 5% | Unclear: `doc1.docx`, `final_FINAL_v3.xlsx` |
| `organized_folders` | Shortcuts only | Emptied regularly | Nested: `Work/Projects/Q4-Launch/...` | Clear with dates |
| `minimal_files` | Almost nothing | A few recent items | 8-12 files total | Cloud-first, few local files |

### File Category Distribution

| Machine Role | Business | Personal | System | Notes |
|---|---|---|---|---|
| Workstation | 50% | 25% | 25% | System = browser data, email artifacts, app configs |
| Server | 20% | 0% | 80% | Business = admin docs left by the admin |
| Domain Controller | 10% | 0% | 90% | System = AD scripts, GPO exports, audit logs |

### Date Decay Distribution (4-Tier)

| Tier | Days Ago | Percentage |
|------|----------|------------|
| Current | 0-7 | 30% |
| Recent | 8-30 | 40% |
| Older | 31-90 | 20% |
| Archive | 91-365 | 10% |

At least 1 file must have `lastModifiedDaysAgo` > 180. The full range 0-365 must be represented. Every workstation manifest includes 1-2 email artifacts (OST, PST, or saved .eml).

## Backstory Event Categories

7 event categories: security incidents, compliance audits, system migrations, personnel changes, business milestones, process failures, organizational restructuring.

Sentiment distribution across events: 40% routine / 40% positive / 20% negative. Not every event is a crisis.

## Common Port Mappings

| Service | Ports |
|---|---|
| AD / Kerberos | 88, 389, 636, 3268, 3269 |
| DNS | 53 (tcp/udp) |
| SMB | 445 |
| RDP | 3389 |
| SSH | 22 |
| Web | 80, 443 |
| Database | 1433 (SQL Server), 3306 (MySQL), 5432 (PostgreSQL) |

## AD Structure Conventions

**OU hierarchy** — Always list parent OUs before children. Standard top-level: `Users`, `Computers`, `Groups`, `ServiceAccounts`, `Admins`. Department OUs nest under Users (e.g., `OU=IT,OU=Users`).

**Security group tiering** — Use scope prefixes (`GG-` Global, `DL-` DomainLocal, `UG-` Universal). Implement Tier 0/1/2 nesting: Tier 0 = DCs + AD infra, Tier 1 = member servers, Tier 2 = workstations + help desk. Mark admin-granting groups clearly in name and description.

**Service accounts** — Place in dedicated `OU=ServiceAccounts`. Name clearly: `svc-sql-prod`, `svc-backup-agent`. Assign SPNs for Kerberos-enabled services.

**Username patterns:** Primary `firstname.lastname`. Service accounts: `svc-{app}-{role}`. Admin accounts: pick ONE convention per company (`firstname.lastname.sa` or `a-firstname.lastname`). All users in a company follow the same pattern.

**Domain naming:** Single domain `company.local`, parent-child `{subdomain}.company.local`, resource forest `{function}.company.local`.

## Windows Ansible Failure Patterns

| Pattern | What It Means |
|---------|--------------|
| `Start-Service : Cannot find any service with service name` | Service installation failed silently (check for `.exe` calls) |
| `Access is denied\|PermissionDenied\|ACCESS_DENIED` | Permission or credential issue |
| `Cannot find path\|ObjectNotFound\|path does not exist` | Missing file or directory |
| `win_.*:.*failed\|The term '.*' is not recognized` | Ansible module failure |
| `The specified network password is not correct\|computer account already exists` | Domain join issue |
| `WinRM.*connection\|connection refused\|connection timed out` | WinRM connectivity issue |

## Raw Prompt Reference
Always cross-check the original user request for hard requirements such as explicit counts, naming conventions, OU paths, or domain preferences. If structured context conflicts with the prompt, explain the discrepancy and state which source you honored.
