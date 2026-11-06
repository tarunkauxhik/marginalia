import assert from "node:assert/strict";
import { test } from "node:test";

import { RepoError } from "../src/lib/errors";
import { classifyPath, queryTerms, rankPaths } from "../src/lib/github/filter";
import {
  clearRepositoryCache,
  githubFetch,
  loadRepository,
  readRepositoryFile,
  searchRepository,
} from "../src/lib/github/client";
import {
  assertAllowedGithubUrl,
  githubApiUrl,
  normalizeRepoPath,
  parseGithubRepoUrl,
  rawFileUrl,
  refCandidates,
} from "../src/lib/github/url";
import { createRateLimiter } from "../src/lib/rate-limit";
import { secretFinding, sliceLines } from "../src/lib/text";

const SHA = "a".repeat(40);

function requestUrl(input: RequestInfo | URL): URL {
  if (input instanceof URL) return input;
  if (typeof input === "string") return new URL(input);
  return new URL(input.url);
}

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("accepts public GitHub repository URLs and rejects everything else", () => {
  assert.deepEqual(parseGithubRepoUrl("https://github.com/vercel/next.js"), {
    owner: "vercel",
    repo: "next.js",
    ref: null,
  });
  assert.deepEqual(parseGithubRepoUrl("https://www.github.com/octocat/Hello-World.git"), {
    owner: "octocat",
    repo: "Hello-World",
    ref: null,
  });
  assert.equal(parseGithubRepoUrl("octocat/Hello-World").owner, "octocat");
  assert.equal(parseGithubRepoUrl("https://github.com/octocat/Hello-World/tree/master/README").ref, "master/README");
  assert.equal(parseGithubRepoUrl("https://github.com/octocat/Hello-World/commit/abc1234").ref, "abc1234");

  const rejected = [
    "https://gitlab.com/acme/app",
    "https://github.com.evil.com/acme/app",
    "https://user:pass@github.com/acme/app",
    "http://github.com/acme/app",
    "https://github.com/acme/app/pull/1",
    "http://127.0.0.1/latest/meta-data",
    "https://github.com",
    "",
  ];
  for (const input of rejected) {
    assert.throws(() => parseGithubRepoUrl(input), RepoError);
  }
});

test("ref candidates prefer the full remainder, then shorter prefixes", () => {
  assert.deepEqual(refCandidates("release/1.2/src/lib"), ["release/1.2/src/lib", "release/1.2", "release"]);
});

test("GitHub URL builders stay on allowed hosts", () => {
  const api = githubApiUrl("/repos/acme/widgets");
  assert.equal(api.href, "https://api.github.com/repos/acme/widgets");
  const raw = rawFileUrl({ owner: "acme", repo: "widgets", sha: SHA }, "src/my file.ts");
  assert.equal(raw.hostname, "raw.githubusercontent.com");
  assert.equal(raw.pathname, `/${"acme"}/widgets/${SHA}/src/my%20file.ts`);
  assert.throws(() => githubApiUrl("https://evil.example/repos"), RepoError);
  assert.throws(
    () => assertAllowedGithubUrl(new URL("https://evil.example/raw")),
    (error: unknown) => error instanceof RepoError && error.message.includes("outside GitHub"),
  );
  assert.throws(() => normalizeRepoPath("src/../../etc/passwd"), RepoError);
  assert.equal(normalizeRepoPath("./src/index.ts"), "src/index.ts");
});

test("skips secret, binary, generated, and oversized paths", () => {
  assert.equal(classifyPath("src/index.ts", 100).include, true);
  assert.equal(classifyPath(".env", 10).include, false);
  assert.equal(classifyPath("config/.env.local", 10).include, false);
  assert.equal(classifyPath("id_rsa", 10).include, false);
  assert.equal(classifyPath("certs/app.pem", 10).include, false);
  assert.equal(classifyPath("node_modules/left-pad/index.js", 10).include, false);
  assert.equal(classifyPath("dist/app.js", 10).include, false);
  assert.equal(classifyPath("assets/logo.png", 10).include, false);
  assert.equal(classifyPath("package-lock.json", 10).include, false);
  assert.equal(classifyPath("public/app.min.js", 10).include, false);
  assert.equal(classifyPath("README.md", 200_000).readable, false);
  assert.equal(secretFinding("-----BEGIN OPENSSH PRIVATE KEY-----\nabc"), "private key");
  assert.equal(secretFinding("export const name = 'marginalia'"), null);
});

test("line slices keep GitHub line numbers and cap long ranges", () => {
  const sliced = sliceLines("alpha\nbeta\ngamma\n", 2, 3);
  assert.equal(sliced.excerpt, "beta\ngamma");
  assert.equal(sliced.startLine, 2);
  assert.equal(sliced.endLine, 3);
  assert.equal(sliced.totalLines, 3);
  assert.equal(sliced.truncated, false);
  const capped = sliceLines(Array.from({ length: 200 }, (_, index) => `line ${index + 1}`).join("\n"), 1);
  assert.equal(capped.endLine, 160);
  assert.equal(capped.truncated, true);
});

test("path ranking prefers filenames that contain the query", () => {
  const terms = queryTerms("How does the widget parser work?");
  assert.deepEqual(terms, ["widget", "parser", "work"]);
  const ranked = rankPaths(["README.md", "src/parser.ts", "docs/widget-parser.md"], terms);
  assert.equal(ranked[0], "docs/widget-parser.md");
});

