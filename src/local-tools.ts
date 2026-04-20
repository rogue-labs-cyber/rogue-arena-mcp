import { Upload } from "tus-js-client";
import * as fs from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";
import type { AuthProvider } from "./auth.js";
import type { HubClient } from "./hub-client.js";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";

const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MiB
const UPLOAD_BPS = 20 * 1024 * 1024; // 20 MB/s cap

// Fail-fast UUID check. Vaults' Zod schema validates the same way server-side,
// but catching the common LLM typo here avoids a pointless TCP + TUS round-trip.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Async transfer tracking ────────────────────────────────────────
const MAX_CONCURRENT_TRANSFERS = 5;
const TRANSFER_CLEANUP_MS = 300_000; // 5 minutes

interface TransferState {
  transferId: string;
  fileName: string;
  direction: "upload" | "download";
  status: "in_progress" | "completed" | "failed" | "cancelled";
  depVMId: string;
  localPath: string;
  bytesTransferred: number;
  totalBytes: number;
  startTime: string;
  endTime?: string;
  error?: string;
  _abortController?: AbortController;
  _tusUpload?: Upload;
  _writeStream?: fs.WriteStream;
}

const activeTransfers = new Map<string, TransferState>();

function finishTransfer(
  state: TransferState,
  status: "completed" | "failed" | "cancelled",
  error?: string
): void {
  if (state.status !== "in_progress") return;
  state.status = status;
  state.endTime = new Date().toISOString();
  if (error) state.error = error;
  state._abortController = undefined;
  state._tusUpload = undefined;
  state._writeStream = undefined;
  setTimeout(() => activeTransfers.delete(state.transferId), TRANSFER_CLEANUP_MS);
}

function countActiveTransfers(): number {
  let count = 0;
  for (const t of activeTransfers.values()) {
    if (t.status === "in_progress") count++;
  }
  return count;
}

function findDuplicateTransfer(localPath: string): TransferState | undefined {
  for (const t of activeTransfers.values()) {
    if (t.status === "in_progress" && t.localPath === localPath) return t;
  }
  return undefined;
}

function serializeTransfer(state: TransferState): Record<string, unknown> {
  const result: Record<string, unknown> = {
    transferId: state.transferId,
    fileName: state.fileName,
    direction: state.direction,
    status: state.status,
    depVMId: state.depVMId,
    bytesTransferred: state.bytesTransferred,
    totalBytes: state.totalBytes,
    startTime: state.startTime,
  };
  if (state.totalBytes > 0) {
    result.progressPercent = Math.round((state.bytesTransferred / state.totalBytes) * 100);
  }
  if (state.endTime) result.endTime = state.endTime;
  if (state.error) result.error = state.error;
  return result;
}

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

