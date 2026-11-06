"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { BookOpenIcon, FolderGit2Icon } from "lucide-react";

import { ChatPanel } from "@/components/chat-panel";
import { SourcePanel, type SourceSelection } from "@/components/source-panel";
import type { Evidence, FileSlice, ListedFile, RepoOverview, RepoPin } from "@/lib/github/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

const EXAMPLES = [
  "https://github.com/octocat/Hello-World",
  "https://github.com/sindresorhus/is-plain-obj",
];

type StatusPayload = {
  modelConfigured: boolean;
  modelLabel: string | null;
  modelBaseUrl?: string | null;
  modelReason: string | null;
  githubTokenConfigured: boolean;
};

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error || "The request failed.");
  }
  return data;
}

export function AssistantApp() {
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [overview, setOverview] = useState<RepoOverview | null>(null);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [files, setFiles] = useState<ListedFile[]>([]);
  const [fileQuery, setFileQuery] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [selection, setSelection] = useState<SourceSelection>(null);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [openingPath, setOpeningPath] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/status", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("status");
        setStatus((await response.json()) as StatusPayload);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setStatus({
            modelConfigured: false,
            modelLabel: null,
            modelReason: "The server status check failed.",
            githubTokenConfigured: false,
          });
        }
      });
    return () => controller.abort();
  }, []);

  const onEvidence = useCallback((items: Evidence[]) => {
    setEvidence((current) => {
      if (
        current.length === items.length &&
        current.every((item, index) => item.id === items[index]?.id && item.excerpt === items[index]?.excerpt)
      ) {
        return current;
      }
      return items;
    });
  }, []);

  function showSource(next: SourceSelection) {
    setSelection(next);
    if (window.matchMedia("(max-width: 1023px)").matches) setSheetOpen(true);
  }

  async function loadRepo(nextUrl: string) {
    setLoading(true);
    setUrlError(null);
    setSelection(null);
    setEvidence([]);
    try {
      const loaded = await postJson<RepoOverview>("/api/repo", { url: nextUrl });
      setOverview(loaded);
      setUrl(nextUrl);
      setFiles(loaded.samplePaths.map((path) => ({ path, size: null, readable: true })));
      setFileQuery("");
      setFileError(null);
    } catch (error) {
      setOverview(null);
      setUrlError(error instanceof Error ? error.message : "The repository could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  async function filterFiles(event: FormEvent) {
    event.preventDefault();
    if (!overview) return;
    setFileError(null);
    try {
      const listed = await postJson<{ files: ListedFile[]; note: string }>("/api/files", {
        pin: pinOf(overview),
        query: fileQuery,
      });
      setFiles(listed.files);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "The file list could not be loaded.");
    }
  }

  async function openPath(path: string) {
    if (!overview) return;
    setOpeningPath(path);
    setFileError(null);
    try {
      const file = await postJson<FileSlice>("/api/file", { pin: pinOf(overview), path });
      showSource({ kind: "file", file });
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "That file could not be read.");
    } finally {
      setOpeningPath(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-4 lg:py-6">
      <StatusBanner status={status} />
      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-xl">Pin a public repository</CardTitle>
          <CardDescription>
            Paste a github.com URL. Marginalia resolves the commit and answers from that snapshot.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void loadRepo(url);
            }}
          >
            <FieldGroup>
              <Field data-invalid={urlError ? true : undefined}>
                <FieldLabel htmlFor="repo-url">Repository URL</FieldLabel>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="repo-url"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="https://github.com/owner/repo"
                    aria-invalid={urlError ? true : undefined}
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <Button type="submit" disabled={loading || url.trim().length === 0}>
                    {loading ? <Spinner data-icon="inline-start" /> : <FolderGit2Icon data-icon="inline-start" />}
                    Load
                  </Button>
                </div>
                <FieldDescription>Public repositories only. No GitHub login.</FieldDescription>
                {urlError ? <FieldError>{urlError}</FieldError> : null}
              </Field>
            </FieldGroup>
          </form>
          <div className="mt-3 flex flex-wrap gap-2">
            {EXAMPLES.map((example) => (
              <Button key={example} type="button" variant="outline" size="sm" onClick={() => void loadRepo(example)}>
                {example.replace("https://github.com/", "")}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {loading ? <LoadingState /> : null}
      {overview ? (
        <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <RepoSummary overview={overview} />
            <Card className="flex flex-1 flex-col">
              <CardHeader>
                <CardTitle>Questions</CardTitle>
                <CardDescription>Starter questions are prompts, not prewritten answers.</CardDescription>
                <CardAction>
                  <Button type="button" variant="outline" className="lg:hidden" onClick={() => setSheetOpen(true)}>
                    <BookOpenIcon data-icon="inline-start" />
                    Sources
                    {evidence.length > 0 ? <Badge variant="secondary">{evidence.length}</Badge> : null}
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col">
                <ChatPanel
                  key={`${overview.owner}/${overview.repo}@${overview.sha}`}
                  pin={pinOf(overview)}
                  starterQuestions={overview.starterQuestions}
                  onCite={(item) => showSource({ kind: "evidence", evidence: item })}
                  onEvidence={onEvidence}
                />
              </CardContent>
            </Card>
            <FileList
              files={files}
              query={fileQuery}
              error={fileError}
              openingPath={openingPath}
              onQuery={setFileQuery}
              onSubmit={filterFiles}
              onOpen={openPath}
            />
          </div>
          <aside className="hidden w-full lg:flex lg:w-96 lg:shrink-0">
            <Card className="flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden lg:sticky lg:top-4">
              <SourcePanel selection={selection} />
            </Card>
          </aside>
        </div>
      ) : null}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="h-[80dvh]">
          <SheetHeader>
            <SheetTitle>Sources</SheetTitle>
          </SheetHeader>
          <SourcePanel selection={selection} />
        </SheetContent>
      </Sheet>
    </div>
  );
}

function pinOf(overview: RepoOverview): RepoPin {
  return { owner: overview.owner, repo: overview.repo, sha: overview.sha };
}

function StatusBanner({ status }: { status: StatusPayload | null }) {
  if (!status) return <Skeleton className="h-14 w-full" />;
  if (!status.modelConfigured) {
    return (
      <Alert>
        <AlertTitle>Repository reads are live. Model answers are off.</AlertTitle>
        <AlertDescription>
          {status.modelReason} Add the credential to the server environment and restart. See the README for the variable names.
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert>
      <AlertTitle>Model ready: {status.modelLabel}</AlertTitle>
      <AlertDescription>
        {status.modelBaseUrl
          ? `Chat completions at ${status.modelBaseUrl}. `
          : null}
        {status.githubTokenConfigured
          ? "A server-side GitHub token is configured for higher read limits."
          : "GitHub requests are unauthenticated, so the hourly read limit is low."}
      </AlertDescription>
    </Alert>
  );
}

function LoadingState() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Spinner />
          Resolving the repository
        </CardTitle>
        <CardDescription>Fetching metadata and the file tree for the commit that will be pinned.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-3/4" />
      </CardContent>
    </Card>
  );
}

function RepoSummary({ overview }: { overview: RepoOverview }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-2xl">
          <a href={overview.htmlUrl} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">
            {overview.owner}/{overview.repo}
          </a>
        </CardTitle>
        <CardDescription>{overview.description || "This repository has no description."}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <Badge>Pinned {overview.sha.slice(0, 7)}</Badge>
          <Badge variant="secondary">{overview.refName}</Badge>
          {overview.language ? <Badge variant="outline">{overview.language}</Badge> : null}
          <Badge variant="outline">{overview.stars.toLocaleString()} stars</Badge>
          <Badge variant="outline">{overview.fileCount} text files</Badge>
          {overview.treeTruncated ? <Badge variant="destructive">Tree truncated</Badge> : null}
        </div>
        <p className="text-sm text-muted-foreground">
          Answers and file reads use commit{" "}
          <a href={overview.commitUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4">
            {overview.sha}
          </a>
          . {overview.skippedCount} paths were skipped as binary, generated, or secret-like.
        </p>
        {overview.directories.length > 0 ? (
          <p className="text-sm text-muted-foreground">Top level: {overview.directories.join(", ")}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function FileList({
  files,
  query,
  error,
  openingPath,
  onQuery,
  onSubmit,
  onOpen,
}: {
  files: ListedFile[];
  query: string;
  error: string | null;
  openingPath: string | null;
  onQuery: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onOpen: (path: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Files at this commit</CardTitle>
        <CardDescription>Open a file to read it directly. This list is the filtered tree, not a model guess.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={onSubmit}>
          <Input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Filter by path"
            aria-label="Filter files"
          />
          <Button type="submit" variant="outline">
            Filter
          </Button>
        </form>
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>File read failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <Separator />
        {files.length === 0 ? (
          <p className="text-sm text-muted-foreground">No text files matched that filter.</p>
        ) : (
          <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
            {files.map((file) => (
              <li key={file.path}>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-auto w-full justify-start px-2 py-1 font-mono text-xs"
                  disabled={!file.readable || openingPath === file.path}
                  onClick={() => onOpen(file.path)}
                >
                  {openingPath === file.path ? <Spinner data-icon="inline-start" /> : null}
                  <span className="truncate">{file.path}</span>
                  {file.readable ? null : <Badge variant="outline">too large</Badge>}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
