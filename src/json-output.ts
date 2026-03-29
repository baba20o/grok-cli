/**
 * JSONL event streaming for machine-readable exec output.
 * When --json is enabled, all events go to stdout as one JSON object per line.
 * Human-readable output goes to stderr.
 */

export interface ThreadEvent {
  type: string;
  [key: string]: any;
}

let jsonMode = false;

export function setJsonMode(enabled: boolean): void {
  jsonMode = enabled;
}

export function isJsonMode(): boolean {
  return jsonMode;
}

export function emitEvent(event: ThreadEvent): void {
  if (!jsonMode) return;
  try {
    process.stdout.write(JSON.stringify(event) + "\n");
  } catch {
    // Swallow serialization errors
  }
}

// Convenience emitters
export function emitSessionStarted(sessionId: string, model: string): void {
  emitEvent({ type: "session.started", session_id: sessionId, model });
}

export function emitTurnStarted(turn: number): void {
  emitEvent({ type: "turn.started", turn });
}

export function emitTurnCompleted(turn: number, usage?: any): void {
  emitEvent({ type: "turn.completed", turn, usage });
}

export function emitToolCall(name: string, args: string, callId: string): void {
  emitEvent({ type: "tool.called", name, arguments: args, call_id: callId });
}

export function emitToolResult(callId: string, output: string, error: boolean): void {
  emitEvent({
    type: "tool.result",
    call_id: callId,
    output: output.slice(0, 10000),
    error,
  });
}

export function emitMessage(content: string): void {
  emitEvent({ type: "message", content });
}

export function emitError(message: string): void {
  emitEvent({ type: "error", message });
}

export function emitSessionCompleted(sessionId: string, usage?: any): void {
  emitEvent({ type: "session.completed", session_id: sessionId, usage });
}