export interface LocalToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const LOCAL_TOOLS: LocalToolDefinition[] = [
  {
    name: "plugin_dev_upload_to_vault",
    description:
      "Upload a local file to a plugin version's vault using TUS resumable upload. Supports large files (multi-GB). Requires pluginVersionId, vaultId (from plugin_dev_get_version), and local file path.",
    inputSchema: {
      type: "object" as const,
      properties: {
        pluginVersionId: {
          type: "string",
          description: "UUID of the plugin version",
        },
        vaultId: {
          type: "string",
          description: "UUID of the vault (from plugin_dev_get_version response)",
        },
        localFilePath: {
          type: "string",
          description: "Absolute path to the file on the local machine",
        },
      },
      required: ["pluginVersionId", "vaultId", "localFilePath"],
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
          description: "UUID of the deployment VM",
        },
        localFilePath: {
          type: "string",
          description: "Absolute path to the file on the local machine",
        },
        destinationPath: {
          type: "string",
          description: "Full destination path on the VM (e.g. /home/user/file.txt)",
        },
      },
      required: ["depVMId", "localFilePath", "destinationPath"],
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
          description: "UUID of the deployment VM",
        },
        remoteFilePath: {
          type: "string",
          description: "Full path to the file on the VM (e.g. /home/user/file.txt)",
        },
        localDestinationPath: {
          type: "string",
          description: "Absolute local path where the file should be saved",
        },
      },
      required: ["depVMId", "remoteFilePath", "localDestinationPath"],
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
          description: "Optional: UUID of a specific transfer to check. Omit to see all transfers.",
        },
      },
      required: [],
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
          description: "UUID of the transfer to cancel (from deployment_upload_file or deployment_download_file response)",
        },
      },
      required: ["transferId"],
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
          description: "UUID of the deployment record",
        },
        depVMId: {
          type: "string",
          description: "UUID of the deployed VM to run the script on",
        },
        script: {
          type: "string",
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
          description:
            "Optional: UUID of a specific script run to check. Omit to see all script runs.",
        },
      },
      required: [],
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
          description: "UUID of the script run to cancel (from deployment_run_script_bg response)",
        },
      },
      required: ["scriptRunId"],
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
    case "deployment_upload_file":
      return handleActiveDeploymentUpload(args, auth);
    case "deployment_download_file":
      return handleActiveDeploymentDownload(args, auth);
    case "deployment_transfer_status":
      return handleTransferStatus(args);
    case "deployment_transfer_cancel":
      return handleTransferCancel(args);
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
  const pluginVersionId = args["pluginVersionId"] as string;
  const vaultId = args["vaultId"] as string;
  const localFilePath = validateLocalPath(args["localFilePath"] as string, "read");

  // Validate file exists
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

  const originalFileName = path.basename(localFilePath);
  const fileFilesizeBytes = String(fileStats.size);

  // Determine vaults URL
  const vaultsUrl =
    process.env.ROGUE_VAULTS_URL ?? process.env.ROGUE_HUB_URL ?? "https://arena.roguelabs.io";

  const endpoint = `${vaultsUrl}/vaults/TUSUpload`;

  // Get auth headers
  const authHeaders = await auth.getHeaders();
  // Strip Content-Type — TUS sets its own
  const { "Content-Type": _ct, ...tusHeaders } = authHeaders;

  console.error(
    `[rogue-arena-mcp] TUS upload: ${originalFileName} (${fileStats.size} bytes) → ${endpoint}`
  );

  return new Promise((resolve) => {
    // Track last-logged percentage for 10% interval reporting
    let lastLoggedPct = -1;

    // Throttle tracking: time of last chunk start and bytes sent in current chunk window
    let lastChunkTime = Date.now();

    const fileStream = fs.createReadStream(localFilePath);

    const upload = new Upload(fileStream, {
      endpoint,
      chunkSize: CHUNK_SIZE,
      uploadSize: fileStats.size,
      headers: tusHeaders,
      metadata: {
        originalFileName,
        vaultID: vaultId,
        depVMID: "",
        destinationType: "vault",
        fullPathToDestinationFolder: "/",
        fileFilesizeBytes,
      },
      retryDelays: [0, 3000, 5000, 10000],
      onBeforeRequest: (req) => {
        // Throttle PATCH requests to ~20 MB/s by sleeping between chunks
        if (req.getMethod() === "PATCH") {
          const now = Date.now();
          const elapsed = now - lastChunkTime;
          const expectedMs = Math.floor((CHUNK_SIZE / UPLOAD_BPS) * 1000);
          const sleepMs = expectedMs - elapsed;
          if (sleepMs > 0) {
            return new Promise((res) => setTimeout(res, sleepMs));
          }
          lastChunkTime = now;
        }
      },
      onProgress: (bytesSent, bytesTotal) => {
        if (bytesTotal > 0) {
          const pct = Math.floor((bytesSent / bytesTotal) * 100);
          const logPct = Math.floor(pct / 10) * 10;
          if (logPct > lastLoggedPct) {
            lastLoggedPct = logPct;
            console.error(
              `[rogue-arena-mcp] TUS upload progress: ${logPct}% (${bytesSent}/${bytesTotal} bytes)`
            );
          }
        }
      },
      onSuccess: () => {
        console.error(`[rogue-arena-mcp] TUS upload complete: ${originalFileName}`);
        resolve({
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  fileName: originalFileName,
                  fileSizeBytes: fileStats.size,
                  vaultId,
                  pluginVersionId,
                },
                null,
                2
              ),
            },
          ],
        });
      },
      onError: (err) => {
        console.error(`[rogue-arena-mcp] TUS upload error: ${err.message}`);
        resolve({
          content: [{ type: "text", text: `Upload failed: ${err.message}` }],
          isError: true,
        });
      },
    });

    upload.start();
  });
}

