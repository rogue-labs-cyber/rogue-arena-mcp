import { Upload } from "tus-js-client";
import * as fs from "node:fs";
import { randomUUID } from "node:crypto";
import type { AuthProvider } from "./auth.js";

export const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MiB
export const UPLOAD_BPS = 20 * 1024 * 1024; // 20 MB/s cap

// Bumped from 5 → 8 to give three categories (deployment, plugin, architect)
// slot headroom. Revisit if starvation repros in practice.
export const MAX_CONCURRENT_TRANSFERS = 8;

const TRANSFER_CLEANUP_MS = 300_000; // 5 min

export type TargetKind = "vm" | "pluginVault" | "machineVault";

export interface TransferState {
  transferId:       string;
  fileName:         string;
  direction:        "upload" | "download";
  status:           "in_progress" | "completed" | "failed" | "cancelled";
  targetKind:       TargetKind;
  targetId:         string;
  localPath:        string;
  bytesTransferred: number;
  totalBytes:       number;
  startTime:        string;
  endTime?:         string;
  error?:           string;
  _abortController?: AbortController;
  _tusUpload?:       Upload;
  _writeStream?:     fs.WriteStream;
}

export const activeTransfers = new Map<string, TransferState>();

export function finishTransfer(
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

export function countActiveTransfers(): number {
  let count = 0;
  for (const t of activeTransfers.values()) {
    if (t.status === "in_progress") count++;
  }
  return count;
}

export function findDuplicateTransfer(
  localPath: string,
  targetKind: TargetKind,
  targetId: string
): TransferState | undefined {
  for (const t of activeTransfers.values()) {
    if (
      t.status === "in_progress" &&
      t.localPath === localPath &&
      t.targetKind === targetKind &&
      t.targetId === targetId
    ) {
      return t;
    }
  }
  return undefined;
}

export function serializeTransfer(state: TransferState): Record<string, unknown> {
  const result: Record<string, unknown> = {
    transferId: state.transferId,
    fileName: state.fileName,
    direction: state.direction,
    status: state.status,
    targetKind: state.targetKind,
    targetId: state.targetId,
    bytesTransferred: state.bytesTransferred,
    totalBytes: state.totalBytes,
    startTime: state.startTime,
  };
  // Compat alias — existing playbooks / smoke tests / MCP pass-files read
  // `depVMId`. Deprecate in a follow-up once callers migrate to
  // targetKind/targetId.
  if (state.targetKind === "vm") {
    result.depVMId = state.targetId;
  }
  if (state.totalBytes > 0) {
    result.progressPercent = Math.round((state.bytesTransferred / state.totalBytes) * 100);
  }
  if (state.endTime) result.endTime = state.endTime;
  if (state.error) result.error = state.error;
  return result;
}

export interface StartTusUploadParams {
  endpoint:      string;
  localFilePath: string;
  auth:          AuthProvider;
  tusMetadata:   Record<string, string>;
  targetKind:    TargetKind;
  targetId:      string;
}

export interface TusUploadHandle {
  transferId: string;
  fileName:   string;
  totalBytes: number;
}

/**
 * Start a TUS upload. Fire-and-forget: returns immediately with a handle;
 * bytes stream in the background and state updates live in `activeTransfers`.
 *
 * The shared onBeforeRequest hook:
 *   1. Refreshes the Authorization header by calling auth.getHeaders() before
 *      every attempt. This fixes a latent bug where the static `headers` option
 *      was captured once at Upload construction, and tus-js-client replayed the
 *      stale bearer on retry — so a multi-GB upload outliving the access token
 *      401'd and burned through retryDelays with the dead bearer.
 *   2. Throttles PATCH requests to UPLOAD_BPS.
 *
 * Call sites must check countActiveTransfers() and findDuplicateTransfer()
 * themselves before calling this; startTusUpload does not duplicate those
 * guards so per-tool error messages can reference the right category's
 * status/cancel tool names.
 */
export function startTusUpload(params: StartTusUploadParams): TusUploadHandle {
  const { endpoint, localFilePath, auth, tusMetadata, targetKind, targetId } = params;

  const fileStats = fs.statSync(localFilePath);
  const fileName = String(tusMetadata.originalFileName ?? "unnamed");

  const transferId = randomUUID();
  const state: TransferState = {
    transferId,
    fileName,
    direction: "upload",
    status: "in_progress",
    targetKind,
    targetId,
    localPath: localFilePath,
    bytesTransferred: 0,
    totalBytes: fileStats.size,
    startTime: new Date().toISOString(),
  };
  activeTransfers.set(transferId, state);

  console.error(
    `[rogue-arena-mcp] TUS upload [${transferId}] ${fileName} (${fileStats.size} bytes) → ${endpoint} [${targetKind}:${targetId}]`
  );

  let lastChunkTime = Date.now();
  let lastLoggedPct = -1;

  const fileStream = fs.createReadStream(localFilePath);

  const upload = new Upload(fileStream, {
    endpoint,
    chunkSize: CHUNK_SIZE,
    uploadSize: fileStats.size,
    // Initial headers; Authorization is refreshed per-attempt in onBeforeRequest.
    headers: {},
    metadata: tusMetadata,
    retryDelays: [0, 3000, 5000, 10000],
    onBeforeRequest: async (req) => {
      // Refresh auth header for every attempt (POST, PATCH, HEAD, retries).
      // Mutates the request via setHeader so the Node HTTP stack picks up
      // the fresh bearer instead of the stale snapshot from Upload construction.
      try {
        const fresh = await auth.getHeaders();
        if (fresh.Authorization) {
          req.setHeader("Authorization", fresh.Authorization);
        }
      } catch (err) {
        console.error(
          `[rogue-arena-mcp] Auth refresh failed for transfer ${transferId}: ${(err as Error).message}`
        );
      }

      // Throttle PATCH to UPLOAD_BPS.
      if (req.getMethod() === "PATCH") {
        const now = Date.now();
        const elapsed = now - lastChunkTime;
        const expectedMs = Math.floor((CHUNK_SIZE / UPLOAD_BPS) * 1000);
        const sleepMs = expectedMs - elapsed;
        if (sleepMs > 0) {
          await new Promise((res) => setTimeout(res, sleepMs));
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
            `[rogue-arena-mcp] Upload [${transferId}] ${logPct}% (${bytesSent}/${bytesTotal} bytes)`
          );
        }
      }
    },
    onSuccess: () => {
      // Vaults mutates upload.options.metadata.originalFileName on collision
      // (generates `<name> copy N<ext>`). Read back so agents can reconcile
      // the final persisted filename.
      const finalName =
        (upload.options.metadata as Record<string, string> | undefined)
          ?.originalFileName ?? fileName;
      state.fileName = finalName;
      state.bytesTransferred = fileStats.size;
      console.error(
        `[rogue-arena-mcp] Upload complete [${transferId}]: ${finalName}`
      );
      finishTransfer(state, "completed");
    },
    onError: (err) => {
      console.error(
        `[rogue-arena-mcp] Upload failed [${transferId}]: ${err.message}`
      );
      finishTransfer(state, "failed", err.message);
    },
  });

  state._tusUpload = upload;
  // Fire and forget — do NOT await
  upload.start();

  return { transferId, fileName, totalBytes: fileStats.size };
}
