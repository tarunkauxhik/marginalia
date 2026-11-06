import { RepoError } from "@/lib/errors";
import { LIMITS } from "@/lib/limits";
import type { UIMessage } from "ai";

export function sanitizeMessages(input: unknown): UIMessage[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > LIMITS.maxMessages) {
    throw new RepoError(`Send between 1 and ${LIMITS.maxMessages} messages.`, "bad_request", 400);
  }

  const messages: UIMessage[] = [];
  let characters = 0;
  for (const item of input) {
    if (!item || typeof item !== "object") {
      throw new RepoError("A message was malformed.", "bad_request", 400);
    }
    const record = item as UIMessage;
    if (record.role !== "user" && record.role !== "assistant") {
      throw new RepoError("Only user and assistant messages are accepted.", "bad_request", 400);
    }
    if (!Array.isArray(record.parts)) {
      throw new RepoError("A message was malformed.", "bad_request", 400);
    }

    const parts = [];
    for (const part of record.parts) {
      if (!part || typeof part !== "object" || !("type" in part)) {
        throw new RepoError("A message was malformed.", "bad_request", 400);
      }
      if (part.type !== "text") continue;
      if (!("text" in part) || typeof part.text !== "string") {
        throw new RepoError("A message was malformed.", "bad_request", 400);
      }
      if (part.text.length > LIMITS.maxMessageChars) {
        throw new RepoError("A message is too long.", "bad_request", 400);
      }
      characters += part.text.length;
      parts.push({ type: "text" as const, text: part.text });
    }
    if (parts.length === 0) continue;
    messages.push({ ...record, parts });
  }

  if (characters > LIMITS.maxConversationChars) {
    throw new RepoError("The conversation is too long. Start a new question on this commit.", "bad_request", 400);
  }
  if (messages.length === 0 || messages[messages.length - 1]?.role !== "user") {
    throw new RepoError("Ask a question about the pinned repository.", "bad_request", 400);
  }
  return messages;
}
