# Workspace Layout

Canonical directory structure for the skill. Create directories on demand — don't pre-create empty ones.

## Root

Workspace root resolved via `refs/phase-1-gates.md` (`rogue_workspace` from CLAUDE.md, default `~/RogueLabsClaude/`).

## Per-deployment tree

```
{ROGUE_WORKSPACE}/deployments/{deployment-name}/
├── techniques/
│   ├── persistence/
│   │   ├── T1053.005-scheduled-tasks.md
│   │   └── T1547.001-registry-run-keys.md
│   ├── credential-access/
│   ├── lateral-movement/
│   └── ...
├── tools/
│   ├── loader-v1/
│   │   └── my-loader.exe
│   ├── loader-v2/
│   │   └── my-loader.exe
│   └── README.md          (optional — which tool does what)
├── playbook.md             (current playbook)
├── playbook-history/       (prior playbooks, archived by timestamp)
│   └── playbook-2026-04-18T14-30Z.md
└── runs/
    ├── 2026-04-20T15-04Z/
    │   ├── test_id.txt                 ← RM-20260420-a7f3
    │   ├── baseline.json               ← pre-exec SIEM snapshot
    │   ├── run-spec.json               ← what the user asked for, auto vs interactive
    │   ├── per-technique/
    │   │   ├── T1053.005.json          ← execute result + SIEM result per technique
    │   │   ├── T1003.001.json
    │   │   └── ...
    │   └── report.md                   ← generated end-of-run purple-team report
    └── 2026-04-21T09-12Z/
        └── ...
```

## Naming conventions

| Item | Format | Example |
|---|---|---|
| Run directory | `runs/{ISO8601-UTC no colons}` | `runs/2026-04-20T15-04Z` |
| test_id | `RM-{YYYYMMDD}-{short-hash}` | `RM-20260420-a7f3` |
| Snapshot name | `maldev-{technique-id-or-preflight}-{test_id}` | `maldev-T1053.005-RM-20260420-a7f3` |
| Technique file | `{MITRE-ID}-{short-slug}.md` | `T1053.005-scheduled-tasks.md` |
| Tool version dir | `tools/{tool-name}-{version}/` | `tools/loader-v1/` |
| Per-technique result | `per-technique/{MITRE-ID}.json` | `per-technique/T1053.005.json` |

## Lifecycle rules

- **Techniques/** persists across runs. Phase 4 skips if a technique file already exists (per `refs/phase-4-technique-files.md`).
- **Tools/** persists across runs. Phase 6 versions uploads — do not overwrite.
- **Playbook.md** is the current working playbook. When regenerated, archive the prior one to `playbook-history/` with a timestamp.
- **Runs/** accumulates. Each run is immutable once written. Never modify a prior run's files.
- **Snapshots on the VM** are not in this layout — they live on the Rogue Arena deployment. `refs/phase-7-execution-loop.md` handles snapshot naming and lifecycle.

## Multi-deployment scoping

Each deployment gets its own `{ROGUE_WORKSPACE}/deployments/{name}/` subtree. Nothing crosses between deployments. If two deployments are open, the skill asks which one — it does not assume.

## Finding "where you left off"

When the Phase 1 resume check finds earlier runs, inspect:

1. `runs/` — find the most recent run directory
2. `runs/{latest}/per-technique/` — list files (these are completed techniques)
3. Diff against `playbook.md` technique list
4. Present: "Last run was {timestamp}. Completed {N} techniques: {list}. {M} remain: {list}. Resume from {next}?"
