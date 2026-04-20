# Ansible Plugin Knowledge Base

This section contains everything you need to write correct, production-quality Rogue Arena ansible plugins. Internalize ALL of this before writing any YAML.

## Platform Context

Rogue Arena is a cyber range platform for red and blue team IT security training. Rogue Architect is the drag-and-drop scenario builder where users design hyper-realistic scenarios that mimic real-world environments. Plugins configure VMs within these scenarios.

**Critical requirements:**
- All Ansible plays must look like real-world production system configurations
- Hostnames, usernames, paths, and settings should mimic actual enterprise environments
- Avoid obviously fake or placeholder values — aim for authenticity
- **Hardcoded credentials are acceptable and expected** — this is a training/lab environment, NOT production. Do NOT flag hardcoded credentials as security issues or recommend vaults/secrets management.

## Plugin YAML Structure (CRITICAL)

Plugin YAML is a **TASK LIST ONLY** — NOT a full Ansible playbook. The playbook wrapper (`hosts:`, `tasks:`, etc.) gets added automatically by the system at runtime.

CORRECT — start directly with tasks:
```yaml
- name: First task
  ansible.windows.win_powershell:
    script: |
      Write-Host "Hello"

- name: Second task
  ansible.windows.win_file:
    path: 'C:\temp'
    state: directory
```

WRONG — do NOT include playbook structure:
```yaml
---
- hosts: all
  tasks:
    - name: First task
      ...
```

No `---` at the beginning. No `- hosts:` lines. Just a flat list of `- name:` tasks.

**Inline execution:** All tasks run top-to-bottom in a single play. You CANNOT use `import_tasks`, `include_tasks`, or reference separate YAML files. Everything must be in one continuous task list.

## YAML Structure Guidelines

Every plugin YAML should follow these ordering principles (not a rigid template — plugins can be large and complex):

1. **`set_fact` block at the top** — all configurable values in one place. The user extracts these to formal parameters when publishing.
2. **Download before install** — acquire all files from the internet into the staging folder before any installation steps. No internet calls mixed into installation.
3. **Text files via `content:` blocks** — scripts, configs, and other text files are written inline using `win_copy`/`copy` with `content:` parameter. No vault files needed.
4. **Clean up staging folder when done**
5. **Validate at the end** — confirm the install worked

Everything between download and cleanup is free-form: interleaved file writes and installs, reboots, conditional blocks, multiple components, etc. Write whatever structure makes sense for the specific plugin.

**Staging folders:**
- Windows: `C:\PluginSetup\`
- Linux: `/tmp/plugin-setup/`

## Windows Paths and YAML Quoting

In YAML, backslashes in **double-quoted strings** are escape sequences:
- `\t` → tab character (NOT "backslash t")
- `\n` → newline
- `\V` → INVALID escape (causes YAML parse error)

**For NEW code:** Prefer single quotes for Windows paths — no escape processing:
```yaml
- name: Check file
  ansible.windows.win_stat:
    path: 'C:\Program Files\MyApp\app.exe'
```

**Exception — PowerShell Script Blocks:**
Inside `script: |` blocks (YAML literal block scalars), content is passed raw to PowerShell. Use normal single-backslash paths:
```yaml
- name: PowerShell script
  ansible.windows.win_powershell:
    script: |
      $path = "C:\scripts\file.exe"
      Copy-Item -Path $path -Destination "C:\temp\"
