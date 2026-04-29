import { z } from "zod";
import { Upload } from "tus-js-client";
import * as fs from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";
import type { AuthProvider } from "./auth.js";
import type { HubClient } from "./hub-client.js";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import {
  startTusUpload,
  activeTransfers,
  serializeTransfer,
  finishTransfer,
  countActiveTransfers,
  findDuplicateTransfer,
  MAX_CONCURRENT_TRANSFERS,
  CHUNK_SIZE,
  UPLOAD_BPS,
  type TransferState,
  type TargetKind,
} from "./tus-core.js";

// ── Async script run tracking ────────────────────────────────────────
const MAX_CONCURRENT_SCRIPT_RUNS = 10;
const SCRIPT_RUN_CLEANUP_MS = 900_000; // 15 minutes — scripts run longer than transfers

interface ScriptRunState {
  scriptRunId: string;
  depVMId: string;
  status: "running" | "completed" | "failed" | "cancelled";
  startTime: string;
  endTime?: string;
  // Raw hub response — stored as-is to avoid shape coupling
  resultData?: unknown;
  error?: string;
  // AbortController for cancelling the in-flight hub request
  _abortController?: AbortController;
}

const activeScriptRuns = new Map<string, ScriptRunState>();

function finishScriptRun(
  state: ScriptRunState,
  status: "completed" | "failed" | "cancelled",
  error?: string
): void {
  if (state.status !== "running") return;
  state.status = status;
  state.endTime = new Date().toISOString();
  if (error) state.error = error;
  state._abortController = undefined;
  setTimeout(() => activeScriptRuns.delete(state.scriptRunId), SCRIPT_RUN_CLEANUP_MS);
}

function countActiveScriptRuns(): number {
  let count = 0;
  for (const s of activeScriptRuns.values()) {
    if (s.status === "running") count++;
  }
  return count;
}

function serializeScriptRun(state: ScriptRunState): Record<string, unknown> {
  const result: Record<string, unknown> = {
    scriptRunId: state.scriptRunId,
    depVMId: state.depVMId,
    status: state.status,
    startTime: state.startTime,
  };
  if (state.endTime) result.endTime = state.endTime;
  if (state.resultData !== undefined) {
    // Spread hub response fields directly — keeps output shape in sync with hub automatically
    const data = state.resultData as Record<string, unknown>;
    for (const [key, value] of Object.entries(data)) {
      result[key] = value;
    }
  }
  if (state.error) result.error = state.error;
  return result;
}

// ── Path validation ─────────────────────────────────────────────────
const DENIED_DIRECTORIES = [
  ".ssh",
  ".aws",
  ".gnupg",
  ".pgp",
  ".config/gcloud",
  ".config/gh",
  ".config/op",
  ".config/hub",
  ".config/configstore",
  ".config/git/credentials",
  ".docker",
  ".kube",
  ".npmrc",
  ".netrc",
  ".env",
  ".claude",
  ".local/share/keyrings",
  ".azure",
  ".vault-token",
  ".password-store",
  ".terraform.d",
  ".bash_history",
  ".zsh_history",
  ".node_repl_history",
].map((dir) => path.join(homedir(), dir));

function validateLocalPath(rawPath: string, operation: "read" | "write"): string {
  const resolved = path.resolve(rawPath);

  // Reject if resolved path still contains traversal (shouldn't after resolve, but belt-and-suspenders)
  if (resolved.includes("..")) {
    throw new Error(`Path traversal not allowed: ${rawPath}`);
  }

  // Follow symlinks to get the true filesystem path — prevents symlink bypass of denylist
  let realPath: string;
  if (operation === "read") {
    // For reads, the file must exist to resolve symlinks
    try {
      realPath = fs.realpathSync(resolved);
    } catch {
      // File doesn't exist yet — use resolved path (will fail at read time anyway)
      realPath = resolved;
    }
  } else {
    // For writes, resolve as much of the parent path as possible
    try {
      const parentReal = fs.realpathSync(path.dirname(resolved));
      realPath = path.join(parentReal, path.basename(resolved));
    } catch {
      realPath = resolved;
    }
  }

  // Reject paths inside sensitive directories (case-insensitive for macOS APFS/HFS+)
  const realPathLower = realPath.toLowerCase();
  for (const denied of DENIED_DIRECTORIES) {
    const deniedLower = denied.toLowerCase();
    if (realPathLower === deniedLower || realPathLower.startsWith(deniedLower + path.sep)) {
      throw new Error(`Access denied — ${operation} not allowed in ${denied}`);
    }
  }

  console.error(`[rogue-arena-mcp] Path validated (${operation}): ${realPath}`);
  return realPath;
}

// ── Zod schemas ──────────────────────────────────────────────────────

const PluginDevUploadSchema = z
  .object({
    pluginVersionId: z.string().uuid(),
    localFilePath: z.string().min(1),
  })
  .strict();

const ArchitectVaultUploadSchema = z
  .object({
    machineId: z.string().uuid(),
    localFilePath: z.string().min(1),
    vaultSubPath: z.string().optional(),
  })
  .strict();

const DeploymentUploadSchema = z
  .object({
    depVMId: z.string().uuid(),
    localFilePath: z.string().min(1),
    destinationPath: z.string().min(1),
  })
  .strict();

