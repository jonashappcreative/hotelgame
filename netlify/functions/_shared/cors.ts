// Shared CORS handling for Netlify Functions.
// Allowed origins are configurable via the ALLOWED_ORIGINS env var
// (comma-separated); falls back to the production site + local dev ports.

const DEFAULT_ORIGINS = [
  'https://hotelgame.jonashapp.com',
  'https://acquiregame.netlify.app',
  'http://localhost:8080',
  'http://localhost:5173',
  'http://localhost:4173',
];

function allowedOrigins(): string[] {
  const fromEnv = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return fromEnv.length > 0 ? fromEnv : DEFAULT_ORIGINS;
}

export function getCorsHeaders(req: Request): Record<string, string> {
  const origins = allowedOrigins();
  const origin = req.headers.get('Origin') || '';
  const allowed = origins.includes(origin) ? origin : origins[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

export function jsonResponse(
  body: unknown,
  status: number,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
