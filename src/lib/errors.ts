export type RepoErrorCode =
  | "invalid_url"
  | "not_found"
  | "private"
  | "rate_limit"
  | "forbidden"
  | "unavailable"
  | "too_large"
  | "blocked"
  | "bad_request"
  | "not_configured";

export class RepoError extends Error {
  readonly code: RepoErrorCode;
  readonly status: number;

  constructor(message: string, code: RepoErrorCode, status: number) {
    super(message);
    this.name = "RepoError";
    this.code = code;
    this.status = status;
  }
}

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof RepoError) return error.message;
  return fallback;
}
