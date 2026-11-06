import { RepoError } from "@/lib/errors";
import { LIMITS } from "@/lib/limits";

export async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > LIMITS.maxRequestBytes) {
    throw new RepoError("That request is too large.", "bad_request", 413);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RepoError("The request body was not valid JSON.", "bad_request", 400);
  }
}

export function jsonError(error: unknown): Response {
  if (error instanceof RepoError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof Error) {
    console.error(error.name);
  } else {
    console.error("request failed");
  }
  return Response.json(
    { error: "The server failed before it could finish that request.", code: "unavailable" },
    { status: 500 },
  );
}
