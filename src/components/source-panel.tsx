import type { Evidence, FileSlice } from "@/lib/github/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

export type SourceSelection =
  | { kind: "evidence"; evidence: Evidence }
  | { kind: "file"; file: FileSlice }
  | null;

function viewOf(selection: SourceSelection): (FileSlice & { caption: string }) | null {
  if (!selection) return null;
  if (selection.kind === "evidence") {
    return {
      ...selection.evidence,
      caption: `Cited from ${selection.evidence.tool === "read_file" ? "a file read" : "a content search"}.`,
    };
  }
  return { ...selection.file, caption: "Opened from the file list at this commit." };
}

export function SourcePanel({ selection }: { selection: SourceSelection }) {
  const view = viewOf(selection);
  if (!view) {
    return (
      <div className="flex flex-col gap-2 p-4 text-sm text-muted-foreground">
        <p className="font-heading text-base text-foreground">Sources</p>
        <p>Citations and opened files land here, with the line range from the pinned commit.</p>
      </div>
    );
  }

  const lines = view.excerpt.length === 0 ? [] : view.excerpt.split("\n");
  const range =
    view.totalLines === 0
      ? "Empty file"
      : view.startLine === view.endLine
        ? `Line ${view.startLine} of ${view.totalLines}`
        : `Lines ${view.startLine}–${view.endLine} of ${view.totalLines}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-heading text-base text-foreground">Source</p>
          <Badge variant="outline">{view.sha.slice(0, 7)}</Badge>
          {view.truncated ? <Badge variant="secondary">Range capped</Badge> : null}
        </div>
        <p className="break-all font-mono text-xs">{view.path}</p>
        <p className="text-sm text-muted-foreground">{range}</p>
        <p className="text-sm text-muted-foreground">{view.caption}</p>
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<a href={view.url} target="_blank" rel="noreferrer" />}
        >
          Open on GitHub
        </Button>
      </div>
      <ScrollArea className="min-h-48 flex-1 border-t">
        <div className="p-3">
          {lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">This file has no text at the pinned commit.</p>
          ) : (
            <pre className="font-mono text-xs leading-5">
              {lines.map((line, index) => (
                <div key={`${view.startLine + index}`} className="flex gap-3">
                  <span className="w-8 shrink-0 text-right text-muted-foreground">{view.startLine + index}</span>
                  <code className="whitespace-pre">{line.length > 0 ? line : " "}</code>
                </div>
              ))}
            </pre>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
