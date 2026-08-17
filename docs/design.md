# Design notes

Why this plugin looks the way it does. Read this before modifying `src/`.

## The one constraint that shapes everything

DeepSeek Harness enforces a hard invariant (see `packages/core/agent-loop/src/invariant.ts` in the harness): **every loop-built model request must byte-equal the session-log projection (`deriveMessages()`)**. Anything the model sees must be reconstructable from the log ("model-visible ⟺ logged").

Consequences:

- A tool result is a durable log entry, so model-facing capabilities belong on `ctx.tools` (`defineTool` from `@deepseek-ai/dsh-tools`). This is the only fully compliant channel for "the model learns something from an external API".
- Transforming message content inside an LLM adapter (as the community `ModLens` plugin does) passes the mechanical check but leaves the model seeing text that is not in the log — a gray zone we chose not to enter.
- A text-only endpoint (DeepSeek) **hard-rejects image content blocks** (`serialize.ts` in `llm-deepseek`: `UNSUPPORTED_CONTENT`), so image blocks can never ride a request on that route.

## Why the two tools

- `understand_image`: reads a workspace image via the `ctx.fs` seam (policy-governed, session-workspace cwd), sends base64 to the configured vision endpoint (`POST {baseUrl}/chat/completions` with `image_url`), returns text. The description is a tool result, hence logged, hence compliant.
- `generate_image`: calls the configured image endpoint, saves bytes into the workspace, returns the path.

## Providers

- **`openai` (default)**: any OpenAI-compatible endpoint — vision `chat/completions` + `image_url`; generation `images/generations` accepting `b64_json` or `url`.
- **`dashscope`**: Alibaba Model Studio. Verified fact: DashScope's compatible-mode path does **not** serve `images/generations` (HTTP 404), so generation speaks the native API `POST {baseUrl}/api/v1/services/aigc/multimodal-generation/generation` (sync; the base URL is normalized by stripping a trailing `/compatible-mode/v1` or `/v1`). Response mapping: `output.choices[0].message.content[0].image` (PNG URL, 24 h expiry). Size format is `1024*1024` (asterisk).
- **I2I (image editing)**: only the dashscope flavor accepts `reference_image` (1–3 images + 1 text in the content array, base64 data URLs, ≤ 10 MiB each, formats PNG/JPEG/WebP/GIF). The openai flavor rejects the parameter with a clear error.

## Path resolution (the cwd bug)

Relative paths must resolve against the **session workspace**, never the process cwd (the host process may run with cwd `/`). `src/session-cwd.ts` mirrors the official `dsh-tool-fs` helper: cwd comes from `exec.agent.session.header.cwd` and is passed to `ctx.fs.resolve`. Never call `resolve(path, { signal })` without a cwd.

## Binary writes

The fs seam has **no binary write** (only `writeText`); the product's sanctioned binary path is the attachment store (which lives under the harness home, not the workspace). `generate_image` therefore resolves the target through `ctx.fs` (path rules consistent) but writes bytes with `node:fs/promises`. Known limitation: the write emits no `fs/write-intent` approval events. Switch to a seam write when the fs service grows one.

## Auto-understand (V2): dormant

`src/pre-step.ts` implements an `agent/pre-step` waterfall that rewrites attached images to vision-model text before the message enters the log (config flag `autoUnderstand`, default off). It is unit-tested but **never verified end-to-end in a live session** and is deliberately not part of the supported surface:

- Attaching an image requires the routed model to declare `input: [text, image]` (host preflight), and for a text-only endpoint that declaration is a workaround the endpoint never honors — the rewrite neutralizes it before the wire. We judged that inelegant and disabled the feature.
- The supported flow is the V1 tools (image files in the workspace, no declaration).

## Testing

- `npm test`: mock HTTP servers exercise both clients (request shape, errors, timeouts, b64/url download, DashScope mapping, I2I content); `rewriteImageMessages` is a pure function with unit tests; `tests/wiring.test.ts` mounts the plugin on a real Cordis context with stub services.
- Real-API E2E against DashScope costs real money (≈ ¥0.25 per 512² generation) and needs the user's keys — do not run casually.

## Release workflow

1. `npm test && npm run build` (`prepare` also builds on install).
2. `npm version patch` (bumps, commits, tags).
3. `npm publish` — needs the user's npm token (bypass-2FA); never store tokens in the repo.
4. `git push origin main --tags`.

## Roadmap (not built)

- **Paste-to-path client plugin** (preferred next step for "paste an image in chat"): intercept pastes in the browser, save bytes via a host route, insert the file path into the composer, model calls `understand_image`. No model declaration, no gray zone.
- Inline chat preview of generated images: client-side `tool.call.toolview` registration for `generate_image`.
- Video generation: background-job capability via `ctx.jobs` once a provider interface is chosen.
