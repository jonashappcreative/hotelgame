// Shared 500 handler: structured logging + optional detail surfacing.
//
// Every handler's catch block returns a deliberately generic message to the
// browser ("An internal error occurred") so we never leak DB/internal detail
// to users. The *real* cause is logged here and shows up in the backend
// container logs (`docker compose logs -f backend` on the Hetzner host).
//
// While diagnosing, set DEBUG_ERRORS=1 in the backend environment to also
// include the cause (message + Postgres error code) in the HTTP response body,
// so you can read it straight from the browser/Network tab. Unset it after.

import { jsonResponse } from './cors';

export function serverError(
  label: string,
  err: unknown,
  cors: Record<string, string>,
): Response {
  const e = err as { message?: string; code?: string; name?: string; stack?: string };

  // Logged to the backend container log (not shown to the browser).
  console.error(`${label}:`, {
    name: e?.name,
    message: e?.message,
    code: e?.code, // Postgres error code, e.g. 42P01 = undefined_table
    stack: e?.stack,
  });

  const body: Record<string, unknown> = { error: 'An internal error occurred' };
  if (process.env.DEBUG_ERRORS === '1') {
    body.detail = e?.message ?? String(err);
    if (e?.code) body.code = e.code;
  }
  return jsonResponse(body, 500, cors);
}