const DeploymentDownloadSchema = z
  .object({
    depVMId: z.string().uuid(),
    remoteFilePath: z.string().min(1),
    localDestinationPath: z.string().min(1),
  })
  .strict();

const TransferStatusSchema = z
  .object({
    transferId: z.string().uuid().optional(),
  })
  .strict();

const TransferCancelSchema = z
  .object({
    transferId: z.string().uuid(),
  })
  .strict();

const RunScriptBgSchema = z
  .object({
    deploymentRecordId: z.string().uuid(),
    depVMId: z.string().uuid(),
    script: z.string().min(1).max(1_048_576),
    shell: z.enum(["bash", "powershell", "sh", "python3"]).optional(),
    timeoutSecs: z.number().int().min(1).max(600).optional(),
    maxOutputChars: z.number().int().min(1000).max(100000).optional(),
  })
  .strict();

const ScriptStatusSchema = z
  .object({
    scriptRunId: z.string().uuid().optional(),
  })
  .strict();

const ScriptCancelSchema = z
  .object({
    scriptRunId: z.string().uuid(),
  })
  .strict();

function parseInput<T>(
  schema: z.ZodType<T>,
  args: Record<string, unknown>
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(args);
  if (result.success) return { success: true, data: result.data };
  return {
    success: false,
    error: result.error.issues
      .map((i) => `${i.path.length ? i.path.join(".") + ": " : ""}${i.message}`)
      .join("; "),
  };
}

