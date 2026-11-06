import { tool } from "ai";
import { z } from "zod";

import { errorMessage } from "@/lib/errors";
import { listRepositoryFiles, readRepositoryFile, searchRepository } from "@/lib/github/client";
import type { Evidence, RepoPin } from "@/lib/github/types";

function evidenceId(toolCallId: string, index: number): string {
  const compact = toolCallId.replace(/[^a-zA-Z0-9]/g, "").slice(-10);
  return `e${compact.length >= 2 ? compact : "read"}${index}`;
}

function failure(error: unknown) {
  return {
    ok: false as const,
    error: errorMessage(error, "The repository read failed."),
  };
}

export function createRepoTools(pin: RepoPin) {
  return {
    list_files: tool({
      description:
        "List text files at the pinned commit. Matches path substrings only. Does not return file contents or evidence ids.",
      inputSchema: z.object({
        query: z.string().max(200).optional().describe("Case-insensitive path substring."),
        prefix: z.string().max(400).optional().describe("Keep paths that start with this prefix."),
      }),
      execute: async ({ query, prefix }) => {
        try {
          const listed = await listRepositoryFiles(pin, { query, prefix });
          return { ok: true as const, ...listed };
        } catch (error) {
          return failure(error);
        }
      },
    }),
    search_content: tool({
      description:
        "Search a bounded set of likely text files at the pinned commit. Each match includes an evidence id and the exact lines to cite. A miss only means those files had no hit.",
      inputSchema: z.object({
        query: z.string().min(1).max(200),
      }),
      execute: async ({ query }, { toolCallId }) => {
        try {
          const result = await searchRepository(pin, query);
          const evidence: Evidence[] = result.matches.map((match, index) => ({
            ...match,
            id: evidenceId(toolCallId, index),
            tool: "search_content",
          }));
          return {
            ok: true as const,
            evidence,
            searchedPaths: result.searchedPaths,
            note: result.note,
          };
        } catch (error) {
          return failure(error);
        }
      },
    }),
    read_file: tool({
      description:
        "Read a text file from the pinned commit. Returns an evidence id and the exact line range. Cite that id. Refuses binary, secret, generated, and oversized files.",
      inputSchema: z.object({
        path: z.string().min(1).max(400),
        startLine: z.number().int().min(1).max(20_000).optional(),
        endLine: z.number().int().min(1).max(20_000).optional(),
      }),
      execute: async ({ path, startLine, endLine }, { toolCallId }) => {
        try {
          const slice = await readRepositoryFile(pin, path, { startLine, endLine });
          const evidence: Evidence = {
            ...slice,
            id: evidenceId(toolCallId, 0),
            tool: "read_file",
          };
          const note = slice.totalLines === 0
            ? "The file is empty."
            : slice.truncated
              ? `Showing lines ${slice.startLine}-${slice.endLine} of ${slice.totalLines}. Ask for another range to read further.`
              : `Showing lines ${slice.startLine}-${slice.endLine} of ${slice.totalLines}.`;
          return { ok: true as const, evidence, note };
        } catch (error) {
          return failure(error);
        }
      },
    }),
  };
}
