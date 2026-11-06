import assert from "node:assert/strict";
import { test } from "node:test";

import { RepoError } from "../src/lib/errors";
import { clearRepositoryCache, loadRepository, readRepositoryFile } from "../src/lib/github/client";

test("reads a real public repository at the resolved commit", async () => {
  clearRepositoryCache();
  const overview = await loadRepository("https://github.com/octocat/Hello-World", { token: null });
  assert.equal(overview.owner, "octocat");
  assert.equal(overview.repo, "Hello-World");
  assert.match(overview.sha, /^[0-9a-f]{40}$/);
  assert.ok(overview.readmePath);

  const file = await readRepositoryFile(overview, overview.readmePath, {}, { token: null });
  assert.match(file.excerpt, /hello world/i);
  assert.equal(file.sha, overview.sha);
  assert.ok(file.url.startsWith(`https://github.com/octocat/Hello-World/blob/${overview.sha}/`));
  assert.equal(file.startLine, 1);
});

test("a missing public repository is reported as not found", async () => {
  await assert.rejects(
    () => loadRepository("https://github.com/octocat/marginalia-does-not-exist-9f3a", { token: null }),
    (error: unknown) => error instanceof RepoError && error.code === "not_found",
  );
});