```

## Module Collections (CRITICAL — Wrong Collection = Build Failure)

Windows modules are split between two collections:
- `ansible.windows.*` — Core Windows modules (bundled with Ansible)
- `community.windows.*` — Extended Windows modules (community-maintained)

Common mistakes to avoid:
- WRONG: `ansible.windows.win_lineinfile` → CORRECT: `community.windows.win_lineinfile`
- WRONG: `ansible.windows.win_firewall_rule` → CORRECT: `community.windows.win_firewall_rule`
- WRONG: `ansible.windows.win_unzip` → CORRECT: `community.windows.win_unzip`

Always use the fully qualified collection name (FQCN).

**Platform module mapping:**

| Windows | Linux |
|---------|-------|
| `ansible.windows.win_copy` | `ansible.builtin.copy` |
| `ansible.windows.win_file` | `ansible.builtin.file` |
| `ansible.windows.win_stat` | `ansible.builtin.stat` |
| `ansible.windows.win_shell` | `ansible.builtin.shell` |
| `ansible.windows.win_powershell` | N/A (use shell) |
| `ansible.windows.win_reboot` | `ansible.builtin.reboot` |
| `ansible.windows.win_service` | `ansible.builtin.service` |

## Privilege Escalation (become) — CRITICAL

Plugins run as **SYSTEM** on Windows and **root** on Linux by default. Do NOT use `become`, `ansible_become`, or `runas` unless absolutely necessary.

**When NOT to use become (most cases):**
- Writing files to system paths (C:\, C:\temp, /etc/, /opt/, etc.)
- Modifying HKLM (HKEY_LOCAL_MACHINE) registry
- Installing software system-wide
- Managing services
- Creating directories anywhere on the system
- Any system-level configuration
- Active Directory operations (SYSTEM has domain access when machine is domain-joined)

**When TO use become/runas:**
- Modifying user-specific registry hives (HKCU — HKEY_CURRENT_USER)
- Accessing user profile folders that SYSTEM cannot read
- Running processes that must appear in a user's session context
- Modifying per-user application settings
- Operations that MUST run as a specific user identity

**Example — CORRECT usage:**
```yaml
# NO become needed — SYSTEM can write anywhere
- name: Write status file
  ansible.windows.win_copy:
    content: "Configuration complete"
    dest: 'C:\status.txt'

# NO become needed — SYSTEM can modify HKLM registry
- name: Set system registry value
  ansible.windows.win_regedit:
    path: HKLM:\SOFTWARE\MyApp
    name: Setting
    data: Value

# become IS needed — modifying user's HKCU registry hive
- name: Change user wallpaper
  ansible.windows.win_powershell:
    script: |
      Set-ItemProperty -Path "HKCU:\Control Panel\Desktop" -Name Wallpaper -Value "C:\wallpaper.jpg"
      RUNDLL32.EXE user32.dll,UpdatePerUserSystemParameters
  vars:
    ansible_become: true
    ansible_become_method: runas
    ansible_become_user: "{{ username }}"
    ansible_become_password: "{{ user_password }}"
```

**Domain operations pattern (when domain credentials are required):**
```yaml
- name: Task requiring domain admin credentials
  ansible.windows.win_powershell:
    script: |
      Import-Module ActiveDirectory
      # ... AD operations requiring specific credentials
  vars:
    ansible_become: true
    ansible_become_method: runas
    ansible_become_user: "Administrator@{{ DomainNameFQDN }}"
    ansible_become_password: "{{ domain_admin_password }}"
```

**Rule of thumb:** Default to NO privilege escalation. Only add become/runas when the task specifically requires running in a user's context (like HKCU registry) or needs specific domain credentials.

## CSV Parameter Handling

CSV parameters come as raw strings that may contain BOM (byte order mark) and Windows carriage returns. Always sanitize:
```yaml
- name: Normalize CSV data
  ansible.builtin.set_fact:
    my_csv_clean: "{{ my_csv_param | default('') | regex_replace('^\\ufeff','') | regex_replace('\\r','') | trim }}"

- name: Parse CSV to list of objects
  ansible.builtin.set_fact:
    my_records: "{{ my_csv_clean | community.general.from_csv }}"
```

**CSV-to-File Pattern for Complex Processing (bulk AD operations, etc.):**
```yaml
- name: Write CSV data to temp file
  ansible.windows.win_copy:
    content: "{{ my_csv_param | regex_replace('^\\ufeff','') | regex_replace('\\r','') | trim }}"
    dest: 'C:\temp\data.csv'
  when: my_csv_param | default('') | trim != ''

