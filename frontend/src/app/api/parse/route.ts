/**
 * Next.js route handler that proxies the backend /api/applications/parse endpoint.
 * Using a route handler instead of the next.config.ts rewrite avoids Cloudflare
 * 524 timeouts — rewrites buffer the entire response before forwarding, while
 * route handlers pipe it directly as it arrives from the backend.
 */

const INTERNAL_API_URL =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

export async function POST(req: Request): Promise<Response> {
  const authHeader = req.headers.get("Authorization");
  const body = await req.json();

  const upstream = await fetch(`${INTERNAL_API_URL}/api/applications/parse`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    body: JSON.stringify(body),
  });

  // Pipe upstream body directly — avoids buffering the whole response.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