export interface LocalToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// INVARIANT: aliased local tools (plugin_dev_transfer_status, architect_transfer_status,
// and their *_cancel counterparts) must always appear in ListTools unconditionally.
// discover_tools in meta-tools.ts queries only alwaysToolsCache + discoverableToolsCache,
// not LOCAL_TOOLS — if LOCAL_TOOLS is ever filtered by category without also surfacing
// aliases into discover_tools, these tools will vanish from the model's view.
export const LOCAL_TOOLS: LocalToolDefinition[] = [
  {
    name: "plugin_dev_upload_to_vault",
    description:
      "Upload a local file to a plugin version's vault using TUS resumable upload. " +
      "Supports large files (multi-GB). Starts the transfer in the background and returns " +
      "immediately with a transferId. Use plugin_dev_transfer_status to poll progress every " +
      "10-15 seconds; cancel via plugin_dev_transfer_cancel.",
    inputSchema: {
      type: "object" as const,
      properties: {
        pluginVersionId: {
          type: "string",
          format: "uuid",
          description: "UUID of the plugin version",
        },
        localFilePath: {
          type: "string",
          minLength: 1,
          description: "Absolute path to the file on the local machine",
        },
      },
      required: ["pluginVersionId", "localFilePath"],
      additionalProperties: false,
    },
  },
  {
    name: "architect_machine_vault_upload",
    description:
      "Upload a local file (exe, zip, binary, any file type) into a machine's vault in the " +
      "scenario-builder canvas. Machine vault is created by Apply Plan — call this tool " +
      "post-Apply; pre-Apply draft machines have no vault and the tool returns VAULT_NOT_FOUND. " +
      "MVP only supports uploads to vault root (vaultSubPath='/'). If a file with the same name " +
      "exists in the root, vaults uniquifies to '<name> copy N<ext>' (up to 100 tries); poll " +
      "architect_transfer_status to read the final persisted filename. " +
      "Starts the transfer in the background and returns immediately with a transferId. " +
      "Poll architect_transfer_status every 10-15 seconds; cancel via architect_transfer_cancel. " +
      "**Uploading a file is not sufficient to deliver it to the VM.** After uploading, apply the \"File Copy\" plugin so the file lands on the target at deploy time: " +
      "1. architect_plugin_catalog_search({ searchTerm: \"file copy\" }) → find the File Copy plugin (exact name match surfaces it first). " +
      "2. architect_assigned_plugin_add with that pluginID and runOrderSequence. " +
      "3. architect_assigned_plugin_set_params with source (forward-slash vault path, e.g. \"C:/Users/jsmith/Desktop/report.xlsx\"), destination (target VM path), isFolder, copyContentsOfFolder. " +
      "Prefer folder-level delivery over per-file calls: upload a zip or use a trailing-slash source with isFolder=\"true\" and copyContentsOfFolder=\"true\" to copy an entire directory (e.g. all files on Desktop) in one plugin rather than one plugin per file.",
    inputSchema: {
      type: "object" as const,
      properties: {
        machineId: {
          type: "string",
          format: "uuid",
          description: "UUID of the post-Apply machine node",
        },
        localFilePath: {
          type: "string",
          minLength: 1,
          description: "Absolute path to the file on the local machine",
        },
        vaultSubPath: {
          type: "string",
          description: "Folder inside the vault. MVP: must be '/' or omitted.",
        },
      },
      required: ["machineId", "localFilePath"],
      additionalProperties: false,
    },
  },
  {
    name: "deployment_upload_file",
    description:
      "Upload a local file to a VM in an active deployment using TUS resumable upload. Supports large files (multi-GB). Starts the transfer in the background and returns immediately with a transferId. Use deployment_transfer_status to poll progress every 10-15 seconds.",
    inputSchema: {
      type: "object" as const,
      properties: {
        depVMId: {
          type: "string",
          format: "uuid",
          description: "UUID of the deployment VM",
        },
        localFilePath: {
          type: "string",
          minLength: 1,
          description: "Absolute path to the file on the local machine",
        },
        destinationPath: {
          type: "string",
          minLength: 1,
          description: "Full destination path on the VM (e.g. /home/user/file.txt)",
        },
      },
      required: ["depVMId", "localFilePath", "destinationPath"],
      additionalProperties: false,
    },
  },
  {
    name: "deployment_download_file",
    description:
      "Download a file from a VM in an active deployment to the local machine. Starts the transfer in the background and returns immediately with a transferId. The file transfer continues in the background. Use deployment_transfer_status to poll progress every 10-15 seconds.",
    inputSchema: {
      type: "object" as const,
      properties: {
        depVMId: {
          type: "string",
          format: "uuid",
          description: "UUID of the deployment VM",
        },
        remoteFilePath: {
          type: "string",
          minLength: 1,
          description: "Full path to the file on the VM (e.g. /home/user/file.txt)",
        },
        localDestinationPath: {
          type: "string",
          minLength: 1,
          description: "Absolute local path where the file should be saved",
        },
      },
      required: ["depVMId", "remoteFilePath", "localDestinationPath"],
      additionalProperties: false,
    },
  },
  {
    name: "deployment_transfer_status",
    description:
      "Check progress of file uploads and downloads. Returns all active and recently completed transfers with progress details. Poll every 10-15 seconds for active transfers.",
    inputSchema: {
      type: "object" as const,
      properties: {
        transferId: {
          type: "string",
          format: "uuid",
          description: "Optional: UUID of a specific transfer to check. Omit to see all transfers.",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "deployment_transfer_cancel",
    description:
      "Cancel an in-progress file upload or download by transferId.",
    inputSchema: {
      type: "object" as const,
      properties: {
        transferId: {
          type: "string",
          format: "uuid",
          description: "UUID of the transfer to cancel (from deployment_upload_file or deployment_download_file response)",
        },
      },
      required: ["transferId"],
      additionalProperties: false,
    },
  },
  {
    name: "plugin_dev_transfer_status",
    description:
      "Check progress of plugin_dev_upload_to_vault transfers. Returns all active and recently " +
      "completed transfers. Poll every 10-15 seconds. On completed, the response carries the " +
      "final persisted fileName (vaults may uniquify on collision). If concurrency is saturated, " +
      "cancel stalled transfers via plugin_dev_transfer_cancel before launching new batches.",
    inputSchema: {
      type: "object" as const,
      properties: {
        transferId: {
          type: "string",
          format: "uuid",
          description: "Optional: UUID of a specific transfer to check. Omit to see all transfers.",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "plugin_dev_transfer_cancel",
    description:
      "Cancel an in-progress plugin_dev_upload_to_vault by transferId.",
    inputSchema: {
      type: "object" as const,
      properties: {
        transferId: {
          type: "string",
          format: "uuid",
          description: "UUID of the transfer to cancel (from plugin_dev_upload_to_vault response).",
        },
      },
      required: ["transferId"],
      additionalProperties: false,
    },
  },
  {
    name: "architect_transfer_status",
    description:
      "Check progress of architect_machine_vault_upload transfers. Returns all active and " +
      "recently completed transfers. Poll every 10-15 seconds. On completed, the response " +
      "carries the final persisted fileName (vaults may uniquify on collision). If concurrency " +
      "is saturated, cancel stalled transfers via architect_transfer_cancel before launching new batches.",
    inputSchema: {
      type: "object" as const,
      properties: {
        transferId: {
          type: "string",
          format: "uuid",
          description: "Optional: UUID of a specific transfer to check. Omit to see all transfers.",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "architect_transfer_cancel",
    description:
      "Cancel an in-progress architect_machine_vault_upload by transferId.",
    inputSchema: {
      type: "object" as const,
      properties: {
        transferId: {
          type: "string",
          format: "uuid",
          description: "UUID of the transfer to cancel (from architect_machine_vault_upload response).",
        },
      },
      required: ["transferId"],
      additionalProperties: false,
    },
  },
  {
    name: "deployment_run_script_bg",
    description:
      "Run a multi-line script on a VM in the background — returns a scriptRunId immediately without blocking. " +
      "The synchronous deployment_run_script tool times out after ~60s and blocks the entire tool call. " +
      "Use this background variant for any script expected to take more than ~30 seconds: " +
      "package installs, builds, long enumeration, large file processing, or anything where timing is uncertain. " +
      "The script runs on the VM for up to timeoutSecs (default 60, max 600). " +
      "Poll deployment_script_status every 10-15 seconds to check progress. " +
      "Supports bash, powershell, sh, python3 — auto-detects from VM OS if omitted. " +
      "You can kick off multiple scripts in parallel across different VMs (max 10 concurrent) and poll them all at once. " +
      "Use deployment_script_cancel to abort a running script and free its concurrency slot.\n\n" +
      "Best for: Long-running scripts that would otherwise timeout; parallel script execution across multiple VMs; uncertain execution times\n" +
      "Notes: Call deployment_list_vms first to get depVMId; Use deployment_run_script (synchronous) for quick scripts under 30s; " +
      "Poll deployment_script_status every 10-15 seconds; Completed runs are retained for 15 minutes; " +
      "timeoutSecs controls how long the script can run on the VM (default 60s, max 600s) — the tool itself returns immediately regardless\n" +
      "Returns: scriptRunId (UUID to poll with deployment_script_status)",
    inputSchema: {
      type: "object" as const,
      properties: {
        deploymentRecordId: {
          type: "string",
          format: "uuid",
          description: "UUID of the deployment record",
        },
        depVMId: {
          type: "string",
          format: "uuid",
          description: "UUID of the deployed VM to run the script on",
        },
        script: {
          type: "string",
          minLength: 1,
          maxLength: 1048576,
          description:
            "Multi-line script content to execute (max 1MB). Supports full shell syntax including variables, loops, pipes, heredocs, and nested quotes.",
        },
        shell: {
          type: "string",
          enum: ["bash", "powershell", "sh", "python3"],
          description:
            "Shell to execute the script with. Auto-detected from VM OS if omitted (bash for Linux, powershell for Windows).",
        },
        timeoutSecs: {
          type: "integer",
          minimum: 1,
          maximum: 600,
          description: "Timeout in seconds, default 60, max 600",
        },
        maxOutputChars: {
          type: "integer",
          minimum: 1000,
          maximum: 100000,
          description: "Max output chars before truncation, default 30000",
        },
      },
      required: ["deploymentRecordId", "depVMId", "script"],
      additionalProperties: false,
    },
  },
  {
    name: "deployment_script_status",
    description:
      "Check the status of background script runs started with deployment_run_script_bg. " +
      "Returns all active and recently completed script runs with their full output. " +
      "Poll every 10-15 seconds while scripts are running. " +
      "Completed and failed runs are retained for 15 minutes before expiring. " +
      "Call with no arguments to see all runs, or pass a specific scriptRunId.\n\n" +
      "Best for: Checking if background scripts have finished; Reading script output after completion; Monitoring parallel script runs\n" +
      "Returns: Array of script runs with scriptRunId, status (running/completed/failed/cancelled), commandOutput, exitCode, executionTimeMs, shell, machineDisplayName",
    inputSchema: {
      type: "object" as const,
      properties: {
        scriptRunId: {
          type: "string",
          format: "uuid",
          description:
            "Optional: UUID of a specific script run to check. Omit to see all script runs.",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "deployment_script_cancel",
    description:
      "Cancel a running background script by scriptRunId. Aborts the in-flight HTTP request to the hub " +
      "and frees the concurrency slot immediately. Note: the script process may continue executing on the VM itself — " +
      "this cancels the MCP-side tracking and connection, not the remote process. " +
      "Use deployment_script_status to find the scriptRunId of running scripts.",
    inputSchema: {
      type: "object" as const,
      properties: {
        scriptRunId: {
          type: "string",
          format: "uuid",
          description: "UUID of the script run to cancel (from deployment_run_script_bg response)",
        },
      },
      required: ["scriptRunId"],
      additionalProperties: false,
    },
  },
];

export function isLocalTool(name: string): boolean {
  return LOCAL_TOOLS.some((t) => t.name === name);
}

export async function handleLocalTool(
  name: string,
  args: Record<string, unknown>,
  auth: AuthProvider,
  hub: HubClient | null
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  switch (name) {
    case "plugin_dev_upload_to_vault":
      return handleTusUpload(args, auth);
    case "architect_machine_vault_upload":
      return handleArchitectMachineVaultUpload(args, auth);
    case "deployment_upload_file":
      return handleActiveDeploymentUpload(args, auth);
    case "deployment_download_file":
      return handleActiveDeploymentDownload(args, auth);
    case "deployment_transfer_status":
      return handleTransferStatus(args, "vm");
    case "plugin_dev_transfer_status":
      return handleTransferStatus(args, "pluginVault");
    case "architect_transfer_status":
      return handleTransferStatus(args, "machineVault");
    case "deployment_transfer_cancel":
      return handleTransferCancel(args, "vm");
    case "plugin_dev_transfer_cancel":
      return handleTransferCancel(args, "pluginVault");
    case "architect_transfer_cancel":
      return handleTransferCancel(args, "machineVault");
    case "deployment_run_script_bg":
      return handleRunScriptBg(args, hub);
    case "deployment_script_status":
      return handleScriptStatus(args);
    case "deployment_script_cancel":
      return handleScriptCancel(args);
    default:
      return {
        content: [{ type: "text", text: `Unknown local tool: ${name}` }],
        isError: true,
      };
  }
}

async function handleTusUpload(
  args: Record<string, unknown>,
  auth: AuthProvider
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const parsed = parseInput(PluginDevUploadSchema, args);
  if (!parsed.success) {
    return { content: [{ type: "text", text: parsed.error }], isError: true };
  }
  const { pluginVersionId } = parsed.data;
  const localFilePath = validateLocalPath(parsed.data.localFilePath, "read");

  if (!fs.existsSync(localFilePath)) {
    return {
      content: [{ type: "text", text: `File not found: ${localFilePath}` }],
      isError: true,
    };
  }
  const fileStats = fs.statSync(localFilePath);
  if (!fileStats.isFile()) {
    return {
      content: [{ type: "text", text: `Path is not a file: ${localFilePath}` }],
      isError: true,
    };
  }

  if (countActiveTransfers() >= MAX_CONCURRENT_TRANSFERS) {
    return {
      content: [
        {
          type: "text",
          text:
            `Too many active transfers (max ${MAX_CONCURRENT_TRANSFERS}). ` +
            `Use plugin_dev_transfer_status to check progress, or cancel a ` +
            `stalled transfer via plugin_dev_transfer_cancel.`,
        },
      ],
      isError: true,
    };
  }
  const duplicate = findDuplicateTransfer(localFilePath, "pluginVault", pluginVersionId);
  if (duplicate) {
    return {
      content: [
        {
          type: "text",
          text: `A transfer is already in progress for this path+target. transferId: ${duplicate.transferId}`,
        },
      ],
      isError: true,
    };
  }

  const originalFileName = path.basename(localFilePath);
  const fileFilesizeBytes = String(fileStats.size);
  const vaultsUrl =
    process.env.ROGUE_VAULTS_URL ?? process.env.ROGUE_HUB_URL ?? "https://arena.roguelabs.io";
  const endpoint = `${vaultsUrl}/vaults/TUSUpload`;

  try {
    const handle = startTusUpload({
      endpoint,
      localFilePath,
      auth,
      tusMetadata: {
        originalFileName,
        vaultID: "",
        vaultType: "scenarioBuilderPlugin",
        uniqueFilterID: pluginVersionId,
        depVMID: "",
        destinationType: "vault",
        fullPathToDestinationFolder: "/",
        fileFilesizeBytes,
      },
      targetKind: "pluginVault",
      targetId: pluginVersionId,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              transferId: handle.transferId,
              fileName: handle.fileName,
              totalBytes: handle.totalBytes,
              message:
                "Upload started. Use plugin_dev_transfer_status to poll progress; " +
                "cancel via plugin_dev_transfer_cancel.",
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: (err as Error).message }],
      isError: true,
    };
  }
}

async function handleArchitectMachineVaultUpload(
  args: Record<string, unknown>,
  auth: AuthProvider
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const parsed = parseInput(ArchitectVaultUploadSchema, args);
  if (!parsed.success) {
    return { content: [{ type: "text", text: parsed.error }], isError: true };
  }
  const { machineId } = parsed.data;
  const localFilePath = validateLocalPath(parsed.data.localFilePath, "read");
  const vaultSubPath = parsed.data.vaultSubPath ?? "/";

  if (vaultSubPath !== "/") {
    return {
      content: [
        {
          type: "text",
          text:
            `MVP only supports vault root. Received vaultSubPath="${vaultSubPath}". ` +
            "For pre-seeded sub-folders, use architect_files_create.",
        },
      ],
      isError: true,
    };
  }

  if (!fs.existsSync(localFilePath)) {
    return {
      content: [{ type: "text", text: `File not found: ${localFilePath}` }],
      isError: true,
    };
  }
  const fileStats = fs.statSync(localFilePath);
  if (!fileStats.isFile()) {
    return {
      content: [{ type: "text", text: `Path is not a file: ${localFilePath}` }],
      isError: true,
    };
  }

  if (countActiveTransfers() >= MAX_CONCURRENT_TRANSFERS) {
    return {
      content: [
        {
          type: "text",
          text:
            `Too many active transfers (max ${MAX_CONCURRENT_TRANSFERS}). ` +
            `Use architect_transfer_status to check progress, or cancel a ` +
            `stalled transfer via architect_transfer_cancel.`,
        },
      ],
      isError: true,
    };
  }
  const duplicate = findDuplicateTransfer(localFilePath, "machineVault", machineId);
  if (duplicate) {
    return {
      content: [
        {
          type: "text",
          text: `A transfer is already in progress for this path+target. transferId: ${duplicate.transferId}`,
        },
      ],
      isError: true,
    };
  }

  const originalFileName = path.basename(localFilePath);
  const fileFilesizeBytes = String(fileStats.size);
  const vaultsUrl =
    process.env.ROGUE_VAULTS_URL ?? process.env.ROGUE_HUB_URL ?? "https://arena.roguelabs.io";
  const endpoint = `${vaultsUrl}/vaults/TUSUpload`;

  try {
    const handle = startTusUpload({
      endpoint,
      localFilePath,
      auth,
      tusMetadata: {
        originalFileName,
        vaultID: "",
        vaultType: "scenarioBuilderMachine",
        uniqueFilterID: machineId,
        depVMID: "",
        destinationType: "vault",
        fullPathToDestinationFolder: "/",
        fileFilesizeBytes,
      },
      targetKind: "machineVault",
      targetId: machineId,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              transferId: handle.transferId,
              fileName: handle.fileName,
              totalBytes: handle.totalBytes,
              message:
                "Upload started. Use architect_transfer_status to poll progress; " +
                "cancel via architect_transfer_cancel. On completion, the status response " +
                "carries the final (possibly uniquified) fileName.",
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: (err as Error).message }],
      isError: true,
    };
  }
}

async function handleActiveDeploymentUpload(
  args: Record<string, unknown>,
  auth: AuthProvider
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const parsed = parseInput(DeploymentUploadSchema, args);
  if (!parsed.success) {
    return { content: [{ type: "text", text: parsed.error }], isError: true };
  }
  const { depVMId, destinationPath } = parsed.data;
  const localFilePath = validateLocalPath(parsed.data.localFilePath, "read");

  if (!fs.existsSync(localFilePath)) {
    return {
      content: [{ type: "text", text: `File not found: ${localFilePath}` }],
      isError: true,
    };
  }
  const fileStats = fs.statSync(localFilePath);
  if (!fileStats.isFile()) {
    return {
      content: [{ type: "text", text: `Path is not a file: ${localFilePath}` }],
      isError: true,
    };
  }

  if (countActiveTransfers() >= MAX_CONCURRENT_TRANSFERS) {
    return {
      content: [
        {
          type: "text",
          text:
            `Too many active transfers (max ${MAX_CONCURRENT_TRANSFERS}). ` +
            `Use deployment_transfer_status to check progress, or cancel a ` +
            `stalled transfer via deployment_transfer_cancel.`,
        },
      ],
      isError: true,
    };
  }
  const duplicate = findDuplicateTransfer(localFilePath, "vm", depVMId);
  if (duplicate) {
    return {
      content: [
        {
          type: "text",
          text: `A transfer is already in progress for this path+target. transferId: ${duplicate.transferId}`,
        },
      ],
      isError: true,
    };
  }

  // If destinationPath ends with a separator it's a folder; otherwise the last segment is the filename.
  const destIsFolder = destinationPath.endsWith("/") || destinationPath.endsWith("\\");
  const originalFileName = destIsFolder ? path.basename(localFilePath) : path.basename(destinationPath);
  const destinationFolder = destIsFolder ? destinationPath : destinationPath.replace(/[^/\\]+$/, "");
  const fileFilesizeBytes = String(fileStats.size);

  const vaultsUrl =
    process.env.ROGUE_VAULTS_URL ?? process.env.ROGUE_HUB_URL ?? "https://arena.roguelabs.io";
  const endpoint = `${vaultsUrl}/vaults/TUSUpload`;

  try {
    const handle = startTusUpload({
      endpoint,
      localFilePath,
      auth,
      tusMetadata: {
        originalFileName,
        vaultID: "",
        depVMID: depVMId,
        destinationType: "vm",
        vmEntityType: "DEPLOYED_VIRTUAL_MACHINE",
        fullPathToDestinationFolder: destinationFolder,
        fileFilesizeBytes,
      },
      targetKind: "vm",
      targetId: depVMId,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              transferId: handle.transferId,
              fileName: handle.fileName,
              totalBytes: handle.totalBytes,
              message:
                "Upload started. Use deployment_transfer_status to poll progress; " +
                "cancel via deployment_transfer_cancel.",
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: (err as Error).message }],
      isError: true,
    };
  }
}

async function handleActiveDeploymentDownload(
  args: Record<string, unknown>,
  auth: AuthProvider
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const parsed = parseInput(DeploymentDownloadSchema, args);
  if (!parsed.success) {
    return { content: [{ type: "text", text: parsed.error }], isError: true };
  }
  const { depVMId, remoteFilePath } = parsed.data;
  const localDestinationPath = validateLocalPath(parsed.data.localDestinationPath, "write");

  // Concurrency and duplicate checks
  if (countActiveTransfers() >= MAX_CONCURRENT_TRANSFERS) {
    return {
      content: [{ type: "text", text: `Too many active transfers (max ${MAX_CONCURRENT_TRANSFERS}). Use deployment_transfer_status to check progress or deployment_transfer_cancel to free a slot.` }],
      isError: true,
    };
  }
  const duplicate = findDuplicateTransfer(localDestinationPath, "vm", depVMId);
  if (duplicate) {
    return {
      content: [{ type: "text", text: `A transfer is already in progress for this path. transferId: ${duplicate.transferId}` }],
      isError: true,
    };
  }

  const vaultsUrl =
    process.env.ROGUE_VAULTS_URL ?? process.env.ROGUE_HUB_URL ?? "https://arena.roguelabs.io";
  const authHeaders = await auth.getHeaders();
  const fileName = path.basename(remoteFilePath);

  // Create transfer state
  const transferId = randomUUID();
  const abortController = new AbortController();
  const state: TransferState = {
    transferId,
    fileName,
    direction: "download",
    status: "in_progress",
    targetKind: "vm",
    targetId: depVMId,
    localPath: localDestinationPath,
    bytesTransferred: 0,
    totalBytes: 0,
    startTime: new Date().toISOString(),
    _abortController: abortController,
  };
  activeTransfers.set(transferId, state);

  console.error(
    `[rogue-arena-mcp] Download [${transferId}]: depVM=${depVMId} remote=${remoteFilePath} → ${localDestinationPath}`
  );

  // Fire-and-forget async IIFE with top-level catch
  (async () => {
    // Step 1: Generate download link
    const generateRes = await fetch(`${vaultsUrl}/vaults/generateDownloadLink`, {
      method: "POST",
      headers: authHeaders,
      signal: abortController.signal,
      body: JSON.stringify({
        sourceType: "vm",
        depVMIDOrVaultID: depVMId,
        fullPathToFile: remoteFilePath,
        fileSizeBytes: 0,
        vmEntityType: "DEPLOYED_VIRTUAL_MACHINE",
      }),
    });

    if (!generateRes.ok) {
      const text = await generateRes.text();
      console.error(`[rogue-arena-mcp] Download [${transferId}]: generate link failed (${generateRes.status}): ${text.replace(/[^\x20-\x7E\n]/g, "").slice(0, 500)}`);
      throw new Error(`Failed to generate download link (HTTP ${generateRes.status})`);
    }

    const generateBody = (await generateRes.json()) as { downloadID: string };
    const downloadID = generateBody.downloadID;

    console.error(`[rogue-arena-mcp] Download [${transferId}]: link generated, downloadID=${downloadID}`);

    // Step 2: Fetch the download
    const fetchRes = await fetch(`${vaultsUrl}/vaults/fetchDownload`, {
      method: "POST",
      headers: authHeaders,
      signal: abortController.signal,
      body: JSON.stringify({ downloadID }),
    });

    if (!fetchRes.ok) {
      const text = await fetchRes.text();
      console.error(`[rogue-arena-mcp] Download [${transferId}]: fetch failed (${fetchRes.status}): ${text.replace(/[^\x20-\x7E\n]/g, "").slice(0, 500)}`);
      throw new Error(`Failed to fetch download (HTTP ${fetchRes.status})`);
    }

    if (!fetchRes.body) {
      throw new Error("Empty response body from download endpoint");
    }

    // Read Content-Length if available
    const contentLength = fetchRes.headers.get("content-length");
    if (contentLength) {
      state.totalBytes = parseInt(contentLength, 10) || 0;
    }

    // Step 3: Stream to disk via temp file — avoids clobbering existing file on failure
    const localDir = path.dirname(localDestinationPath);
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }

    const tempPath = localDestinationPath + ".partial";
    const writeStream = fs.createWriteStream(tempPath);
    state._writeStream = writeStream;

    // Counting transform — updates bytesTransferred on each chunk
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        state.bytesTransferred += chunk.length;
        callback(null, chunk);
      },
    });

    const readable = Readable.fromWeb(fetchRes.body as import("node:stream/web").ReadableStream);

    await pipeline(readable, counter, writeStream);

    // Atomically promote temp file to final destination
    fs.renameSync(tempPath, localDestinationPath);

    console.error(
      `[rogue-arena-mcp] Download complete [${transferId}]: ${state.bytesTransferred} bytes → ${localDestinationPath}`
    );
    finishTransfer(state, "completed");
  })().catch((err: Error) => {
    const isAbort = err.name === "AbortError";
    console.error(
      `[rogue-arena-mcp] Download ${isAbort ? "cancelled" : "failed"} [${transferId}]: ${err.message}`
    );

    // Clean up write stream and temp file
    if (state._writeStream) {
      state._writeStream.destroy();
    }

    const tempPath = localDestinationPath + ".partial";
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch (unlinkErr) {
        console.error(`[rogue-arena-mcp] Failed to delete temp file: ${unlinkErr}`);
      }
    }

    finishTransfer(
      state,
      isAbort ? "cancelled" : "failed",
      isAbort ? "Transfer cancelled" : "Download failed — see server logs for details"
    );
  });

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            transferId,
            fileName,
            message: "Download started. Use deployment_transfer_status to poll progress.",
          },
          null,
          2
        ),
      },
    ],
  };
}

