import { DetailedError, Upload } from "tus-js-client";
import * as fs from "node:fs";
import { randomUUID } from "node:crypto";
import type { AuthProvider } from "./auth.js";

/**
 * One PATCH per 8 MiB. The gateway buffers each chunk's body, so the upstream checks the bearer only once the whole
 * chunk arrived: a chunk must reach it inside the bearer's remaining life, which REFRESH_BUFFER_SECONDS (240) keeps at
 * 240 s or more. 8 MiB takes 67 s at 1 Mbit/s for one upload. Memory stays bounded whatever the chunk size: tus reads
 * a path-backed source (fs.ReadStream with a path) as a stream per chunk and pipes it to the request.
 */
export const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MiB
/** Ceiling on one upload's rate: 150 MB/s. */
export const UPLOAD_BPS = 150 * 1000 * 1000;
/**
 * The upload affinity header (the web client's own name). Every request of one upload carries the same affinity value,
 * so a resumed upload continues where it left off; a new upload carries a new one.
 */
export const TUS_UPLOAD_AFFINITY_HEADER = "X-RA-Upload-Affinity";

// The server's per-user limit on concurrent uploads. An upload the server refuses for capacity (429) waits for a slot
// instead of failing.
export const MAX_CONCURRENT_TRANSFERS = 10;
/** How long an upload refused for capacity (429) waits before it asks again. */
export const CAPACITY_RETRY_MS = 15_000;

const TRANSFER_CLEANUP_MS = 300_000; // 5 min

export type TargetKind = "vm" | "pluginVault" | "machineVault" | "buildVM";

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
  /** Set while the server refuses the upload for capacity and it waits for a slot. */
  waitingForSlot?:  string;
  _abortController?: AbortController;
  _capacityRetry?:   NodeJS.Timeout;
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
  state.waitingForSlot = undefined;
  if (state._capacityRetry) clearTimeout(state._capacityRetry);
  state._capacityRetry = undefined;
  state._writeStream = undefined;
  // Cleanup only: it never keeps the process alive on its own.
  setTimeout(() => activeTransfers.delete(state.transferId), TRANSFER_CLEANUP_MS).unref();
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
  if (state.waitingForSlot) result.waitingForSlot = state.waitingForSlot;
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
  /** How long a capacity refusal (429) waits before asking again; CAPACITY_RETRY_MS unless a test sets it. */
  capacityRetryMs?: number;
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
  const capacityRetryMs = params.capacityRetryMs ?? CAPACITY_RETRY_MS;

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
    // Sent on every request of this upload, retries included; Authorization is refreshed per-attempt in onBeforeRequest.
    headers: { [TUS_UPLOAD_AFFINITY_HEADER]: transferId },
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
      state.waitingForSlot = undefined;
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
      state.waitingForSlot = undefined;
      state.bytesTransferred = fileStats.size;
      console.error(
        `[rogue-arena-mcp] Upload complete [${transferId}]: ${fileName}`
      );
      finishTransfer(state, "completed");
    },
    onError: (err) => {
      // The server is at its upload limit (Vaults answers 429 "Upload limit reached: n/m concurrent uploads active"):
      // wait for a slot and ask again, for as long as the transfer is not cancelled.
      if (err instanceof DetailedError && err.originalResponse?.getStatus() === 429 && state.status === "in_progress") {
        state.waitingForSlot = err.originalResponse.getBody().trim() || "The server is at its upload limit";
        console.error(`[rogue-arena-mcp] Upload [${transferId}] waits for a slot: ${state.waitingForSlot}`);
        state._capacityRetry = setTimeout(() => {
          state._capacityRetry = undefined;
          if (state.status === "in_progress") upload.start();
        }, capacityRetryMs);
        return;
      }
      console.error(
        `[rogue-arena-mcp] Upload failed [${transferId}]: ${err.message}`
      );
      finishTransfer(state, "failed", err.message);
      // Retries are spent: end it on the server too, so the server does not hold it as running until its bytes
      // expire. An upload the server already refused or discarded answers 404, and a finished one stays finished.
      upload.abort(true).catch((abortErr: unknown) => {
        console.error(`[rogue-arena-mcp] Could not cancel failed upload [${transferId}] on the server: ${String(abortErr)}`);
      });
    },
  });

  state._tusUpload = upload;
  // Fire and forget — do NOT await
  upload.start();

  return { transferId, fileName, totalBytes: fileStats.size };
}

/**
 * The MCP stdio client ends this server by closing stdin, then SIGTERM 2 s later, then SIGKILL 2 s after that.
 * Nobody can poll or resume an upload once the connection is gone, so cancel each unfinished one with TUS
 * termination (what the cancel tools send) before exiting: otherwise the server holds it as running for hours.
 */
const SHUTDOWN_CANCEL_MS = 1_500;

interface ConnectionEnd {
  readonly stdin: NodeJS.EventEmitter;
  readonly signals: NodeJS.EventEmitter;
  readonly exit: (code: number) => void;
}

export function endUploadsWithTheConnection({ stdin, signals, exit }: ConnectionEnd): void {
  let ending = false;
  const end = (why: string) => {
    if (ending) return;
    ending = true;
    cancelUnfinishedUploads(why)
      .catch((err: unknown) => {
        console.error(`[rogue-arena-mcp] Cancelling uploads at exit failed: ${String(err)}`);
      })
      .finally(() => exit(0));
  };
  stdin.once("end", () => end("the MCP connection closed"));
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
    signals.once(signal, () => end(`the MCP server received ${signal}`));
  }
}

async function cancelUnfinishedUploads(why: string): Promise<void> {
  const cancels = [...activeTransfers.values()].flatMap((state) => {
    const upload = state._tusUpload;
    if (state.status !== "in_progress" || !upload) return [];
    return [(async () => {
      try {
        await upload.abort(true);
      } catch (err) {
        console.error(`[rogue-arena-mcp] Could not cancel upload [${state.transferId}] on the server: ${String(err)}`);
      }
      finishTransfer(state, "cancelled", `Cancelled because ${why}`);
    })()];
  });
  if (cancels.length === 0) return;
  console.error(`[rogue-arena-mcp] Cancelling ${cancels.length} unfinished upload(s) because ${why}`);
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    Promise.allSettled(cancels),
    new Promise<void>((resolve) => { timer = setTimeout(resolve, SHUTDOWN_CANCEL_MS); }),
  ]);
  clearTimeout(timer);
}
