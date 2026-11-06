import assert from "node:assert/strict";
import { test } from "node:test";

import { isStepCount, streamText, tool } from "ai";
import { z } from "zod";

import { evidenceMap, segmentCitations } from "../src/lib/citations";
import type { Evidence } from "../src/lib/github/types";
import {
  DEFAULT_REPO_ASSISTANT_BASE_URL,
  DEFAULT_REPO_ASSISTANT_MODEL,
  completionBudget,
  createLanguageModel,
  planModel,
} from "../src/lib/ai/model";
import { LIMITS } from "../src/lib/limits";

const SHA = "c".repeat(40);

test("compatible gateway is the default chat-completions route and hides the key", () => {
  const planned = planModel({
    REPO_ASSISTANT_API_KEY: "server-only-key",
    AI_GATEWAY_API_KEY: "gateway-secret",
    OPENAI_API_KEY: "sk-other",
  });
  assert.equal(planned.configured, true);
  if (!planned.configured) return;
  assert.equal(planned.via, "compatible");
  assert.equal(DEFAULT_REPO_ASSISTANT_MODEL, "MiniMax-M3.1-Flash");
  assert.equal(planned.modelId, "MiniMax-M3.1-Flash");
  assert.equal(planned.baseURL, DEFAULT_REPO_ASSISTANT_BASE_URL);
  assert.equal(JSON.stringify(planned).includes("server-only-key"), false);
});

test("compatible base URL and model are configurable and stay https", () => {
  const custom = planModel({
    REPO_ASSISTANT_API_KEY: "server-only-key",
    REPO_ASSISTANT_BASE_URL: "https://example.test/v1/",
    REPO_ASSISTANT_MODEL: "MiniMax-M2.7-highspeed",
  });
  assert.equal(custom.configured, true);
  if (custom.configured && custom.via === "compatible") {
    assert.equal(custom.baseURL, "https://example.test/v1");
    assert.equal(custom.modelId, "MiniMax-M2.7-highspeed");
    assert.notEqual(custom.modelId, DEFAULT_REPO_ASSISTANT_MODEL);
  }

  const http = planModel({
    REPO_ASSISTANT_API_KEY: "server-only-key",
    REPO_ASSISTANT_BASE_URL: "http://llm-gateway-azure.penpencil.guru/v1",
  });
  assert.equal(http.configured, false);

  const embedded = planModel({
    REPO_ASSISTANT_API_KEY: "server-only-key",
    REPO_ASSISTANT_BASE_URL: "https://user:secret@example.test/v1",
  });
  assert.equal(embedded.configured, false);
  if (!embedded.configured) assert.equal(JSON.stringify(embedded).includes("secret"), false);
});

test("other providers remain available when the compatible key is unset", () => {
  const openaiPlan = planModel({ OPENAI_API_KEY: "sk-test", AI_MODEL: "openai/gpt-5.4-mini" });
  assert.equal(openaiPlan.configured && openaiPlan.via, "openai");
  const anthropicPlan = planModel({ ANTHROPIC_API_KEY: "ant-test" });
  assert.equal(anthropicPlan.configured && anthropicPlan.via, "anthropic");
});

function sse(chunks: unknown[]): Response {
  const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

test("chat completions stream reasoning, tool results, and a valid citation", async () => {
  const planned = planModel({ REPO_ASSISTANT_API_KEY: "server-only-key" });
  assert.equal(planned.configured, true);
  if (!planned.configured || planned.via !== "compatible") return;

  const calls: Array<{ url: string; authorization: string | null; body: Record<string, unknown> }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init?.headers);
    const raw = typeof init?.body === "string" ? init.body : "";
    calls.push({
      url: url.toString(),
      authorization: headers.get("authorization"),
      body: JSON.parse(raw) as Record<string, unknown>,
    });
    if (calls.length === 1) {
      return sse([
        {
          id: "step-1",
          choices: [{ index: 0, delta: { reasoning_content: "Read the pinned README." }, finish_reason: null }],
        },
        {
          id: "step-1",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_readme",
                    type: "function",
                    function: { name: "read_file", arguments: "{\"path\":\"README.md\"}" },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        },
        { id: "step-1", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
      ]);
    }
    return sse([
      {
        id: "step-2",
        choices: [{ index: 0, delta: { content: "The README says hello «ereadme0»." }, finish_reason: null }],
      },
      { id: "step-2", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ]);
  };

  const evidence: Evidence = {
    id: "ereadme0",
    path: "README.md",
    sha: SHA,
    startLine: 1,
    endLine: 1,
    totalLines: 1,
    excerpt: "Hello World!",
    truncated: false,
    url: `https://github.com/acme/widgets/blob/${SHA}/README.md#L1`,
    tool: "read_file",
  };
  const model = createLanguageModel(planned, { repoAssistantApiKey: "server-only-key", fetchImpl });
  const result = streamText({
    model,
    prompt: "What does the README say?",
    stopWhen: isStepCount(4),
    ...completionBudget(planned),
    tools: {
      read_file: tool({
        description: "Read a file from the pinned commit.",
        inputSchema: z.object({ path: z.string() }),
        execute: async () => ({ ok: true, evidence }),
      }),
    },
  });

  const text = await result.text;
  const steps = await result.steps;
  const toolResults = await result.toolResults;
  assert.equal(steps[0]?.reasoningText, "Read the pinned README.");
  assert.equal(toolResults.length, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.url, `${DEFAULT_REPO_ASSISTANT_BASE_URL}/chat/completions`);
  assert.equal(calls[0]?.url.includes("/responses"), false);
  assert.equal(calls[0]?.authorization, "Bearer server-only-key");
  assert.equal(calls[0]?.body.model, "MiniMax-M3.1-Flash");
  assert.equal(calls[0]?.body.max_tokens, LIMITS.compatibleMaxOutputTokens);
  assert.ok(LIMITS.compatibleMaxOutputTokens >= 1024);
  assert.equal(calls[1]?.url, calls[0]?.url);

  const secondMessages = calls[1]?.body.messages;
  assert.ok(Array.isArray(secondMessages));
  const assistant = (secondMessages as Array<Record<string, unknown>>).find((message) => message.role === "assistant");
  const toolMessage = (secondMessages as Array<Record<string, unknown>>).find((message) => message.role === "tool");
  assert.equal(assistant?.reasoning_content, "Read the pinned README.");
  assert.match(String(toolMessage?.content), /Hello World!/);

  const segments = segmentCitations(text, evidenceMap([evidence], { owner: "acme", repo: "widgets", sha: SHA }));
  const citation = segments.find((segment) => segment.type === "citation");
  assert.equal(citation?.type, "citation");
  if (citation?.type === "citation") {
    assert.equal(citation.evidence?.excerpt, "Hello World!");
    assert.equal(citation.id, "ereadme0");
  }
});
