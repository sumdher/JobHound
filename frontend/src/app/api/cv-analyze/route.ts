/**
 * Next.js route handler that proxies the backend /api/user/cv/analyze SSE endpoint.
 * Avoids Cloudflare 524 timeouts — same pattern as /api/chat/route.ts.
 */

const INTERNAL_API_URL =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

export async function POST(req: Request): Promise<Response> {
  const authHeader = req.headers.get("Authorization");
  const body = await req.json();

  const upstream = await fetch(`${INTERNAL_API_URL}/api/user/cv/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!upstream.ok) {
    const err = await upstream.text();
    return new Response(err, { status: upstream.status });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
