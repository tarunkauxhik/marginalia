import { jsonError, readJson } from "@/lib/api";
import { RepoError } from "@/lib/errors";
import { loadRepository } from "@/lib/github/client";
import { clientKey, createRateLimiter } from "@/lib/rate-limit";

const limiter = createRateLimiter(20, 10 * 60 * 1000);

export async function POST(request: Request) {
  try {
    if (!limiter.allow(clientKey(request))) {
      throw new RepoError("Too many repository loads from this client. Wait a few minutes and try again.", "rate_limit", 429);
    }
    const body = await readJson(request);
    const url = body && typeof body === "object" && "url" in body ? body.url : null;
    if (typeof url !== "string") {
      throw new RepoError("Paste a public GitHub repository URL.", "bad_request", 400);
    }
    const overview = await loadRepository(url);
    return Response.json(overview);
  } catch (error) {
    return jsonError(error);
  }
}
