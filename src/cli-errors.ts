type ErrorLike = {
  message?: string;
  status?: number;
  code?: string;
  cause?: unknown;
  response?: { status?: number };
};

function getMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err && typeof (err as ErrorLike).message === "string") {
    return (err as ErrorLike).message!;
  }
  return "Unknown error";
}

function getStatus(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as ErrorLike;
  if (typeof e.status === "number") return e.status;
  if (typeof e.response?.status === "number") return e.response.status;
  return undefined;
}

function getCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as ErrorLike;
  if (typeof e.code === "string") return e.code;
  if (e.cause && typeof e.cause === "object" && "code" in e.cause && typeof (e.cause as ErrorLike).code === "string") {
    return (e.cause as ErrorLike).code;
  }
  return undefined;
}

export function isNetworkError(err: unknown): boolean {
  const message = getMessage(err).toLowerCase();
  const code = getCode(err);
  if (code && ["ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "EAI_AGAIN", "ETIMEDOUT"].includes(code)) {
    return true;
  }
  return (
    message.includes("connection error") ||
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("timed out")
  );
}

export function isAuthError(err: unknown): boolean {
  const status = getStatus(err);
  if (status === 401 || status === 403) return true;
  const message = getMessage(err).toLowerCase();
  return message.includes("unauthorized") || message.includes("invalid api key") || message.includes("authentication");
}

export function formatApiError(context: string, err: unknown): string {
  const message = getMessage(err);
  if (isAuthError(err)) {
    return `${context}: authentication failed. Check XAI_API_KEY.`;
  }
  if (isNetworkError(err)) {
    return `${context}: could not reach the xAI API (${message}).`;
  }
  return `${context}: ${message}`;
}

export async function getResponseErrorMessage(context: string, response: Response): Promise<string> {
  const bodyText = (await response.text()).trim();
  let detail = bodyText;

  if (bodyText) {
    try {
      const body = JSON.parse(bodyText) as any;
      detail = body.error?.message || body.message || bodyText;
    } catch {
      detail = bodyText;
    }
  }

  if (response.status === 401 || response.status === 403) {
    return `${context}: authentication failed. Check XAI_API_KEY.`;
  }
  return detail
    ? `${context}: ${response.status} ${response.statusText} - ${detail}`
    : `${context}: ${response.status} ${response.statusText}`;
}

export function formatSessionDirError(baseDir: string, err: unknown): string {
  return `Session storage unavailable at ${baseDir}: ${getMessage(err)}`;
}
