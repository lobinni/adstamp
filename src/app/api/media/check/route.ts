import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPPORTED = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
]);

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // match contract

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

export async function POST(req: NextRequest) {
  let url = "";
  try {
    const body = (await req.json()) as { url?: string };
    url = String(body?.url || "").trim();
  } catch {
    return json({ ok: false, error: "Invalid JSON body." }, 400);
  }

  if (!url) return json({ ok: false, error: "Missing image URL." }, 400);
  if (!/^https?:\/\//i.test(url)) {
    return json({ ok: false, error: "URL must start with http:// or https://" }, 400);
  }

  try {
    // HEAD is cheap and enough for most hosts.
    const head = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      cache: "no-store",
    });

    if (!head.ok) {
      return json({ ok: false, error: `Image host returned HTTP ${head.status}.` }, 200);
    }

    const contentType = (head.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const contentLength = Number(head.headers.get("content-length") || 0);

    if (contentType && !SUPPORTED.has(contentType)) {
      return json({
        ok: false,
        error: `Unsupported image type '${contentType}'. Supported: ${Array.from(SUPPORTED).join(", ")}.`,
      });
    }

    if (contentLength > MAX_IMAGE_BYTES) {
      return json({
        ok: false,
        error: `Image too large (${contentLength} bytes). Max allowed is ${MAX_IMAGE_BYTES} bytes.`,
      });
    }

    return json({
      ok: true,
      contentType: contentType || null,
      contentLength: contentLength || null,
    });
  } catch {
    return json({ ok: false, error: "Could not reach the image host." }, 200);
  }
}
