import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

/**
 * Session state for the MCP proxy.
 *
 * Canvas state is persisted to ~/.claude/rogue-mcp-session.json so that
 * multiple MCP server processes (spawned by Claude Code for the same server)
 * share the same canvas context. Without this, deferred tools routed to a
 * different process would fail with "No canvas set."
 */

const SESSION_FILE = join(homedir(), ".claude", "rogue-mcp-session.json");

interface PersistedSession {
  canvasVersionId: string | null;
}

function readPersistedCanvas(): string | null {
  try {
    const data = JSON.parse(readFileSync(SESSION_FILE, "utf-8")) as PersistedSession;
    return data.canvasVersionId ?? null;
  } catch {
    return null;
  }
}

function writePersistedCanvas(canvasVersionId: string): void {
  try {
    mkdirSync(join(homedir(), ".claude"), { recursive: true });
    writeFileSync(SESSION_FILE, JSON.stringify({ canvasVersionId } satisfies PersistedSession), { mode: 0o600 });
  } catch {
    // Non-fatal — in-memory state still works
  }
}

export class Session {
  private _canvasVersionId: string | null = null;
  public readonly userId: string;
  public readonly username: string;

  constructor(userId: string, username: string) {
    this.userId = userId;
    this.username = username;
    // Restore canvas from shared file (another process may have set it)
    this._canvasVersionId = readPersistedCanvas();
  }

  get canvasVersionId(): string | null {
    return this._canvasVersionId;
  }

  setCanvas(canvasVersionId: string): void {
    this._canvasVersionId = canvasVersionId;
    writePersistedCanvas(canvasVersionId);
  }

  requireCanvas(): string {
    // Re-read from file in case another process set it since last check
    if (!this._canvasVersionId) {
      this._canvasVersionId = readPersistedCanvas();
    }
    if (!this._canvasVersionId) {
      throw new Error(
        "No canvas set. Call the rogue_set_canvas tool first with a canvas version ID."
      );
    }
    return this._canvasVersionId;
  }
}
