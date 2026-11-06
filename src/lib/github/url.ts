import { RepoError } from "@/lib/errors";
import { LIMITS } from "@/lib/limits";
import type { ParsedGithubUrl, RepoPin } from "@/lib/github/types";

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const SHA_RE = /^[0-9a-f]{40}$/;

const ALLOWED_HOSTS = new Set(["api.github.com", "raw.githubusercontent.com"]);

export function parseGithubRepoUrl(input: string): ParsedGithubUrl {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > LIMITS.maxUrlLength) {
    throw new RepoError(
      "Enter a public GitHub repository URL, such as https://github.com/owner/repo.",
      "invalid_url",
      400,
    );
  }

  let candidate = trimmed;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) {
    if (/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(candidate)) {
      candidate = `https://github.com/${candidate}`;
    } else if (/^github\.com\//i.test(candidate)) {
      candidate = `https://${candidate}`;
    }
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new RepoError(
      "That does not look like a GitHub repository URL.",
      "invalid_url",
      400,
    );
  }

  if (url.username || url.password) {
    throw new RepoError("Repository URLs cannot include credentials.", "invalid_url", 400);
  }
  if (url.protocol !== "https:") {
    throw new RepoError("Only https://github.com URLs are accepted.", "invalid_url", 400);
  }
  if (url.port) {
    throw new RepoError("Only https://github.com URLs are accepted.", "invalid_url", 400);
  }

  const host = url.hostname.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") {
    throw new RepoError(
      "Only public repositories on github.com are supported.",
      "invalid_url",
      400,
    );
  }

  let parts: string[];
  try {
    parts = url.pathname
      .split("/")
      .filter(Boolean)
      .map((part) => decodeURIComponent(part));
  } catch {
    throw new RepoError("That repository URL could not be decoded.", "invalid_url", 400);
  }

  if (parts.length < 2) {
    throw new RepoError(
      "Include both the owner and repository, as in https://github.com/owner/repo.",
      "invalid_url",
      400,
    );
  }

  const owner = parts[0] ?? "";
  let repo = parts[1] ?? "";
  if (repo.toLowerCase().endsWith(".git")) repo = repo.slice(0, -4);
  assertOwnerRepo(owner, repo);

  if (parts.length === 2) return { owner, repo, ref: null };

  const section = parts[2];
  if (section !== "tree" && section !== "blob" && section !== "commit") {
    throw new RepoError(
      "Use the repository URL, or a /tree, /blob, or /commit link on that repository.",
      "invalid_url",
      400,
    );
  }

  const remainder = parts.slice(3).join("/");
  if (!remainder || !isSafeRef(remainder)) {
    throw new RepoError("That URL is missing a valid branch, tag, or commit.", "invalid_url", 400);
  }
  if (section === "commit" && !/^[0-9a-f]{7,40}$/i.test(parts[3] ?? "")) {
    throw new RepoError("Commit links need a commit SHA.", "invalid_url", 400);
  }
  if (section === "commit" && parts.length !== 4) {
    throw new RepoError("Commit links need a commit SHA.", "invalid_url", 400);
  }

  return { owner, repo, ref: remainder };
}

export function assertOwnerRepo(owner: string, repo: string): void {
  if (!OWNER_RE.test(owner) || !REPO_RE.test(repo) || repo === "." || repo === ".." || repo.includes("..")) {
    throw new RepoError("The owner or repository name is not valid.", "invalid_url", 400);
  }
}

export function assertFullSha(sha: string): void {
  if (!SHA_RE.test(sha)) {
    throw new RepoError("The pinned commit SHA is not valid.", "bad_request", 400);
  }
}

export function parsePin(input: unknown): RepoPin {
  if (!input || typeof input !== "object") {
    throw new RepoError("Load a repository before asking a question.", "bad_request", 400);
  }
  const record = input as Record<string, unknown>;
  if (typeof record.owner !== "string" || typeof record.repo !== "string" || typeof record.sha !== "string") {
    throw new RepoError("The pinned repository is missing owner, repo, or commit.", "bad_request", 400);
  }
  assertOwnerRepo(record.owner, record.repo);
  assertFullSha(record.sha);
  return { owner: record.owner, repo: record.repo, sha: record.sha };
}

