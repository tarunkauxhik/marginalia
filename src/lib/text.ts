import { RepoError } from "@/lib/errors";
import { LIMITS } from "@/lib/limits";

export function splitLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (normalized.length === 0) return [];
  const parts = normalized.split("\n");
  if (normalized.endsWith("\n")) parts.pop();
  return parts;
}

export function sliceLines(
  text: string,
  startLine?: number,
  endLine?: number,
  maxLines: number = LIMITS.maxReadLines,
): {
  startLine: number;
  endLine: number;
  totalLines: number;
  excerpt: string;
  truncated: boolean;
} {
  const lines = splitLines(text);
  const totalLines = lines.length;
  if (totalLines === 0) {
    return { startLine: 1, endLine: 1, totalLines: 0, excerpt: "", truncated: false };
  }

  const start = startLine ?? 1;
  if (!Number.isInteger(start) || start < 1) {
    throw new RepoError("Line numbers start at 1.", "bad_request", 400);
  }
  if (start > totalLines) {
    throw new RepoError(
      `The file has ${totalLines} lines. Line ${start} is past the end.`,
      "bad_request",
      400,
    );
  }

  const wantedEnd = endLine ?? totalLines;
  if (!Number.isInteger(wantedEnd) || wantedEnd < start) {
    throw new RepoError("The line range is empty.", "bad_request", 400);
  }

  const end = Math.min(totalLines, wantedEnd, start + maxLines - 1);
  return {
    startLine: start,
    endLine: end,
    totalLines,
    excerpt: lines.slice(start - 1, end).join("\n"),
    truncated: end < Math.min(totalLines, wantedEnd),
  };
}

export function looksBinary(bytes: Uint8Array): boolean {
  const length = Math.min(bytes.length, 8_000);
  for (let index = 0; index < length; index += 1) {
    if (bytes[index] === 0) return true;
  }
  return false;
}

export function secretFinding(text: string): string | null {
  if (/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(text)) return "private key";
  if (/\bAKIA[0-9A-Z]{16}\b/.test(text)) return "cloud access key";
  if (/\bgithub_pat_[A-Za-z0-9_]{20,}\b/.test(text)) return "GitHub token";
  if (/\bghp_[A-Za-z0-9]{36,}\b/.test(text)) return "GitHub token";
  if (/\bsk-[A-Za-z0-9]{20,}\b/.test(text)) return "API key";
  return null;
}

export function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new RepoError("This file is not valid UTF-8 text, so it was not read.", "blocked", 422);
  }
}
