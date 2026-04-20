# Phase 6 — Payload Selection

Ask: "What payload are you bringing to this engagement?"

## Path A — User has C2/payload

- Ask for binary/script name and location (parse from conversation if already named)
- Identify staging VM
- Upload via `deployment_upload_file`. Record the destination path.
- If the user's payload is a C2 implant: "You'll need your teamserver listening. Once it's up, I can verify connectivity from target VMs to your listener."
- Network reachability checks via `deployment_exec_command` (ping/curl the listener from targets)
- If the playbook lists required tools (Rubeus.exe, impacket, mimikatz, etc.) that aren't already on-disk, upload them too. Probe with `where`/`which` before uploading.

## Path B — Quick test mode (benign payload substitution)

**Gating rule — payload-orthogonal vs payload-scoped techniques:**

Only offer Path B for techniques where detection is technique-scoped, not payload-scoped.

| Technique type | Path B valid? | Reason |
|---|---|---|
| Scheduled task creation (T1053.*) | Yes | Detection fires on the task creation event, payload is incidental |
| Registry run key (T1547.001) | Yes | Detection fires on the key write, not what it points to |
| Service install (T1543.*) | Yes | Detection fires on service creation |
| AMSI bypass (T1562.001) | **No** | Detection IS the AMSI event; calc.exe won't trip it |
| ETW patching (T1562.006) | **No** | Detection requires the patching behavior |
| Shellcode injection (T1055.*) | **No** | Detection looks at the injected content |
| Reflective DLL (T1620) | **No** | Detection parses the reflective loader's behavior |
| Signed-loader abuse | **No** | Detection signature depends on the loader |

For payload-scoped techniques, Path B is invalid. Require Path A or skip the technique.

If Path B is valid: "I can substitute `calc.exe`, `notepad.exe`, or a simple `echo` command to verify the execution chain triggers detections before you bring your real tool."

## Path C — No payload

- User wants raw technique testing without any binary
- Playbook executes as-is — many techniques don't need a custom binary
- Same payload-scoped gating applies: if the technique requires payload-bound detection, skip it
