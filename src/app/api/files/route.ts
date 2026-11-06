import { jsonError, readJson } from "@/lib/api";
import { RepoError } from "@/lib/errors";
import { listRepositoryFiles } from "@/lib/github/client";
import { parsePin } from "@/lib/github/url";
import { clientKey, createRateLimiter } from "@/lib/rate-limit";

const limiter = createRateLimiter(60, 10 * 60 * 1000);

export async function POST(request: Request) {
  try {
    if (!limiter.allow(clientKey(request))) {
      throw new RepoError("Too many file listings from this client. Wait a few minutes and try again.", "rate_limit", 429);
    }
    const body = await readJson(request);
    if (!body || typeof body !== "object") {
      throw new RepoError("The file listing request was incomplete.", "bad_request", 400);
    }
    const record = body as { pin?: unknown; query?: unknown; prefix?: unknown };
    const pin = parsePin(record.pin);
    const query = typeof record.query === "string" ? record.query : undefined;
    const prefix = typeof record.prefix === "string" ? record.prefix : undefined;
    const listed = await listRepositoryFiles(pin, { query, prefix });
    return Response.json(listed);
  } catch (error) {
    return jsonError(error);
  }
}
