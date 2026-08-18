# Flow — The Cast

> Loaded by `architect-brainstorm` after Gate 1. Do not invoke as a skill.

Dispatch a **Haiku subagent** to generate characters. Pass it: company context, franchises, domain list, workstation count per domain, security posture, and the scenario_part1.yml path so it can read the topology.

The subagent creates one character per workstation (name, domain, machine hostname, company_role, background, hobbies, security_habits). Group by domain. DCs and servers get no primary character. Characters should be memorable — security habits should be funny but load-bearing (password choices, misconfigs, accidental DA).

The subagent writes `scenario_part2.yml` and returns.

**Gate 2.** Present the character roster (bullets, not code blocks). For 10+ characters, show in batches of 5-8. Ask: "Want to swap anyone, change hobbies, or adjust anything?" Let users iterate — this is the fun part. On confirm, return to the orchestrator and load `refs/flow-build.md`.
