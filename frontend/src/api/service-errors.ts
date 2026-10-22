export function serviceUnavailable(service: string): string {
  return `${service} is temporarily unavailable. Please try again shortly.`;
}

/** Keep useful validation errors, but never render gateway HTML or raw HTTP codes. */
export async function serviceResponseError(
  response: Response,
  service: string,
  fallback: string,
): Promise<string> {
  if (response.status >= 500) return serviceUnavailable(service);
  if (response.status === 429) return "Too many requests. Please wait a moment and try again.";
  if (response.status === 401) return "Your session has expired. Please log in again.";
  if (response.status === 403) return "You do not have permission to do that.";
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof body?.error === "string" && body.error.trim() ? body.error : fallback;
}