- name: Process CSV with PowerShell and cleanup
  ansible.windows.win_powershell:
    script: |
      $data = Import-Csv -Path 'C:\temp\data.csv'
      $changed = $false
      foreach ($row in $data) {
        # Process each row...
        $changed = $true
      }
      Remove-Item 'C:\temp\data.csv' -Force -ErrorAction SilentlyContinue
      [pscustomobject]@{ changed = $changed } | ConvertTo-Json
  register: csv_result
  changed_when: csv_result.output is search('"changed"\s*:\s*true')
```

## Validation Patterns (CRITICAL — Always Validate After Install)

**Check file exists:**
```yaml
- name: Check application installed
  ansible.windows.win_stat:
    path: 'C:\Program Files\MyApp\app.exe'
  register: app_check

- name: Fail if not found
  ansible.builtin.fail:
    msg: "Installation failed — application not found"
  when: not app_check.stat.exists
```

**Check service running:**
```yaml
- name: Check service
  ansible.windows.win_service_info:
    name: MyAppService
  register: svc_check

- name: Fail if not running
  ansible.builtin.fail:
    msg: "Service not running"
  when: not svc_check.services['MyAppService'].exists or svc_check.services['MyAppService'].state != 'running'
```

**Retry until condition met (polling):**
```yaml
- name: Wait for user profile to be created
  ansible.windows.win_stat:
    path: "C:\\Users\\{{ username }}\\Desktop"
  register: profile_check
  until: profile_check.stat.exists
  retries: 60
  delay: 10
```

## Idempotency with changed_when

Track whether operations actually changed anything:
```yaml
- name: Configure settings (idempotent)
  ansible.windows.win_powershell:
    script: |
      $changed = $false
      if ($currentValue -ne $desiredValue) {
        Set-Something -Value $desiredValue
        $changed = $true
      }
      [pscustomobject]@{ changed = $changed } | ConvertTo-Json
  register: config_result
  changed_when: config_result.output is search('"changed"\s*:\s*true')
```

## Important Ansible Patterns

- Use `register:` to capture command output
- Use `when:` for conditional execution
- Use `block:` / `rescue:` / `always:` for error handling
- Use `loop:` or `with_items:` for iteration
- Use `ignore_errors: true` sparingly — only when failure is acceptable
- Use `failed_when:` for custom failure conditions
- Use `changed_when:` to control idempotency reporting
- Use `async:` and `poll:` for long-running tasks (e.g., installers)

## Reboot Configuration Guidelines

- Standard reboot: `reboot_timeout: 300, post_reboot_delay: 45`
- After role/feature install: `reboot_timeout: 300, post_reboot_delay: 10`
- After domain operations: `reboot_timeout: 2400, post_reboot_delay: 120` (domain sync is slow)
- Always use `pre_reboot_delay: 15` to allow pending operations to complete

## Installer Best Practices

- When running installers (.exe, .msi), ALWAYS wait for the process to complete before proceeding
- Use `async` and `poll` or check for process completion
- Use `win_package` with `state: present` when possible for idempotent installs
- Check for installation success before continuing to dependent tasks
- Always clean up installer files after use

## Text File Operations

For scripts, configs, and other text files that need to exist on the target VM, use `content:` blocks to write them inline:

```yaml
# Windows
- name: Write PowerShell setup script
  ansible.windows.win_copy:
    content: |
      $ErrorActionPreference = 'Stop'
      # Full script content here...
      Write-Host "Setup complete"
    dest: 'C:\PluginSetup\setup.ps1'

# Linux
- name: Write bash setup script
  ansible.builtin.copy:
    content: |
      #!/bin/bash
      set -e
      # Full script content here...
      echo "Setup complete"
    dest: /tmp/plugin-setup/setup.sh
    mode: '0755'
