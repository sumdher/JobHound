/**
 * Next.js route handler that proxies the backend chat SSE stream.
 * Using a route handler (instead of next.config.ts rewrites) ensures
 * the response is piped in real-time — rewrites buffer SSE, causing
 * Cloudflare 524 timeouts.
 */

const INTERNAL_API_URL =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

export async function POST(req: Request): Promise<Response> {
  const authHeader = req.headers.get("Authorization");
  const body = await req.json();

  const upstream = await fetch(`${INTERNAL_API_URL}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    body: JSON.stringify(body),
  });

  // Pipe the upstream ReadableStream directly — no buffering.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
