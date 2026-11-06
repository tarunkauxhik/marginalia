# Marginalia

Marginalia is a read-only assistant for public GitHub repositories. Paste a repository URL, pin the resolved commit, and ask how the code works. Answers stream from a configured model. Citations open only when they match a file range the server actually read at that commit.

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

The dev server defaults to port 3000. This workspace also runs it on an alternate port when needed:

```bash
npx next dev --hostname 0.0.0.0 --port 38471
```

Open the printed local URL. Load a public repository such as `https://github.com/octocat/Hello-World`, then ask a question or open a file from the list.

## Environment

Copy `.env.example` to `.env.local`. Credentials stay on the server. Do not prefix them with `NEXT_PUBLIC_`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `REPO_ASSISTANT_API_KEY` | One model credential | Bearer token for the OpenAI-compatible chat gateway. Server only. When this is set, it is the provider that answers questions. |
| `REPO_ASSISTANT_BASE_URL` | No | Chat-completions base URL. Default: `https://llm-gateway-azure.penpencil.guru/v1`. Requests go to `{base}/chat/completions`, not the OpenAI Responses API. |
| `REPO_ASSISTANT_MODEL` | No | Model id. Default: `MiniMax-M3.1-Flash`. Set this to use a different model on the same gateway. |
| `AI_GATEWAY_API_KEY` | One model credential | Vercel AI Gateway. Used only when `REPO_ASSISTANT_API_KEY` is unset. |
| `VERCEL_OIDC_TOKEN` | One model credential | Alternative gateway credential on Vercel. Same precedence as `AI_GATEWAY_API_KEY`. |
| `OPENAI_API_KEY` | One model credential | Direct OpenAI Responses API. Used when the compatible key and gateway credential are unset. |
| `ANTHROPIC_API_KEY` | One model credential | Direct Anthropic. Used when none of the credentials above are set. |
| `AI_MODEL` | No | Gateway form is `provider/model`. Direct OpenAI and Anthropic accept that provider's model id. It does not override `REPO_ASSISTANT_MODEL`. Default gateway model: `openai/gpt-5.4-mini`. Default Anthropic model: `claude-haiku-4.5`. |
| `GITHUB_TOKEN` | No | Optional token sent only to `api.github.com` for higher public-read rate limits. A fine-grained public-read token is enough. |

Repository browsing works with no model credential. Questions return a clear configuration error until one of the model credentials is set. The default base URL and model name are not secrets. The API key is never written into the client, the status response, or source.

Live answers against the compatible gateway were not run in this workspace. The key exists only in the operator environment. Mocked chat-completions tests cover streaming, reasoning, tool results, and citations.

## Scripts

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

`npm test` includes unit tests and a live read of `octocat/Hello-World`.

## Architecture

The browser never calls GitHub or a model provider.

1. `POST /api/repo` validates the URL, then asks `api.github.com` for repository metadata, the commit SHA, and the recursive tree. The response pins `owner`, `repo`, and the full SHA.
2. `POST /api/files` and `POST /api/file` list or read files for that pin. Reads use `raw.githubusercontent.com` and only for paths present in the fetched tree.
3. `POST /api/chat` streams a model response with the AI SDK. When `REPO_ASSISTANT_API_KEY` is set, the model is `@ai-sdk/openai-compatible` `chatModel`, which calls `{REPO_ASSISTANT_BASE_URL}/chat/completions` with `Authorization: Bearer`. The default model is `MiniMax-M3.1-Flash`. Each compatible step requests up to 8192 completion tokens so reasoning does not consume the whole budget before a tool call or answer. Reasoning deltas (`reasoning_content` or `reasoning`) stay in the answer stream. Tool results are sent back on the next chat-completions turn, including prior `reasoning_content`. The model can call three read-only tools: `list_files`, `search_content`, and `read_file`. Each content result carries an evidence id minted by the server.
4. The UI renders `«evidenceId»` as a citation only when that id is present in a tool result for the same pinned commit. Unknown markers stay labeled unverified and are not linked.

Follow-up turns send the model the conversation text only. Earlier tool payloads are removed so a client cannot forge file contents into the next prompt. The model has to read again.

Repository file text is wrapped as untrusted data in the instructions. Paths that look secret, binary, generated, or oversized are skipped. File bodies that look like private keys or common token formats are refused. Request size, message length, tool steps, and per-client rates are capped.

GitHub requests allow only `api.github.com` and `raw.githubusercontent.com`. Redirects to any other host are refused. The GitHub token is attached only on `api.github.com`. Model credentials are read by the AI SDK and are not added to repository fetches.

## Limits

- Public GitHub repositories only. Private repositories are rejected even if a token could see them.
- Content search reads a small ranked set of files. A miss means those files had no hit, and the answer is expected to say so.
- Very large trees can be truncated by GitHub. The UI shows that state.
- Unauthenticated GitHub usage is about 60 requests per hour per IP. Set `GITHUB_TOKEN` if you hit that limit.

## What this app does not do

It does not log into GitHub as the user, write commits, open pull requests, run repository code, or deploy anything.
