import type { Evidence, EvidenceTool, RepoPin } from "@/lib/github/types";

const MARKER = /«(e[a-zA-Z0-9]{2,32})»/g;
const TOOLS = new Set<EvidenceTool>(["read_file", "search_content"]);

export type TextSegment =
  | { type: "text"; text: string }
  | { type: "citation"; id: string; evidence: Evidence | null };

export function isEvidence(value: unknown): value is Evidence {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    /^e[a-zA-Z0-9]{2,32}$/.test(record.id) &&
    typeof record.path === "string" &&
    record.path.length > 0 &&
    !record.path.includes("..") &&
    typeof record.sha === "string" &&
    /^[0-9a-f]{40}$/.test(record.sha) &&
    typeof record.startLine === "number" &&
    typeof record.endLine === "number" &&
    Number.isInteger(record.startLine) &&
    Number.isInteger(record.endLine) &&
    record.startLine >= 1 &&
    record.endLine >= record.startLine &&
    typeof record.excerpt === "string" &&
    typeof record.url === "string" &&
    typeof record.tool === "string" &&
    TOOLS.has(record.tool as EvidenceTool) &&
    typeof record.totalLines === "number" &&
    typeof record.truncated === "boolean"
  );
}

export function evidenceMatchesPin(evidence: Evidence, pin: RepoPin): boolean {
  if (evidence.sha !== pin.sha) return false;
  const prefix = `https://github.com/${encodeURIComponent(pin.owner)}/${encodeURIComponent(pin.repo)}/blob/${pin.sha}/`;
  return evidence.url.startsWith(prefix);
}

export function evidenceFromOutput(output: unknown): Evidence[] {
  if (!output || typeof output !== "object") return [];
  const record = output as { evidence?: unknown };
  if (Array.isArray(record.evidence)) return record.evidence.filter(isEvidence);
  if (isEvidence(record.evidence)) return [record.evidence];
  return [];
}

export function collectEvidence(
  messages: Array<{ parts?: Array<{ type?: string; state?: string; output?: unknown }> }>,
): Evidence[] {
  const found: Evidence[] = [];
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      if (part.state !== "output-available" || !part.type?.startsWith("tool-")) continue;
      found.push(...evidenceFromOutput(part.output));
    }
  }
  return found;
}

export function evidenceMap(items: Evidence[], pin: RepoPin): Map<string, Evidence> {
  const map = new Map<string, Evidence>();
  for (const item of items) {
    if (evidenceMatchesPin(item, pin)) map.set(item.id, item);
  }
  return map;
}

export function segmentCitations(text: string, evidenceById: ReadonlyMap<string, Evidence>): TextSegment[] {
  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(MARKER)) {
    const index = match.index ?? 0;
    const id = match[1] ?? "";
    if (index > cursor) segments.push({ type: "text", text: text.slice(cursor, index) });
    segments.push({ type: "citation", id, evidence: evidenceById.get(id) ?? null });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) segments.push({ type: "text", text: text.slice(cursor) });
  return segments;
}

export function citationLabel(evidence: Evidence): string {
  const lines =
    evidence.startLine === evidence.endLine
      ? `L${evidence.startLine}`
      : `L${evidence.startLine}-L${evidence.endLine}`;
  return `${evidence.path}:${lines}`;
}
