import { RepoError } from "@/lib/errors";
import { classifyPath, queryTerms, rankPaths } from "@/lib/github/filter";
import type { FileSlice, ListedFile, ParsedGithubUrl, RepoOverview, RepoPin } from "@/lib/github/types";
import {
  assertAllowedGithubUrl,
  blobUrl,
  commitHtmlUrl,
  githubApiUrl,
  normalizeRepoPath,
  parseGithubRepoUrl,
  rawFileUrl,
  refCandidates,
  repositoryHtmlUrl,
} from "@/lib/github/url";
import { LIMITS } from "@/lib/limits";
import { starterQuestions } from "@/lib/starter-questions";
import { decodeUtf8, looksBinary, secretFinding, sliceLines, splitLines } from "@/lib/text";

export type GithubDeps = {
  fetchImpl: typeof fetch;
  token: string | null;
};

type TreeFile = {
  path: string;
  size: number | null;
  readable: boolean;
  reason: string | null;
};

type TreeSnapshot = {
  pin: RepoPin;
  refName: string;
  files: TreeFile[];
  skippedCount: number;
  truncated: boolean;
  expiresAt: number;
};

const treeCache = new Map<string, TreeSnapshot>();
const fileCache = new Map<string, string>();

export function clearRepositoryCache(): void {
  treeCache.clear();
  fileCache.clear();
}

export function defaultGithubDeps(overrides?: Partial<GithubDeps>): GithubDeps {
  return {
    fetchImpl: overrides?.fetchImpl ?? fetch,
    token: overrides && "token" in overrides ? overrides.token ?? null : process.env.GITHUB_TOKEN?.trim() || null,
  };
}

function cacheKey(pin: RepoPin): string {
  return `${pin.owner}/${pin.repo}@${pin.sha}`;
}

function rememberTree(snapshot: TreeSnapshot): void {
  const key = cacheKey(snapshot.pin);
  treeCache.delete(key);
  treeCache.set(key, snapshot);
  while (treeCache.size > LIMITS.cacheEntries) {
    const oldest = treeCache.keys().next().value;
    if (!oldest) break;
    treeCache.delete(oldest);
  }
}

function rememberFile(key: string, text: string): void {
  fileCache.delete(key);
  fileCache.set(key, text);
  while (fileCache.size > LIMITS.cacheEntries) {
    const oldest = fileCache.keys().next().value;
    if (!oldest) break;
    fileCache.delete(oldest);
  }
}

export async function githubFetch(
  url: URL,
  deps: GithubDeps,
  accept: string,
  depth = 0,
): Promise<Response> {
  assertAllowedGithubUrl(url);
  if (depth > 2) {
    throw new RepoError("GitHub redirected too many times.", "unavailable", 502);
  }

  const headers = new Headers();
  headers.set("User-Agent", "marginalia-readonly");
  headers.set("Accept", accept);
  if (url.hostname === "api.github.com") {
    headers.set("X-GitHub-Api-Version", "2022-11-28");
    if (deps.token) headers.set("Authorization", `Bearer ${deps.token}`);
  }

  const response = await deps.fetchImpl(url, { method: "GET", headers, redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) {
      throw new RepoError("GitHub returned a redirect without a destination.", "unavailable", 502);
    }
    const next = new URL(location, url);
    assertAllowedGithubUrl(next);
    const nextDeps = next.hostname === url.hostname ? deps : { ...deps, token: null };
    return githubFetch(next, nextDeps, accept, depth + 1);
  }
  return response;
}