function handleTransferStatus(
  args: Record<string, unknown>,
  allowedKind: TargetKind
): { content: Array<{ type: "text"; text: string }>; isError?: boolean } {
  const parsed = parseInput(TransferStatusSchema, args);
  if (!parsed.success) {
    return { content: [{ type: "text", text: parsed.error }], isError: true };
  }
  const { transferId } = parsed.data;

  if (transferId) {
    const state = activeTransfers.get(transferId);
    if (!state || state.targetKind !== allowedKind) {
      return {
        content: [{ type: "text", text: JSON.stringify({ transfers: [], message: "Transfer not found." }, null, 2) }],
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify({ transfers: [serializeTransfer(state)] }, null, 2) }],
    };
  }

  const transfers = [...activeTransfers.values()]
    .filter((s) => s.targetKind === allowedKind)
    .map(serializeTransfer);
  if (transfers.length === 0) {
    return {
      content: [{ type: "text", text: JSON.stringify({ transfers: [], message: "No active or recent transfers." }, null, 2) }],
    };
  }
  return {
    content: [{ type: "text", text: JSON.stringify({ transfers }, null, 2) }],
  };
}

async function handleTransferCancel(
  args: Record<string, unknown>,
  allowedKind: TargetKind
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const parsed = parseInput(TransferCancelSchema, args);
  if (!parsed.success) {
    return { content: [{ type: "text", text: parsed.error }], isError: true };
  }
  const { transferId } = parsed.data;

  const state = activeTransfers.get(transferId);
  if (!state || state.status !== "in_progress" || state.targetKind !== allowedKind) {
    return {
      content: [{ type: "text", text: "Transfer not found or already completed." }],
      isError: true,
    };
  }

  // Abort upload
  if (state._tusUpload) {
    try {
      await state._tusUpload.abort(true);
    } catch (err) {
      console.error(`[rogue-arena-mcp] TUS abort error (non-fatal): ${err}`);
    }
  }

  // Abort download — triggers the IIFE's catch handler which cleans up streams + partial file
  if (state._abortController) {
    state._abortController.abort();
  }

  finishTransfer(state, "cancelled", "Cancelled by user");

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ transferId, status: "cancelled", message: "Transfer cancelled." }, null, 2),
      },
    ],
  };
}

