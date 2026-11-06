import assert from "node:assert/strict";
import { test } from "node:test";

import { APICallError, streamText, toUIMessageStream } from "ai";

import { publicChatError } from "../src/lib/ai/public-error";
import { completionBudget, createLanguageModel, planModel } from "../src/lib/ai/model";

const SECRET = "server-only-key";
const UPSTREAM_SECRET = "sk-live-should-not-leak";

test("a 401 from the compatible gateway becomes a sanitized chat error", async () => {
  const planned = planModel({ REPO_ASSISTANT_API_KEY: SECRET });
  assert.equal(planned.configured, true);
  if (!planned.configured || planned.via !== "compatible") return;

  const logged: unknown[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };

  try {
    const model = createLanguageModel(planned, {
      repoAssistantApiKey: SECRET,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            error: {
              message: `invalid credentials ${UPSTREAM_SECRET}`,
              type: "authentication_error",
              code: "unauthorized",
            },
          }),
          { status: 401, headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` } },
        ),
    });
    const result = streamText({
      model,
      prompt: "Where is the application created?",
      ...completionBudget(planned),
    });
    const chunks = await readChunks(toUIMessageStream({ stream: result.stream, onError: publicChatError }));
    const errorText = chunks.find((chunk) => chunk.type === "error")?.errorText;

    assert.equal(errorText, "The model gateway rejected the server credential.");
    assert.equal(errorText?.includes(SECRET), false);
    assert.equal(errorText?.includes(UPSTREAM_SECRET), false);

    const authLog = logged
      .flat()
      .filter((entry): entry is string => typeof entry === "string" && entry.includes("chat_model_auth_error"))
      .join("\n");
    assert.equal(authLog.includes(SECRET), false);
    assert.equal(authLog.includes(UPSTREAM_SECRET), false);
    assert.equal(authLog.includes("authorization"), false);
    assert.match(authLog, /"statusCode":401/);
  } finally {
    console.error = originalError;
  }
});

test("other model failures stay generic and do not echo secrets", () => {
  const error = new APICallError({
    message: `gateway exploded ${UPSTREAM_SECRET}`,
    url: "https://llm-gateway-azure.penpencil.guru/v1/chat/completions",
    requestBodyValues: { apiKey: SECRET },
    statusCode: 500,
    responseHeaders: { authorization: `Bearer ${SECRET}` },
    responseBody: `invalid credentials ${UPSTREAM_SECRET}`,
  });

  const text = publicChatError(error);
  assert.equal(text, "An error occurred.");
  assert.equal(text.includes(SECRET), false);
  assert.equal(text.includes(UPSTREAM_SECRET), false);
});

async function readChunks(stream: ReadableStream<unknown>): Promise<Array<{ type?: string; errorText?: string }>> {
  const reader = stream.getReader();
  const chunks: Array<{ type?: string; errorText?: string }> = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) return chunks;
    chunks.push(value as { type?: string; errorText?: string });
  }
}