async function githubFailure(response: Response): Promise<never> {
  let message = "";
  try {
    message = await response.text();
  } catch {
    message = "";
  }
  const remaining = response.headers.get("x-ratelimit-remaining");
  const rateLimited = response.status === 429 || remaining === "0" || /rate limit/i.test(message);
  if (rateLimited) {
    throw new RepoError(
      "GitHub rate limit reached for this server. Wait before trying again, or set a server-side GITHUB_TOKEN with public read access. That token stays on api.github.com and is never sent to the model.",
      "rate_limit",
      429,
    );
  }
  if (response.status === 404) {
    throw new RepoError(
      "That repository, commit, or file was not found, or it is not public.",
      "not_found",
      404,
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new RepoError(
      "GitHub refused this read. Private repositories are outside this app, and a rejected token also looks like this.",
      "forbidden",
      403,
    );
  }
  if (response.status === 409) {
    throw new RepoError("That repository is empty.", "bad_request", 409);
  }
  throw new RepoError("GitHub could not complete that read.", "unavailable", 502);
}

async function githubJson<T>(url: URL, deps: GithubDeps): Promise<T> {
  const response = await githubFetch(url, deps, "application/vnd.github+json");
  if (!response.ok) await githubFailure(response);
  return (await response.json()) as T;
}

type RepoPayload = {
  private?: boolean;
  default_branch?: string;
  description?: string | null;
  stargazers_count?: number;
  language?: string | null;
};

type CommitPayload = { sha?: string };

type TreePayload = {
  truncated?: boolean;
  tree?: Array<{ path?: string; type?: string; size?: number }>;
};

async function resolveCommit(parsed: ParsedGithubUrl, meta: RepoPayload, deps: GithubDeps): Promise<{ sha: string; refName: string }> {
  const branch = meta.default_branch;
  if (!branch) throw new RepoError("GitHub did not report a default branch.", "unavailable", 502);
  const candidates = parsed.ref ? refCandidates(parsed.ref) : [branch];

  for (const candidate of candidates) {
    const url = githubApiUrl(
      `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/commits/${encodeURIComponent(candidate)}`,
    );
    const response = await githubFetch(url, deps, "application/vnd.github+json");
    if (response.status === 404) continue;
    if (!response.ok) await githubFailure(response);
    const body = (await response.json()) as CommitPayload;
    if (!body.sha || !/^[0-9a-f]{40}$/.test(body.sha)) {
      throw new RepoError("GitHub did not return a full commit SHA.", "unavailable", 502);
    }
    return { sha: body.sha, refName: candidate };
  }

  throw new RepoError("Could not resolve that branch, tag, or commit on the repository.", "not_found", 404);
}

function indexTree(pin: RepoPin, payload: TreePayload): TreeSnapshot {
  const files: TreeFile[] = [];
  let skipped = 0;
  let truncated = Boolean(payload.truncated);
  for (const entry of payload.tree ?? []) {
    if (entry.type !== "blob" || !entry.path) continue;
    let path: string;
    try {
      path = normalizeRepoPath(entry.path);
    } catch {
      skipped += 1;
      continue;
    }
    const decision = classifyPath(path, typeof entry.size === "number" ? entry.size : null);
    if (!decision.include) {
      skipped += 1;
      continue;
    }
    if (files.length >= LIMITS.maxTreeFiles) {
      truncated = true;
      break;
    }
    files.push({
      path,
      size: typeof entry.size === "number" ? entry.size : null,
      readable: decision.readable,
      reason: decision.reason,
    });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  return {
    pin,
    refName: "",
    files,
    skippedCount: skipped,
    truncated,
    expiresAt: Date.now() + LIMITS.cacheTtlMs,
  };
}

async function fetchTree(pin: RepoPin, deps: GithubDeps): Promise<TreeSnapshot> {
  const url = githubApiUrl(
    `/repos/${encodeURIComponent(pin.owner)}/${encodeURIComponent(pin.repo)}/git/trees/${pin.sha}?recursive=1`,
  );
  const payload = await githubJson<TreePayload>(url, deps);
  const snapshot = indexTree(pin, payload);
  rememberTree(snapshot);
  return snapshot;
}

export async function ensureTree(pin: RepoPin, overrides?: Partial<GithubDeps>, refName = ""): Promise<TreeSnapshot> {
  const deps = defaultGithubDeps(overrides);
  const cached = treeCache.get(cacheKey(pin));
  if (cached && cached.expiresAt > Date.now()) return cached;
  const snapshot = await fetchTree(pin, deps);
  snapshot.refName = refName;
  return snapshot;
}

export async function loadRepository(input: string, overrides?: Partial<GithubDeps>): Promise<RepoOverview> {
  const deps = defaultGithubDeps(overrides);
  const parsed = parseGithubRepoUrl(input);
  const meta = await githubJson<RepoPayload>(
    githubApiUrl(`/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`),
    deps,
  );
  if (meta.private) {
    throw new RepoError(
      "That repository is private. Marginalia only reads public repositories.",
      "private",
      403,
    );
  }
  const commit = await resolveCommit(parsed, meta, deps);
  const pin: RepoPin = { owner: parsed.owner, repo: parsed.repo, sha: commit.sha };
  const tree = await ensureTree(pin, deps, commit.refName);
  const included = tree.files;
  const readablePaths = included.filter((file) => file.readable).map((file) => file.path);
  const readmePath = readablePaths.find((path) => /(^|\/)readme(\.|$)/i.test(path)) ?? null;
  const directories = [...new Set(included.map((file) => file.path.split("/")[0] ?? file.path))].slice(0, 24);

  return {
    ...pin,
    description: meta.description?.trim() || null,
    defaultBranch: meta.default_branch ?? commit.refName,
    refName: commit.refName,
    stars: meta.stargazers_count ?? 0,
    language: meta.language ?? null,
    htmlUrl: repositoryHtmlUrl(parsed.owner, parsed.repo),
    commitUrl: commitHtmlUrl(pin),
    fetchedAt: new Date().toISOString(),
    treeTruncated: tree.truncated,
    fileCount: included.length,
    skippedCount: tree.skippedCount,
    directories,
    samplePaths: rankPaths(readablePaths, []).slice(0, LIMITS.maxSamplePaths),
    readmePath,
    starterQuestions: starterQuestions(readablePaths),
  };
}

export async function listRepositoryFiles(
  pin: RepoPin,
  options: { query?: string; prefix?: string },
  overrides?: Partial<GithubDeps>,
): Promise<{ files: ListedFile[]; truncated: boolean; note: string }> {
  const deps = defaultGithubDeps(overrides);
  const snapshot = await ensureTree(pin, deps);
  const query = options.query?.trim().toLowerCase() ?? "";
  const prefix = options.prefix?.trim().replace(/^\.\//, "") ?? "";
  if (query.length > LIMITS.maxQueryLength || prefix.length > LIMITS.maxPathLength) {
    throw new RepoError("That file filter is too long.", "bad_request", 400);
  }

  const matched = snapshot.files.filter((file) => {
    if (prefix && !file.path.startsWith(prefix)) return false;
    if (query && !file.path.toLowerCase().includes(query)) return false;
    return true;
  });
  const ranked = rankPaths(
    matched.map((file) => file.path),
    query ? queryTerms(query) : [],
  );
  const limited = ranked.slice(0, LIMITS.maxListResults);
  const byPath = new Map(snapshot.files.map((file) => [file.path, file]));
  const note = snapshot.truncated
    ? "GitHub truncated this tree, so some files are absent from search and listing."
    : limited.length < ranked.length
      ? `Showing ${limited.length} of ${ranked.length} matching files.`
      : `${ranked.length} files match.`;

  return {
    truncated: snapshot.truncated || limited.length < ranked.length,
    note,
    files: limited.map((path) => {
      const file = byPath.get(path);
      return { path, size: file?.size ?? null, readable: file?.readable ?? false };
    }),
  };
}

async function readText(pin: RepoPin, path: string, deps: GithubDeps): Promise<string> {
  const key = `${cacheKey(pin)}:${path}`;
  const cached = fileCache.get(key);
  if (cached !== undefined) return cached;

  const response = await githubFetch(rawFileUrl(pin, path), deps, "text/plain");
  if (!response.ok) await githubFailure(response);
  const bytes = await readBounded(response, LIMITS.maxFileBytes);
  if (looksBinary(bytes)) {
    throw new RepoError("This file looks binary, so it was not read.", "blocked", 422);
  }
  const text = decodeUtf8(bytes);
  const secret = secretFinding(text);
  if (secret) {
    throw new RepoError(
      "This file looks like it contains a credential, so its contents were not returned.",
      "blocked",
      422,
    );
  }
  rememberFile(key, text);
  return text;
}

async function readBounded(response: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      throw new RepoError(`This file is larger than ${maxBytes} bytes, so it was not read.`, "too_large", 413);
    }
    return buffer;
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new RepoError(`This file is larger than ${maxBytes} bytes, so it was not read.`, "too_large", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function requireReadable(pin: RepoPin, path: string, deps: GithubDeps): Promise<TreeFile> {
  const normalized = normalizeRepoPath(path);
  const decision = classifyPath(normalized, null);
  if (!decision.include) {
    throw new RepoError(decision.reason ?? "That file is skipped.", "blocked", 422);
  }
  const snapshot = await ensureTree(pin, deps);
  const file = snapshot.files.find((entry) => entry.path === normalized);
  if (!file) {
    throw new RepoError(
      snapshot.truncated
        ? "That path is not in the fetched tree. The listing was truncated, so Marginalia will not guess."
        : "That file is not in the pinned commit.",
      "not_found",
      404,
    );
  }
  if (!file.readable) {
    throw new RepoError(file.reason ?? "That file is too large to read.", "too_large", 413);
  }
  return file;
}

export async function readRepositoryFile(
  pin: RepoPin,
  path: string,
  range: { startLine?: number; endLine?: number } = {},
  overrides?: Partial<GithubDeps>,
): Promise<FileSlice> {
  const deps = defaultGithubDeps(overrides);
  const file = await requireReadable(pin, path, deps);
  const text = await readText(pin, file.path, deps);
  const sliced = sliceLines(text, range.startLine, range.endLine);
  return {
    path: file.path,
    sha: pin.sha,
    ...sliced,
    url: blobUrl(pin, file.path, sliced.startLine, sliced.endLine),
  };
}

export async function searchRepository(
  pin: RepoPin,
  query: string,
  overrides?: Partial<GithubDeps>,
): Promise<{
  matches: FileSlice[];
  searchedPaths: string[];
  note: string;
}> {
  const deps = defaultGithubDeps(overrides);
  const trimmed = query.trim();
  if (!trimmed || trimmed.length > LIMITS.maxQueryLength) {
    throw new RepoError("Enter a shorter search query.", "bad_request", 400);
  }
  const terms = queryTerms(trimmed);
  const snapshot = await ensureTree(pin, deps);
  const readable = snapshot.files.filter((file) => file.readable);
  const ranked = rankPaths(
    readable.map((file) => file.path),
    terms,
  ).slice(0, LIMITS.maxSearchFiles);

  const matches: FileSlice[] = [];
  const searchedPaths: string[] = [];
  for (const path of ranked) {
    if (matches.length >= LIMITS.maxSearchMatches) break;
    let text: string;
    try {
      text = await readText(pin, path, deps);
    } catch (error) {
      if (error instanceof RepoError && (error.code === "blocked" || error.code === "too_large")) continue;
      throw error;
    }
    searchedPaths.push(path);
    if (terms.length === 0) continue;
    const lines = splitLines(text);
    let lastEnd = 0;
    for (let index = 0; index < lines.length; index += 1) {
      if (matches.length >= LIMITS.maxSearchMatches) break;
      const line = lines[index]?.toLowerCase() ?? "";
      if (!terms.some((term) => line.includes(term))) continue;
      const start = Math.max(1, index + 1 - 1);
      const end = Math.min(lines.length, index + 1 + 2);
      if (start <= lastEnd) continue;
      const sliced = sliceLines(text, start, Math.min(end, start + LIMITS.maxSearchWindow - 1), LIMITS.maxSearchWindow);
      matches.push({
        path,
        sha: pin.sha,
        ...sliced,
        url: blobUrl(pin, path, sliced.startLine, sliced.endLine),
      });
      lastEnd = sliced.endLine;
    }
  }

  const note =
    terms.length === 0
      ? "The query had no searchable terms. Read a specific file instead."
      : matches.length === 0
        ? `No matches in the ${searchedPaths.length} files searched at this commit. The search is bounded, so a miss is not proof the text is absent.`
        : `Matched inside ${searchedPaths.length} files at commit ${pin.sha.slice(0, 7)}.`;

  return { matches, searchedPaths, note: snapshot.truncated ? `${note} The tree was truncated.` : note };
}
