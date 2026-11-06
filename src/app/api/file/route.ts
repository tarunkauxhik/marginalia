import { jsonError, readJson } from "@/lib/api";
import { RepoError } from "@/lib/errors";
import { readRepositoryFile } from "@/lib/github/client";
import { parsePin } from "@/lib/github/url";
import { clientKey, createRateLimiter } from "@/lib/rate-limit";

const limiter = createRateLimiter(60, 10 * 60 * 1000);

export async function POST(request: Request) {
  try {
    if (!limiter.allow(clientKey(request))) {
      throw new RepoError("Too many file reads from this client. Wait a few minutes and try again.", "rate_limit", 429);
    }
    const body = await readJson(request);
    if (!body || typeof body !== "object") {
      throw new RepoError("The file request was incomplete.", "bad_request", 400);
    }
    const record = body as { pin?: unknown; path?: unknown; startLine?: unknown; endLine?: unknown };
    const pin = parsePin(record.pin);
    if (typeof record.path !== "string") {
      throw new RepoError("Choose a file path inside the repository.", "bad_request", 400);
    }
    const startLine = typeof record.startLine === "number" ? record.startLine : undefined;
    const endLine = typeof record.endLine === "number" ? record.endLine : undefined;
    const file = await readRepositoryFile(pin, record.path, { startLine, endLine });
    return Response.json(file);
  } catch (error) {
    return jsonError(error);
  }
}
