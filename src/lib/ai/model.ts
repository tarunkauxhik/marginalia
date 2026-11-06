import { anthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { openai } from "@ai-sdk/openai";
import { gateway, type LanguageModel } from "ai";

import { LIMITS } from "@/lib/limits";

/** Chosen from the public AI Gateway catalog on 2026-11-06. Override with AI_MODEL. */
export const DEFAULT_GATEWAY_MODEL = "openai/gpt-5.4-mini";
export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4.5";

/** OpenAI-compatible chat-completions gateway. The model id is not a secret. */
export const DEFAULT_REPO_ASSISTANT_BASE_URL = "https://llm-gateway-azure.penpencil.guru/v1";
export const DEFAULT_REPO_ASSISTANT_MODEL = "MiniMax-M3.1-Flash";

const GATEWAY_MODEL = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i;
const DIRECT_MODEL = /^[a-z0-9][a-z0-9._-]*$/i;
const COMPATIBLE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function currentModelEnv(): ModelEnv {
  return {
    REPO_ASSISTANT_API_KEY: process.env.REPO_ASSISTANT_API_KEY,
    REPO_ASSISTANT_BASE_URL: process.env.REPO_ASSISTANT_BASE_URL,
    REPO_ASSISTANT_MODEL: process.env.REPO_ASSISTANT_MODEL,
    AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY,
    VERCEL_OIDC_TOKEN: process.env.VERCEL_OIDC_TOKEN,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    AI_MODEL: process.env.AI_MODEL,
  };
}

export type ModelEnv = {
  REPO_ASSISTANT_API_KEY?: string;
  REPO_ASSISTANT_BASE_URL?: string;
  REPO_ASSISTANT_MODEL?: string;
  AI_GATEWAY_API_KEY?: string;
  VERCEL_OIDC_TOKEN?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  AI_MODEL?: string;
};

export type ModelPlan =
  | { configured: true; via: "compatible"; label: string; modelId: string; baseURL: string }
  | { configured: true; via: "gateway"; label: string }
  | { configured: true; via: "openai"; label: string; modelId: string }
  | { configured: true; via: "anthropic"; label: string; modelId: string }
  | { configured: false; reason: string };

export type ModelRuntime = {
  repoAssistantApiKey?: string;
  fetchImpl?: typeof fetch;
};

const MISSING_CREDENTIAL =
  "No model credential is configured. Set REPO_ASSISTANT_API_KEY for the OpenAI-compatible chat gateway, or AI_GATEWAY_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY.";

export function planModel(env: ModelEnv = currentModelEnv()): ModelPlan {
  const assistantKey = env.REPO_ASSISTANT_API_KEY?.trim();
  if (assistantKey) return planCompatible(env);

  const requested = env.AI_MODEL?.trim();
  const gatewayKey = env.AI_GATEWAY_API_KEY?.trim() || env.VERCEL_OIDC_TOKEN?.trim();
  if (gatewayKey) {
    const label = requested || DEFAULT_GATEWAY_MODEL;
    if (!GATEWAY_MODEL.test(label)) {
      return {
        configured: false,
        reason: "AI_MODEL must look like provider/model when a gateway credential is set.",
      };
    }
    return { configured: true, via: "gateway", label };
  }

  if (env.OPENAI_API_KEY?.trim()) {
    const raw = requested || DEFAULT_GATEWAY_MODEL;
    if (!raw.startsWith("openai/") && raw.includes("/")) {
      return {
        configured: false,
        reason: "AI_MODEL names another provider. With OPENAI_API_KEY, use an OpenAI model id or set AI_GATEWAY_API_KEY.",
      };
    }
    const modelId = raw.startsWith("openai/") ? raw.slice("openai/".length) : raw;
    if (!DIRECT_MODEL.test(modelId)) {
      return { configured: false, reason: "AI_MODEL is not a usable OpenAI model id." };
    }
    return { configured: true, via: "openai", label: `openai/${modelId}`, modelId };
  }

  if (env.ANTHROPIC_API_KEY?.trim()) {
    const raw = requested || `anthropic/${DEFAULT_ANTHROPIC_MODEL}`;
    if (!raw.startsWith("anthropic/") && raw.includes("/")) {
      return {
        configured: false,
        reason:
          "AI_MODEL names another provider. With ANTHROPIC_API_KEY, use an Anthropic model id or set AI_GATEWAY_API_KEY.",
      };
    }
    const modelId = raw.startsWith("anthropic/") ? raw.slice("anthropic/".length) : raw;
    if (!DIRECT_MODEL.test(modelId)) {
      return { configured: false, reason: "AI_MODEL is not a usable Anthropic model id." };
    }
    return { configured: true, via: "anthropic", label: `anthropic/${modelId}`, modelId };
  }

  return { configured: false, reason: MISSING_CREDENTIAL };
}

function planCompatible(env: ModelEnv): ModelPlan {
  const modelId = env.REPO_ASSISTANT_MODEL?.trim() || DEFAULT_REPO_ASSISTANT_MODEL;
  if (!COMPATIBLE_MODEL.test(modelId)) {
    return {
      configured: false,
      reason: "REPO_ASSISTANT_MODEL must be a single model id, without spaces or a URL path.",
    };
  }
  const base = parseCompatibleBaseUrl(env.REPO_ASSISTANT_BASE_URL?.trim() || DEFAULT_REPO_ASSISTANT_BASE_URL);
  if (!base.ok) return { configured: false, reason: base.reason };
  return { configured: true, via: "compatible", label: modelId, modelId, baseURL: base.href };
}

function parseCompatibleBaseUrl(value: string): { ok: true; href: string } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "REPO_ASSISTANT_BASE_URL is not a valid URL." };
  }
  if (url.protocol !== "https:") {
    return { ok: false, reason: "REPO_ASSISTANT_BASE_URL must use https." };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "REPO_ASSISTANT_BASE_URL cannot include credentials." };
  }
  if (url.search || url.hash) {
    return { ok: false, reason: "REPO_ASSISTANT_BASE_URL cannot include a query or hash." };
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  return { ok: true, href: url.toString().replace(/\/$/, "") };
}

/** Completion cap sent as max_tokens on the compatible chat-completions route. */
export function completionBudget(plan: ModelPlan): { maxOutputTokens?: number } {
  if (plan.configured && plan.via === "compatible") {
    return { maxOutputTokens: LIMITS.compatibleMaxOutputTokens };
  }
  return {};
}

export function createLanguageModel(
  plan: Extract<ModelPlan, { configured: true }>,
  runtime: ModelRuntime = {},
): LanguageModel {
  switch (plan.via) {
    case "compatible": {
      const apiKey = runtime.repoAssistantApiKey ?? process.env.REPO_ASSISTANT_API_KEY?.trim();
      if (!apiKey) {
        throw new Error("REPO_ASSISTANT_API_KEY is missing.");
      }
      const provider = createOpenAICompatible({
        name: "repo-assistant",
        apiKey,
        baseURL: plan.baseURL,
        includeUsage: true,
        fetch: runtime.fetchImpl,
      });
      return provider.chatModel(plan.modelId);
    }
    case "gateway":
      return gateway(plan.label);
    case "openai":
      return openai(plan.modelId);
    case "anthropic":
      return anthropic(plan.modelId);
    default: {
      const unreachable: never = plan;
      return unreachable;
    }
  }
}
