import type { HubClient } from "./hub-client.js";
import { HubRequestError } from "./hub-errors.js";
import type { Session } from "./session.js";

/** Said when a call made with no canvas bound fails: the tool may need one, and this is how to get one. */
export const NO_CANVAS_HINT =
  "(No canvas is set. If this tool works on a canvas, find one with architect_canvas_list, or create one with architect_canvas_create, then call rogue_set_canvas.)";

/**
 * A canvas-category hub tool (Architect, Curriculum). With a bound canvas the call carries it; with none it carries
 * none, so the account tools (architect_canvas_list and the other canvas lists, architect_canvas_create,
 * architect_canvas_action_status) run, and a canvas tool's refusal says how to bind one.
 */
export async function callCanvasCategoryTool(
  hub: Pick<HubClient, "executeTool">,
  session: Pick<Session, "currentCanvas">,
  name: string,
  args: Record<string, unknown>,
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const canvasVersionId = session.currentCanvas();
  if (canvasVersionId) return hub.executeTool(name, canvasVersionId, args);
  try {
    const result = await hub.executeTool(name, null, args);
    return result.success ? result : { ...result, error: `${result.error ?? `Tool ${name} failed.`} ${NO_CANVAS_HINT}` };
  } catch (err) {
    // A hub from before account tools refuses any call without a canvas (400).
    if (err instanceof HubRequestError && err.status === 400) throw new HubRequestError(400, `${err.message} ${NO_CANVAS_HINT}`);
    throw err;
  }
}