test("loadRepository pins the resolved commit and drops blocked files", async () => {
  clearRepositoryCache();
  const calls: string[] = [];
  const overview = await loadRepository("https://github.com/acme/widgets", {
    token: "server-token",
    fetchImpl: async (input, init) => {
      const url = requestUrl(input);
      calls.push(url.hostname);
      const headers = new Headers(init?.headers);
      if (url.hostname !== "api.github.com") {
        throw new Error(`unexpected host ${url.hostname}`);
      }
      assert.equal(headers.get("authorization"), "Bearer server-token");
      if (url.pathname === "/repos/acme/widgets") {
        return jsonResponse({
          private: false,
          default_branch: "main",
          description: "Widgets",
          stargazers_count: 3,
          language: "TypeScript",
        });
      }
      if (url.pathname === "/repos/acme/widgets/commits/main") {
        return jsonResponse({ sha: SHA });
      }
      if (url.pathname === `/repos/acme/widgets/git/trees/${SHA}`) {
        return jsonResponse({
          truncated: false,
          tree: [
            { path: "README.md", type: "blob", size: 20 },
            { path: ".env", type: "blob", size: 8 },
            { path: "src/parser.ts", type: "blob", size: 40 },
            { path: "node_modules/left-pad/index.js", type: "blob", size: 10 },
          ],
        });
      }
      throw new Error(url.href);
    },
  });

  assert.equal(overview.sha, SHA);
  assert.equal(overview.fileCount, 2);
  assert.equal(overview.skippedCount, 2);
  assert.equal(overview.readmePath, "README.md");
  assert.ok(overview.commitUrl.endsWith(`/commit/${SHA}`));
  assert.ok(calls.every((host) => host === "api.github.com"));
});

test("file reads omit the GitHub token on raw.githubusercontent.com", async () => {
  clearRepositoryCache();
  let rawAuthorization: string | null = "unset";
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = requestUrl(input);
    const headers = new Headers(init?.headers);
    if (url.hostname === "api.github.com" && url.pathname.endsWith("/git/trees/" + SHA)) {
      return jsonResponse({
        tree: [{ path: "src/my file.ts", type: "blob", size: 12 }],
      });
    }
    if (url.hostname === "raw.githubusercontent.com") {
      rawAuthorization = headers.get("authorization");
      assert.equal(url.pathname, `/acme/widgets/${SHA}/src/my%20file.ts`);
      return new Response("one\ntwo\nthree\n", { status: 200 });
    }
    throw new Error(url.href);
  };

  const file = await readRepositoryFile(
    { owner: "acme", repo: "widgets", sha: SHA },
    "src/my file.ts",
    { startLine: 2, endLine: 3 },
    { fetchImpl, token: "server-token" },
  );
  assert.equal(rawAuthorization, null);
  assert.equal(file.excerpt, "two\nthree");
  assert.equal(file.url, `https://github.com/acme/widgets/blob/${SHA}/src/my%20file.ts#L2-L3`);
});

test("search returns evidence lines only from fetched file text", async () => {
  clearRepositoryCache();
  const fetchImpl: typeof fetch = async (input) => {
    const url = requestUrl(input);
    if (url.pathname.endsWith("/git/trees/" + SHA)) {
      return jsonResponse({
        tree: [
          { path: "README.md", type: "blob", size: 30 },
          { path: "src/parser.ts", type: "blob", size: 40 },
        ],
      });
    }
    if (url.pathname.endsWith("/README.md")) return new Response("# Widgets\n", { status: 200 });
    if (url.pathname.endsWith("/src/parser.ts")) {
      return new Response("export function parseWidget() {\n  return 1;\n}\n", { status: 200 });
    }
    throw new Error(url.href);
  };
  const result = await searchRepository({ owner: "acme", repo: "widgets", sha: SHA }, "parseWidget", {
    fetchImpl,
    token: null,
  });
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.path, "src/parser.ts");
  assert.match(result.matches[0]?.excerpt ?? "", /parseWidget/);
  assert.equal(result.matches[0]?.startLine, 1);
});

test("redirects to other hosts are refused and do not forward credentials", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      githubFetch(new URL("https://api.github.com/repos/acme/widgets"), {
        token: "server-token",
        fetchImpl: async () => {
          calls += 1;
          return new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } });
        },
      }, "application/vnd.github+json"),
    (error: unknown) => error instanceof RepoError && /outside GitHub/.test(error.message),
  );
  assert.equal(calls, 1);
});

test("private repositories are refused", async () => {
  clearRepositoryCache();
  await assert.rejects(
    () =>
      loadRepository("https://github.com/acme/secret", {
        token: null,
        fetchImpl: async () => jsonResponse({ private: true, default_branch: "main" }),
      }),
    (error: unknown) => error instanceof RepoError && error.code === "private",
  );
});

test("rate limiter blocks the request after the window fills", () => {
  const limiter = createRateLimiter(2, 1_000);
  assert.equal(limiter.allow("client", 0), true);
  assert.equal(limiter.allow("client", 10), true);
  assert.equal(limiter.allow("client", 20), false);
  assert.equal(limiter.allow("client", 1_100), true);
});
