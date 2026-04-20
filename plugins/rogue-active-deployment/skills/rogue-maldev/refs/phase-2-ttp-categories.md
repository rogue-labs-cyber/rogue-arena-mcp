# Phase 2 — TTP Research Menu

Entered only if the user picked "no fixed target — need to scope."

## Category Menu

| Category | Examples |
|----------|----------|
| **Persistence** | Registry run keys, scheduled tasks, services, WMI subscriptions, startup folders, DLL search order hijacking |
| **Privilege Escalation** | Token manipulation, UAC bypass, service misconfig, named pipe impersonation |
| **Lateral Movement** | PsExec, WMI, WinRM, DCOM, RDP hijacking, pass-the-hash, SMB |
| **Credential Access** | LSASS dumping, SAM extraction, Kerberoasting, DCSync, DPAPI |
| **Defense Evasion** | AMSI bypass, ETW patching, unhooking, process injection, LOLBins, timestomping |
| **Execution** | Shellcode loaders, DLL sideloading, msbuild, PowerShell cradles, WMIC |
| **Discovery** | AD enumeration, network scanning, share enumeration, BloodHound collection |
| **Linux-specific** | Cron persistence, LD_PRELOAD, PAM backdoors, SSH key injection, capabilities abuse |

## Input Modes

- Pick one or more categories by name
- Free-text: "I'm working on a C2 implant that needs to survive reboots on Win11"
- Skip to Phase 4 if the user already has a technique list
