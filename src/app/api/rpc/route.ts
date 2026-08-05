import { NextRequest } from "next/server";

// Same-origin JSON-RPC proxy to the GenLayer Studio RPC.
// Browsers call this route instead of the RPC domain directly, which avoids
// "Failed to fetch" errors from privacy/ad/wallet extensions that block calls
// to crypto RPC hosts, and sidesteps any cross-origin edge cases.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RPC_URL = process.env.GENLAYER_RPC_URL || "https://studio.genlayer.com/api";

function jsonError(code: number, message: string, httpStatus = 502) {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }),
    { status: httpStatus, headers: { "Content-Type": "application/json" } },
  );
}

export async function POST(req: NextRequest) {
  let body: string;
  try {
    body = await req.text();
  } catch {
    return jsonError(-32700, "Could not read request body", 400);
  }

  try {
    const upstream = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      cache: "no-store",
    });

    const text = await upstream.text();
    const trimmed = text.trimStart();
    if (trimmed.startsWith("<") || trimmed.startsWith("<!")) {
      return jsonError(
        -32603,
        `Upstream RPC returned HTML (HTTP ${upstream.status}). The node may be overloaded — try again.`,
      );
    }

    return new Response(text, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return jsonError(-32603, "Upstream RPC unreachable");
  }
}