```

This eliminates the need for external file storage — all text content lives directly in the YAML.

## Dependency Injection Syntax

- Use `{<DependencyPluginName>}` to inject the entire output/state from a dependency plugin
- Dependencies are other plugins that MUST run before this plugin
- The dependency list shows which plugins are available for injection

## Parameters

Parameters allow users to customize plugin behavior using `{{ parameter_name }}` Jinja2 syntax. Types:
- `string`: Single-line text (e.g., hostname, username)
- `number`: Numeric value (e.g., port, timeout)
- `boolean`: True/false toggle
- `stringBlock`: Multi-line text (e.g., scripts, config files)
- `csv`: Tabular data with defined column headers (e.g., user lists, IP mappings)

**During development**, use `set_fact` at the top of the YAML for all configurable values. The user extracts these to formal parameters when publishing the plugin.

## Detecting and Fixing Malformed Plugins

Watch for these patterns that need correction:

1. **Raw scripts without Ansible structure** — just PowerShell/Bash code with no `- name:` tasks. Wrap in proper task structure.

2. **Playbook headers at task level** — includes `hosts:` or `tasks:` wrapper. Remove wrapper, keep tasks only.

3. **YAML document separator with raw content** — starts with `---` followed by non-task content. The `---` followed by raw script indicates pasted script without Ansible structure.

## Production Plugin Examples

**Example 1: Simple Application Install (Windows)**
Standard pattern: set_fact → download → install → cleanup → validate.
```yaml
- name: Set configuration
  ansible.builtin.set_fact:
    vlc_version: '3.0.20'
    vlc_url: 'https://get.videolan.org/vlc/3.0.20/win64/vlc-3.0.20-win64.exe'

- name: Create staging folder
  ansible.windows.win_file:
    path: 'C:\PluginSetup'
    state: directory

- name: Download VLC installer
  ansible.windows.win_powershell:
    script: |
      Invoke-WebRequest -Uri "{{ vlc_url }}" -OutFile "C:\PluginSetup\vlc-{{ vlc_version }}-win64.exe"

- name: Install VLC silently
  ansible.windows.win_powershell:
    script: |
      C:\PluginSetup\vlc-{{ vlc_version }}-win64.exe /L=1033 /S

- name: Pause for 4 minutes to allow VLC setup to complete
  ansible.builtin.pause:
    minutes: 4

- name: Remove staging folder
  ansible.windows.win_file:
    path: 'C:\PluginSetup'
    state: absent

- name: Check for VLC executable
  ansible.windows.win_stat:
    path: 'C:\Program Files\VideoLAN\VLC\vlc.exe'
  register: vlc_check

- name: Fail if VLC is missing
  ansible.builtin.fail:
    msg: "Validation failed — C:\\Program Files\\VideoLAN\\VLC\\vlc.exe not found."
  when: not vlc_check.stat.exists
```

**Example 2: Complex Role with CSV Processing (Domain Controller — Key Patterns)**

*Pattern A: CSV Normalization (always do this first)*
```yaml
- name: Normalize CSV-style variables
  ansible.builtin.set_fact:
    CreateOUs: "{{ CreateOUs | default('') | regex_replace('^\\ufeff','') | regex_replace('\\r','') | trim }}"
    CreateGroups: "{{ CreateGroups | default('') | regex_replace('^\\ufeff','') | regex_replace('\\r','') | trim }}"
    CreateUsers: "{{ CreateUsers | default('') | regex_replace('^\\ufeff','') | regex_replace('\\r','') | trim }}"
```

*Pattern B: Derive network settings from StaticIP*
```yaml
- name: Derive gateway and upstream DNS from StaticIP
  ansible.builtin.set_fact:
    default_gateway: "{{ StaticIP | regex_replace('(^\\d+\\.\\d+\\.\\d+)\\.\\d+$', '\\1.1') }}"
    upstream_DNS: "{{ StaticIP | regex_replace('(^\\d+\\.\\d+\\.\\d+)\\.\\d+$', '\\1.1') }}"
```

*Pattern C: AD Role Installation and DC Promotion*
```yaml
- name: Install DNS Server feature
  ansible.windows.win_feature:
    name: DNS
    include_management_tools: yes
    include_sub_features: yes
    state: present

- name: Install Active Directory Domain Services
  ansible.windows.win_feature:
    name: AD-Domain-Services
    include_management_tools: yes
    include_sub_features: yes
    state: present

- name: Reboot after role installations
  ansible.windows.win_reboot:
    reboot_timeout: 300
    post_reboot_delay: 10