async function handleActiveDeploymentUpload(
  args: Record<string, unknown>,
  auth: AuthProvider
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const depVMId = args["depVMId"] as string;
  const localFilePath = validateLocalPath(args["localFilePath"] as string, "read");
  const destinationPath = args["destinationPath"] as string;

  if (!UUID_RE.test(depVMId ?? "")) {
    return {
      content: [{ type: "text", text: `Invalid UUID format for depVMId: ${depVMId}` }],
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

  // Concurrency and duplicate checks
  if (countActiveTransfers() >= MAX_CONCURRENT_TRANSFERS) {
    return {
      content: [{ type: "text", text: `Too many active transfers (max ${MAX_CONCURRENT_TRANSFERS}). Use deployment_transfer_status to check progress or deployment_transfer_cancel to free a slot.` }],
      isError: true,
    };
  }
  const duplicate = findDuplicateTransfer(localFilePath);
  if (duplicate) {
    return {
      content: [{ type: "text", text: `A transfer is already in progress for this path. transferId: ${duplicate.transferId}` }],
      isError: true,
    };
  }

  const originalFileName = path.basename(localFilePath);
  // path.dirname doesn't understand Windows backslashes on macOS/Linux —
  // strip the filename, keeping the trailing separator (vaults concatenates folder + filename directly)
  const destinationFolder = destinationPath.replace(/[^/\\]+$/, "");
  const fileFilesizeBytes = String(fileStats.size);

  const vaultsUrl =
    process.env.ROGUE_VAULTS_URL ?? process.env.ROGUE_HUB_URL ?? "https://arena.roguelabs.io";
  const endpoint = `${vaultsUrl}/vaults/TUSUpload`;

  const authHeaders = await auth.getHeaders();
  const { "Content-Type": _ct, ...tusHeaders } = authHeaders;

  // Create transfer state
  const transferId = randomUUID();
  const state: TransferState = {
    transferId,
    fileName: originalFileName,
    direction: "upload",
    status: "in_progress",
    depVMId,
    localPath: localFilePath,
    bytesTransferred: 0,
    totalBytes: fileStats.size,
    startTime: new Date().toISOString(),
  };
  activeTransfers.set(transferId, state);

  console.error(
    `[rogue-arena-mcp] TUS upload (dep VM): ${originalFileName} (${fileStats.size} bytes) → ${endpoint} [${transferId}]`
  );

  // Throttle tracking
  let lastChunkTime = Date.now();
  let lastLoggedPct = -1;

  const fileStream = fs.createReadStream(localFilePath);

  const upload = new Upload(fileStream, {
    endpoint,
    chunkSize: CHUNK_SIZE,
    uploadSize: fileStats.size,
    headers: tusHeaders,
    metadata: {
      originalFileName,
      vaultID: "",
      depVMID: depVMId,
      destinationType: "vm",
      vmEntityType: "DEPLOYED_VIRTUAL_MACHINE",
      fullPathToDestinationFolder: destinationFolder,
      fileFilesizeBytes,
    },
    retryDelays: [0, 3000, 5000, 10000],
    onBeforeRequest: (req) => {
      if (req.getMethod() === "PATCH") {
        const now = Date.now();
        const elapsed = now - lastChunkTime;
        const expectedMs = Math.floor((CHUNK_SIZE / UPLOAD_BPS) * 1000);
        const sleepMs = expectedMs - elapsed;
        if (sleepMs > 0) {
          return new Promise((res) => setTimeout(res, sleepMs));
        }
        lastChunkTime = now;
      }
    },
    onProgress: (bytesSent, bytesTotal) => {
      state.bytesTransferred = bytesSent;
      if (bytesTotal > 0) {
        const pct = Math.floor((bytesSent / bytesTotal) * 100);
        const logPct = Math.floor(pct / 10) * 10;
        if (logPct > lastLoggedPct) {
          lastLoggedPct = logPct;
          console.error(
            `[rogue-arena-mcp] Upload [${transferId}]: ${logPct}% (${bytesSent}/${bytesTotal} bytes)`
          );
        }
      }
    },
    onSuccess: () => {
      state.bytesTransferred = fileStats.size;
      console.error(`[rogue-arena-mcp] Upload complete [${transferId}]: ${originalFileName}`);
      finishTransfer(state, "completed");
    },
    onError: (err) => {
      console.error(`[rogue-arena-mcp] Upload failed [${transferId}]: ${err.message}`);
      finishTransfer(state, "failed", err.message);
    },
  });

  state._tusUpload = upload;

  // Fire and forget — do NOT await
  upload.start();

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            transferId,
            fileName: originalFileName,
            totalBytes: fileStats.size,
            message: "Upload started. Use deployment_transfer_status to poll progress.",
          },
          null,
          2
        ),
      },
    ],
  };
}

