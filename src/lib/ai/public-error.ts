import { APICallError } from "ai";

const GENERIC_CHAT_ERROR = "An error occurred.";
const AUTH_CHAT_ERROR = "The model gateway rejected the server credential.";

/** Client-facing text for a model stream failure. Never echoes credentials, headers, or upstream bodies. */
export function publicChatError(error: unknown): string {
  if (!isRejectedCredential(error)) return GENERIC_CHAT_ERROR;
  console.error(
    JSON.stringify({
      event: "chat_model_auth_error",
      name: "AI_APICallError",
      statusCode: 401,
    }),
  );
  return AUTH_CHAT_ERROR;
}

function isRejectedCredential(error: unknown): boolean {
  return APICallError.isInstance(error) && error.statusCode === 401;
}