- name: Create new AD forest domain (DC promo)
  ansible.windows.win_domain:
    dns_domain_name: "{{ DomainNameFQDN }}"
    safe_mode_password: "Password1!"
  register: ad

- name: Reboot after AD forest setup
  ansible.windows.win_reboot:
    pre_reboot_delay: 15
    reboot_timeout: 2400
    post_reboot_delay: 45
  when: ad.changed
```

*Pattern D: Write CSV to file for PowerShell processing*
```yaml
- name: Write User CSV to C:\
  ansible.windows.win_copy:
    content: "{{ CreateUsers | regex_replace('^\\ufeff','') | regex_replace('\\r','') | trim }}"
    dest: 'C:\ad_users.csv'
  when: CreateUsers | default('') | trim != ''
```

*Pattern E: Bulk PowerShell with Import-Csv and cleanup*
```yaml
- name: Bulk-create AD objects via PowerShell
  ansible.windows.win_powershell:
    error_action: stop
    script: |-
      $ErrorActionPreference = 'Stop'
      Import-Module ActiveDirectory -ErrorAction Stop
      $changed = $false

      $userCsvPath = 'C:\ad_users.csv'
      if (Test-Path $userCsvPath) {
        $users = Import-Csv -Path $userCsvPath
        foreach ($u in $users) {
          # Process each user...
          $changed = $true
        }
        # Cleanup CSV file
        Remove-Item -Path $userCsvPath -Force
      }

      [pscustomobject]@{ changed = $changed } | ConvertTo-Json
  register: ad_bulk
  changed_when: ad_bulk.output is search('"changed"\s*:\s*true')
  vars:
    ansible_become: true
    ansible_become_method: runas
    ansible_become_user: "Administrator@{{ DomainNameFQDN }}"
    ansible_become_password: "Password1!"
```

**Key Takeaways from Production Plugins:**
1. Always validate after critical operations (check files exist, services running)
2. Clean up installers and temp files after use
3. Use `pause` or `async/poll` for long-running installers
4. Normalize CSV parameters to remove BOM and carriage returns
5. For bulk AD operations, write CSV to file and use PowerShell's Import-Csv
6. Use `become/runas` only for user-specific settings (HKCU registry, user profiles)
7. Use appropriate reboot timeouts (2400 for domain operations, 300 for normal)
8. Inject dependencies with `{<PluginName>}` at the point where you need them

## Apt Mirror Pattern

Lab environments are air-gapped with no internet access. An apt mirror at `10.1.1.4` is pre-configured on all Linux hosts and mirrors common package repositories. Use `[trusted=yes]` since the mirror uses HTTP:

```yaml
- name: Add Docker apt repository
  ansible.builtin.apt_repository:
    repo: "deb [trusted=yes] http://10.1.1.4/docker-debian/ bookworm stable"
    state: present

- name: Install dependencies
  apt:
    pkg:
      - docker-ce
      - docker-ce-cli
      - containerd.io
    state: present
    update_cache: yes
    dpkg_options: 'force-confdef,force-confold'
```

The mirror base URL is `http://10.1.1.4/`. Repository paths vary per package source (e.g., `/docker-debian/`, `/hashicorp/`). The user will know the correct path for their mirror setup.

## Download Script Conventions

Each plugin has a download script that runs on an **online machine** to fetch resources unavailable via the apt mirror. The script downloads everything into the `for_plugin_vault/` folder and zips it up.

**What goes in the download script:**
- Git repository clones
- Chocolatey package downloads (Windows)
- Offline installer downloads (.msi, .exe, .deb, .tar.gz)
- Docker image saves (`docker save`)
- Any binary or archive from the internet

**What does NOT go in the download script:**
- Apt packages (available via local mirror — handled in Ansible YAML directly)
- Install logic (belongs in Ansible YAML)
- Configuration files (written inline in Ansible YAML via `content:` blocks, or placed in `for_plugin_vault/` manually)

**Script format:**
- `.sh` for Linux resource downloads (Git repos, tarballs, Docker images)
- `.ps1` for Windows resource downloads (Chocolatey packages, MSI installers)

The script should be idempotent — safe to re-run if a download was interrupted.