async function handleActiveDeploymentDownload(
  args: Record<string, unknown>,
  auth: AuthProvider
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const depVMId = args["depVMId"] as string;
  const remoteFilePath = args["remoteFilePath"] as string;
  const localDestinationPath = validateLocalPath(args["localDestinationPath"] as string, "write");

  if (!UUID_RE.test(depVMId ?? "")) {
    return {
      content: [{ type: "text", text: `Invalid UUID format for depVMId: ${depVMId}` }],
      isError: true,
    };
  }

  // Concurrency and duplicate checks
  if (countActiveTransfers() >= MAX_CONCURRENT_TRANSFERS) {
    return {
      content: [{ type: "text", text: `Too many active transfers (max ${MAX_CONCURRENT_TRANSFERS}). Use deployment_transfer_status to check progress or deployment_transfer_cancel to free a slot.` }],
      isError: true,
    };
  }
  const duplicate = findDuplicateTransfer(localDestinationPath);
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
    depVMId,
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
      throw new Error(`Failed to generate download link (${generateRes.status}): ${text.replace(/[^\x20-\x7E\n]/g, "").slice(0, 200)}`);
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
      throw new Error(`Failed to fetch download (${fetchRes.status}): ${text.replace(/[^\x20-\x7E\n]/g, "").slice(0, 200)}`);
    }

    if (!fetchRes.body) {
      throw new Error("Empty response body from download endpoint");
    }

    // Read Content-Length if available
    const contentLength = fetchRes.headers.get("content-length");
    if (contentLength) {
      state.totalBytes = parseInt(contentLength, 10) || 0;
    }

    // Step 3: Stream to disk
    const localDir = path.dirname(localDestinationPath);
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }

    const writeStream = fs.createWriteStream(localDestinationPath);
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

    console.error(
      `[rogue-arena-mcp] Download complete [${transferId}]: ${state.bytesTransferred} bytes → ${localDestinationPath}`
    );
    finishTransfer(state, "completed");
  })().catch((err: Error) => {
    const isAbort = err.name === "AbortError";
    console.error(
      `[rogue-arena-mcp] Download ${isAbort ? "cancelled" : "failed"} [${transferId}]: ${err.message}`
    );

    // Clean up write stream
    if (state._writeStream) {
      state._writeStream.destroy();
    }

    // Delete partial file if it exists
    if (fs.existsSync(localDestinationPath)) {
      try {
        fs.unlinkSync(localDestinationPath);
        console.error(`[rogue-arena-mcp] Deleted partial file: ${localDestinationPath}`);
      } catch (unlinkErr) {
        console.error(`[rogue-arena-mcp] Failed to delete partial file: ${unlinkErr}`);
      }
    }

    finishTransfer(
      state,
      isAbort ? "cancelled" : "failed",
      isAbort ? "Transfer cancelled" : err.message
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
  args: Record<string, unknown>
): { content: Array<{ type: "text"; text: string }>; isError?: boolean } {
  const transferId = args["transferId"] as string | undefined;

  if (transferId) {
    const state = activeTransfers.get(transferId);
    if (!state) {
      return {
        content: [{ type: "text", text: JSON.stringify({ transfers: [], message: "Transfer not found." }, null, 2) }],
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify({ transfers: [serializeTransfer(state)] }, null, 2) }],
    };
  }

  const transfers = [...activeTransfers.values()].map(serializeTransfer);
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
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const transferId = args["transferId"] as string;
  if (!transferId) {
    return {
      content: [{ type: "text", text: "transferId is required." }],
      isError: true,
    };
  }

  const state = activeTransfers.get(transferId);
  if (!state || state.status !== "in_progress") {
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

  const deploymentRecordId = args["deploymentRecordId"] as string;
  const depVMId = args["depVMId"] as string;
  const script = args["script"] as string;

  if (!deploymentRecordId || !depVMId || !script) {
    return {
      content: [{ type: "text", text: "deploymentRecordId, depVMId, and script are required." }],
      isError: true,
    };
  }

  if (!UUID_RE.test(deploymentRecordId)) {
    return {
      content: [{ type: "text", text: `Invalid UUID format for deploymentRecordId: ${deploymentRecordId}` }],
      isError: true,
    };
  }
  if (!UUID_RE.test(depVMId)) {
    return {
      content: [{ type: "text", text: `Invalid UUID format for depVMId: ${depVMId}` }],
      isError: true,
    };
  }

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
  if (args["shell"] !== undefined) hubArgs.shell = args["shell"];
  if (args["timeoutSecs"] !== undefined) hubArgs.timeoutSecs = args["timeoutSecs"];
  if (args["maxOutputChars"] !== undefined) hubArgs.maxOutputChars = args["maxOutputChars"];

  console.error(
    `[rogue-arena-mcp] Script run started [${scriptRunId}]: depVM=${depVMId}, script=${script.length} chars`
  );

  // Fire and forget — do NOT await. Signal allows cancel to abort the HTTP request.
  hub.executeActiveDeploymentTool("deployment_run_script", hubArgs, { signal: abortController.signal })
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
      const msg = err instanceof Error ? err.message : String(err);
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
  const scriptRunId = args["scriptRunId"] as string | undefined;

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
  const scriptRunId = args["scriptRunId"] as string;
  if (!scriptRunId) {
    return {
      content: [{ type: "text", text: "scriptRunId is required." }],
      isError: true,
    };
  }

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