async function handleRunScriptBg(
  args: Record<string, unknown>,
  hub: HubClient | null
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  if (!hub) {
    return {
      content: [{ type: "text", text: "Hub client not available. Cannot run background scripts in degraded mode." }],
      isError: true,
    };
  }

  const parsed = parseInput(RunScriptBgSchema, args);
  if (!parsed.success) {
    return { content: [{ type: "text", text: parsed.error }], isError: true };
  }
  const { deploymentRecordId, depVMId, script, shell, timeoutSecs, maxOutputChars } = parsed.data;

  if (countActiveScriptRuns() >= MAX_CONCURRENT_SCRIPT_RUNS) {
    return {
      content: [{ type: "text", text: `Too many active script runs (max ${MAX_CONCURRENT_SCRIPT_RUNS}). Use deployment_script_status to check progress or deployment_script_cancel to free a slot.` }],
      isError: true,
    };
  }

  const scriptRunId = randomUUID();
  const abortController = new AbortController();
  const state: ScriptRunState = {
    scriptRunId,
    depVMId,
    status: "running",
    startTime: new Date().toISOString(),
    _abortController: abortController,
  };
  activeScriptRuns.set(scriptRunId, state);

  // Build the args to forward to the hub's deployment_run_script tool
  const hubArgs: Record<string, unknown> = {
    deploymentRecordId,
    depVMId,
    script,
  };
  if (shell !== undefined) hubArgs.shell = shell;
  if (timeoutSecs !== undefined) hubArgs.timeoutSecs = timeoutSecs;
  if (maxOutputChars !== undefined) hubArgs.maxOutputChars = maxOutputChars;

  console.error(
    `[rogue-arena-mcp] Script run started [${scriptRunId}]: depVM=${depVMId}, script=${script.length} chars`
  );

  // Timeout = script timeout + 30s grace for hub overhead. Prevents a hung VM from pinning a slot forever.
  const timeoutMs = ((timeoutSecs ?? 300) + 30) * 1000;
  const combinedSignal = AbortSignal.any([abortController.signal, AbortSignal.timeout(timeoutMs)]);

  // Fire and forget — do NOT await. Signal allows cancel or timeout to abort the HTTP request.
  hub.executeActiveDeploymentTool("deployment_run_script", hubArgs, { signal: combinedSignal })
    .then((result) => {
      // If cancelled while in-flight, don't overwrite the cancelled status
      if (state.status !== "running") return;

      if (!result.success) {
        console.error(`[rogue-arena-mcp] Script run failed [${scriptRunId}]: ${result.error}`);
        finishScriptRun(state, "failed", result.error ?? "Unknown error");
        return;
      }

      // Store raw hub response — avoids shape coupling, keeps output in sync with hub automatically
      state.resultData = result.data;

      console.error(
        `[rogue-arena-mcp] Script run completed [${scriptRunId}]`
      );
      finishScriptRun(state, "completed");
    })
    .catch((err: unknown) => {
      if (state.status !== "running") return;
      const isTimeout = err instanceof Error && err.name === "TimeoutError";
      const msg = isTimeout
        ? `Script run timed out after ${timeoutMs / 1000}s`
        : (err instanceof Error ? err.message : String(err));
      console.error(`[rogue-arena-mcp] Script run error [${scriptRunId}]: ${msg}`);
      finishScriptRun(state, "failed", msg);
    });

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            scriptRunId,
            depVMId,
            message: "Script started in background. Use deployment_script_status to poll for results.",
          },
          null,
          2
        ),
      },
    ],
  };
}

