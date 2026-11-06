import { connection } from "next/server";

import { planModel } from "@/lib/ai/model";

export async function GET() {
  await connection();
  const plan = planModel();
  return Response.json({
    modelConfigured: plan.configured,
    modelLabel: plan.configured ? plan.label : null,
    modelVia: plan.configured ? plan.via : null,
    modelBaseUrl: plan.configured && plan.via === "compatible" ? plan.baseURL : null,
    modelReason: plan.configured ? null : plan.reason,
    githubTokenConfigured: Boolean(process.env.GITHUB_TOKEN?.trim()),
  });
}
