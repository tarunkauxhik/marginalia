import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
} from "ai";

import { completionBudget, createLanguageModel, planModel } from "@/lib/ai/model";
import { sanitizeMessages } from "@/lib/ai/messages";
import { buildInstructions, repositoryIndex } from "@/lib/ai/prompt";
import { createRepoTools } from "@/lib/ai/tools";
import { jsonError, readJson } from "@/lib/api";
import { RepoError } from "@/lib/errors";
import { ensureTree } from "@/lib/github/client";
import { parsePin } from "@/lib/github/url";
import { LIMITS } from "@/lib/limits";
import { clientKey, createRateLimiter } from "@/lib/rate-limit";

const limiter = createRateLimiter(30, 10 * 60 * 1000);

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    if (!limiter.allow(clientKey(request))) {
      throw new RepoError("Too many questions from this client. Wait a few minutes and try again.", "rate_limit", 429);
    }
    const body = await readJson(request);
    if (!body || typeof body !== "object") {
      throw new RepoError("The question request was incomplete.", "bad_request", 400);
    }
    const record = body as { messages?: unknown; pin?: unknown };
    const pin = parsePin(record.pin);
    const plan = planModel();
    if (!plan.configured) {
      throw new RepoError(plan.reason, "not_configured", 503);
    }

    const tree = await ensureTree(pin, {});
    const tools = createRepoTools(pin);
    const messages = sanitizeMessages(record.messages);
    const result = streamText({
      model: createLanguageModel(plan),
      instructions: buildInstructions(
        repositoryIndex({
          owner: pin.owner,
          repo: pin.repo,
          sha: pin.sha,
          refName: tree.refName || pin.sha.slice(0, 7),
          description: null,
          fileCount: tree.files.length,
          treeTruncated: tree.truncated,
          paths: tree.files.map((file) => file.path),
        }),
      ),
      messages: await convertToModelMessages(messages, { tools }),
      tools,
      stopWhen: isStepCount(LIMITS.maxToolSteps),
      ...completionBudget(plan),
    });

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({ stream: result.stream }),
    });
  } catch (error) {
    return jsonError(error);
  }
}
