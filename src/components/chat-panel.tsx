"use client";

import { useEffect, useMemo, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { SquareIcon } from "lucide-react";

import { CitationText } from "@/components/citation-text";
import { collectEvidence, evidenceMap } from "@/lib/citations";
import type { Evidence, RepoPin } from "@/lib/github/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

type ToolState =
  | "input-streaming"
  | "input-available"
  | "approval-requested"
  | "approval-responded"
  | "output-available"
  | "output-error"
  | "output-denied";

function isToolState(value: string): value is ToolState {
  switch (value) {
    case "input-streaming":
    case "input-available":
    case "approval-requested":
    case "approval-responded":
    case "output-available":
    case "output-error":
    case "output-denied":
      return true;
    default:
      return false;
  }
}

function toolStateLabel(state: ToolState): string {
  switch (state) {
    case "input-streaming":
    case "input-available":
    case "approval-requested":
    case "approval-responded":
      return "Reading";
    case "output-available":
      return "Read";
    case "output-error":
      return "Read failed";
    case "output-denied":
      return "Read denied";
    default: {
      const unreachable: never = state;
      return unreachable;
    }
  }
}

function toolTitle(type: string, input: unknown): string {
  const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  if (type === "tool-read_file" && typeof record.path === "string") return record.path;
  if (type === "tool-search_content" && typeof record.query === "string") return `search “${record.query}”`;
  if (type === "tool-list_files") {
    return typeof record.query === "string" && record.query ? `files matching “${record.query}”` : "file list";
  }
  return "repository";
}

async function chatFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  if (!response.ok) {
    const copy = response.clone();
    const contentType = copy.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const data = (await copy.json()) as { error?: string };
      if (data.error) throw new Error(data.error);
    }
  }
  return response;
}

export function ChatPanel({
  pin,
  starterQuestions,
  onCite,
  onEvidence,
}: {
  pin: RepoPin;
  starterQuestions: string[];
  onCite: (evidence: Evidence) => void;
  onEvidence: (evidence: Evidence[]) => void;
}) {
  const { owner, repo, sha } = pin;
  const [input, setInput] = useState("");
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: { pin: { owner, repo, sha } },
        fetch: chatFetch,
      }),
    [owner, repo, sha],
  );
  const { messages, sendMessage, status, stop, error, regenerate } = useChat({ transport });
  const evidenceById = useMemo(
    () => evidenceMap(collectEvidence(messages), { owner, repo, sha }),
    [messages, owner, repo, sha],
  );
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    onEvidence([...evidenceById.values()]);
  }, [evidenceById, onEvidence]);

  function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    sendMessage({ text: trimmed });
    setInput("");
  }

  return (
    <div className="flex min-h-[32rem] flex-1 flex-col gap-3">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1" aria-live="polite">
        {messages.length === 0 ? (
          <Empty className="border bg-card">
            <EmptyHeader>
              <EmptyTitle>Ask how this commit works</EmptyTitle>
              <EmptyDescription>
                Questions are answered from files read at the pinned SHA. Citations open the exact lines.
              </EmptyDescription>
            </EmptyHeader>
            <div className="flex flex-wrap justify-center gap-2">
              {starterQuestions.map((question) => (
                <Button key={question} type="button" variant="outline" size="sm" onClick={() => ask(question)}>
                  {question}
                </Button>
              ))}
            </div>
          </Empty>
        ) : (
          messages.map((message) => (
            <MessageView
              key={message.id}
              message={message}
              evidenceById={evidenceById}
              onCite={onCite}
            />
          ))
        )}
        {busy ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner />
            <span>{status === "submitted" ? "Sending the question…" : "Streaming an answer…"}</span>
          </div>
        ) : null}
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>The answer stopped</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            <span>{error.message}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => regenerate()}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          ask(input);
        }}
      >
        <Textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask about a flow, a module, or a file"
          rows={3}
          maxLength={4000}
          disabled={busy}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              ask(input);
            }
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">Shift+Enter for a new line. The model only sees this repository.</p>
          {busy ? (
            <Button type="button" variant="outline" onClick={() => stop()}>
              <SquareIcon data-icon="inline-start" />
              Stop
            </Button>
          ) : (
            <Button type="submit" disabled={input.trim().length === 0}>
              Ask
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

function MessageView({
  message,
  evidenceById,
  onCite,
}: {
  message: UIMessage;
  evidenceById: ReadonlyMap<string, Evidence>;
  onCite: (evidence: Evidence) => void;
}) {
  const mine = message.role === "user";
  return (
    <article className={mine ? "ml-auto max-w-[42rem] rounded-xl bg-secondary px-3 py-2" : "max-w-[48rem]"}>
      <p className="mb-1 text-xs text-muted-foreground">{mine ? "You" : "Marginalia"}</p>
      <div className="flex flex-col gap-2 text-sm">
        {message.parts.map((part, index) => {
          if (part.type === "text") {
            if (mine) return <p key={`${message.id}-${index}`} className="whitespace-pre-wrap">{part.text}</p>;
            return (
              <CitationText
                key={`${message.id}-${index}`}
                text={part.text}
                evidenceById={evidenceById}
                onCite={onCite}
              />
            );
          }
          if (part.type === "reasoning") {
            if (!part.text.trim()) return null;
            return (
              <details key={`${message.id}-${index}`} className="rounded-lg bg-muted px-3 py-2">
                <summary className="cursor-pointer text-xs text-muted-foreground">Reasoning</summary>
                <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">{part.text}</p>
              </details>
            );
          }
          if (!part.type.startsWith("tool-") || !("state" in part) || typeof part.state !== "string" || !isToolState(part.state)) {
            return null;
          }
          const input = "input" in part ? part.input : undefined;
          return (
            <p key={`${message.id}-${index}`} className="text-xs text-muted-foreground">
              {toolStateLabel(part.state)} {toolTitle(part.type, input)}
            </p>
          );
        })}
      </div>
    </article>
  );
}