export function isSafeRef(ref: string): boolean {
  if (!ref || ref.length > 250) return false;
  if (ref.includes("..") || ref.includes("//") || ref.includes("@") || ref.includes("\\")) return false;
  if (ref.includes("?") || ref.includes("#") || ref.includes("%") || ref.includes(" ")) return false;
  return /^[A-Za-z0-9._+\-/]+$/.test(ref);
}

/** Prefer the longest plausible ref, then a two-segment ref, then the first segment. */
export function refCandidates(ref: string): string[] {
  const parts = ref.split("/").filter(Boolean);
  const candidates: string[] = [];
  const push = (value: string) => {
    if (value && isSafeRef(value) && !candidates.includes(value)) candidates.push(value);
  };
  push(parts.join("/"));
  if (parts.length > 2) push(parts.slice(0, 2).join("/"));
  if (parts.length > 1) push(parts[0] ?? "");
  return candidates.slice(0, 3);
}

export function normalizeRepoPath(input: string): string {
  if (typeof input !== "string") {
    throw new RepoError("Choose a file path inside the repository.", "bad_request", 400);
  }
  const trimmed = input.trim().replace(/^\.\//, "");
  if (!trimmed || trimmed.length > LIMITS.maxPathLength) {
    throw new RepoError("That file path is not valid.", "bad_request", 400);
  }
  if (
    trimmed.startsWith("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("://") ||
    trimmed.includes("?") ||
    trimmed.includes("#") ||
    trimmed.includes("%") ||
    trimmed.includes("\0")
  ) {
    throw new RepoError("That file path is not valid.", "bad_request", 400);
  }

  const parts = trimmed.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new RepoError("That file path is not valid.", "bad_request", 400);
  }
  if (parts.some((part) => /[\u0000-\u001f\u007f]/.test(part))) {
    throw new RepoError("That file path is not valid.", "bad_request", 400);
  }
  return parts.join("/");
}

export function assertAllowedGithubUrl(url: URL): void {
  if (url.protocol !== "https:" || url.port || url.username || url.password) {
    throw new RepoError("Refused a GitHub request that was not plain HTTPS.", "unavailable", 502);
  }
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new RepoError("Refused a request to a host outside GitHub.", "unavailable", 502);
  }
}

export function githubApiUrl(pathname: string): URL {
  if (!pathname.startsWith("/") || pathname.includes("://") || pathname.includes("\\") || pathname.includes("@")) {
    throw new RepoError("Refused a malformed GitHub API path.", "unavailable", 502);
  }
  const url = new URL(pathname, "https://api.github.com");
  assertAllowedGithubUrl(url);
  if (url.hostname !== "api.github.com") {
    throw new RepoError("Refused a request to a host outside GitHub.", "unavailable", 502);
  }
  return url;
}

export function encodeRepoPath(path: string): string {
  return path.split("/").map((part) => encodeURIComponent(part)).join("/");
}

export function rawFileUrl(pin: RepoPin, path: string): URL {
  const url = new URL(
    `https://raw.githubusercontent.com/${encodeURIComponent(pin.owner)}/${encodeURIComponent(pin.repo)}/${pin.sha}/${encodeRepoPath(path)}`,
  );
  assertAllowedGithubUrl(url);
  return url;
}

export function blobUrl(pin: RepoPin, path: string, startLine: number, endLine: number): string {
  const lines = startLine === endLine ? `L${startLine}` : `L${startLine}-L${endLine}`;
  return `https://github.com/${encodeURIComponent(pin.owner)}/${encodeURIComponent(pin.repo)}/blob/${pin.sha}/${encodeRepoPath(path)}#${lines}`;
}

export function repositoryHtmlUrl(owner: string, repo: string): string {
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

export function commitHtmlUrl(pin: RepoPin): string {
  return `https://github.com/${encodeURIComponent(pin.owner)}/${encodeURIComponent(pin.repo)}/commit/${pin.sha}`;
}