function handleScriptStatus(
  args: Record<string, unknown>
): { content: Array<{ type: "text"; text: string }>; isError?: boolean } {
  const parsed = parseInput(ScriptStatusSchema, args);
  if (!parsed.success) {
    return { content: [{ type: "text", text: parsed.error }], isError: true };
  }
  const { scriptRunId } = parsed.data;

  if (scriptRunId) {
    const state = activeScriptRuns.get(scriptRunId);
    if (!state) {
      return {
        content: [{ type: "text", text: JSON.stringify({ scriptRuns: [], message: "Script run not found or expired (results retained for 15 minutes)." }, null, 2) }],
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify({ scriptRuns: [serializeScriptRun(state)] }, null, 2) }],
    };
  }

  const scriptRuns = [...activeScriptRuns.values()].map(serializeScriptRun);
  if (scriptRuns.length === 0) {
    return {
      content: [{ type: "text", text: JSON.stringify({ scriptRuns: [], message: "No active or recent script runs." }, null, 2) }],
    };
  }
  return {
    content: [{ type: "text", text: JSON.stringify({ scriptRuns }, null, 2) }],
  };
}

function handleScriptCancel(
  args: Record<string, unknown>
): { content: Array<{ type: "text"; text: string }>; isError?: boolean } {
  const parsed = parseInput(ScriptCancelSchema, args);
  if (!parsed.success) {
    return { content: [{ type: "text", text: parsed.error }], isError: true };
  }
  const { scriptRunId } = parsed.data;

  const state = activeScriptRuns.get(scriptRunId);
  if (!state || state.status !== "running") {
    return {
      content: [{ type: "text", text: "Script run not found or already completed." }],
      isError: true,
    };
  }

  // Abort the in-flight hub request (best-effort — the script may continue on the VM)
  if (state._abortController) {
    state._abortController.abort();
  }

  finishScriptRun(state, "cancelled", "Cancelled by user");

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            scriptRunId,
            status: "cancelled",
            message: "Script run cancelled. Note: the script may still be running on the VM — this only stops tracking.",
          },
          null,
          2
        ),
      },
    ],
  };
}
