import { citationLabel, segmentCitations } from "@/lib/citations";
import type { Evidence } from "@/lib/github/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-xs leading-5">
      <code>{code}</code>
    </pre>
  );
}

export function CitationText({
  text,
  evidenceById,
  onCite,
}: {
  text: string;
  evidenceById: ReadonlyMap<string, Evidence>;
  onCite: (evidence: Evidence) => void;
}) {
  const blocks = text.split("```");
  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block, index) => {
        if (index % 2 === 1) {
          const newline = block.indexOf("\n");
          const code = newline === -1 ? block : block.slice(newline + 1);
          return <CodeBlock key={`code-${index}`} code={code.replace(/\n$/, "")} />;
        }
        const segments = segmentCitations(block, evidenceById);
        return (
          <p key={`text-${index}`} className="whitespace-pre-wrap">
            {segments.map((segment, segmentIndex) => {
              if (segment.type === "text") return <span key={`t-${segmentIndex}`}>{segment.text}</span>;
              if (!segment.evidence) {
                return (
                  <span
                    key={`u-${segmentIndex}`}
                    className="mx-0.5 inline-flex rounded-md bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive"
                  >
                    unverified {segment.id}
                  </span>
                );
              }
              const evidence = segment.evidence;
              return (
                <Button
                  key={`c-${segmentIndex}`}
                  type="button"
                  variant="secondary"
                  size="xs"
                  className={cn("mx-0.5 align-baseline")}
                  onClick={() => onCite(evidence)}
                >
                  {citationLabel(evidence)}
                </Button>
              );
            })}
          </p>
        );
      })}
    </div>
  );
}
