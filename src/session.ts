import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

/**
 * Session state for the MCP proxy.
 *
 * Canvas state is persisted to the profile's session file (see profile.ts)
 * so that multiple MCP server processes spawned for the SAME profile share
 * the same canvas context, while different profiles (prod vs dev) never do.
 */

interface PersistedSession {
  canvasVersionId: string | null;
}

function readPersistedCanvas(sessionFilePath: string): string | null {
  try {
    const parsed: PersistedSession = JSON.parse(readFileSync(sessionFilePath, "utf-8"));
    return parsed.canvasVersionId ?? null;
  } catch {
    return null;
  }
}

function writePersistedCanvas(sessionFilePath: string, canvasVersionId: string): void {
  try {
    mkdirSync(dirname(sessionFilePath), { recursive: true });
    writeFileSync(
      sessionFilePath,
      JSON.stringify({ canvasVersionId } satisfies PersistedSession),
      { mode: 0o600 }
    );
  } catch {
    // Non-fatal — in-memory state still works
  }
}

export class Session {
  private _canvasVersionId: string | null = null;
  public readonly userId: string;
  public readonly username: string;
  public readonly sessionFilePath: string;

  constructor(userId: string, username: string, sessionFilePath: string) {
    this.userId = userId;
    this.username = username;
    this.sessionFilePath = sessionFilePath;
    // Restore canvas from the shared file (another process may have set it)
    this._canvasVersionId = readPersistedCanvas(sessionFilePath);
  }

  get canvasVersionId(): string | null {
    return this._canvasVersionId;
  }

  setCanvas(canvasVersionId: string): void {
    this._canvasVersionId = canvasVersionId;
    writePersistedCanvas(this.sessionFilePath, canvasVersionId);
  }

  requireCanvas(): string {
    // Re-read from file in case another process set it since last check
    if (!this._canvasVersionId) {
      this._canvasVersionId = readPersistedCanvas(this.sessionFilePath);
    }
    if (!this._canvasVersionId) {
      throw new Error(
        "No canvas set. Call the rogue_set_canvas tool first with a canvas version ID."
      );
    }
    return this._canvasVersionId;
  }
}
