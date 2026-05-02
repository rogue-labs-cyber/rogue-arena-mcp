# Phase 3 — Online Research

For each selected category or free-text prompt, produce a ranked list of techniques with current detection coverage.

## Source Priority

**Prefer Atomic Red Team first.** ART provides executable YAML atomics with literal shell commands, input arguments, and cleanup — already machine-executable. Parsing rules, URL pattern, YAML schema, and a worked T1003.001 example live in `refs/art-adapter.md`. Read that ref before fetching ART YAML.

**Secondary sources** (for technique context, detection coverage, and techniques without ART coverage):

- MITRE ATT&CK — canonical technique descriptions, sub-techniques, MITRE IDs
- Elastic Security detection rules — rule IDs that cover the technique
- Sigma rules — rule IDs + log sources
- CAR analytics (MITRE Cyber Analytics Repository)
- DFIR Report — timeline-accurate intrusion walkthroughs
- LOLBAS / GTFOBins — living-off-the-land binaries
- ired.team, HackTricks, Red Team Notes — technique mechanics
- SpecterOps blogs, Unit42, Mandiant, CrowdStrike, Volexity reports — modern variations

## Research Flow

1. **Search** — `WebSearch` across the sources above, scoped by technique name and MITRE ID
2. **Fetch** — `WebFetch` on the most relevant results for detail extraction
3. **Atomic check** — for each candidate technique, probe for an ART YAML. If one exists, prefer its commands.
4. **Compile** — ranked list with the fields below

## Technique Output Format

Each technique rendered as:

| Field | Description |
|-------|-------------|
| **Name** | Technique name |
| **MITRE ID** | ATT&CK ID (e.g., T1053.005) if applicable |
| **Description** | One-line summary |
| **Source** | ART / MITRE / Sigma / blog URL — cite the source used |
| **Detection rule IDs** | Concrete rule IDs: Elastic `<uuid>`, Sigma `<filename.yml>`, Sysmon `EventID:N`. If none found, mark "unverified." |
| **Complexity** | Simple / Moderate / Advanced |
| **Shell-executable** | Yes / Partial / No — can it run entirely via `deployment_run_script`? |

Flag non-shell-executable techniques: "This one needs manual execution or a C2 — I'll include reference docs but can't run it for you."

## Ranking Rules

- Shell-executable techniques rank above Partial/No
- Techniques with concrete detection rule IDs rank above "unverified"
- Newer techniques (post-2024 variations) rank above stale ones

Ask the user to pick by number, range ("3-7"), or "all".
