# dsh-image-plugins

Multimodal capability for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) behind a text-only main model (e.g. DeepSeek's official chat route, which cannot carry images). The plugin understands image files and generates images through **configurable OpenAI-compatible endpoints** — bring your own `baseUrl` / `apiKey` / `model` for a vision model and for an image-generation model.

Everything is optional: a capability is enabled only when its config block is present, so an unconfigured install is inert and safe.

## What it provides

| Capability | Kind | Behavior |
|---|---|---|
| `understand_image` | model tool | Reads a workspace image file, sends it to the configured vision endpoint (`chat/completions` + base64 `image_url`), returns the model's text description as the tool result. The description enters the session log, so the text-only main model can reason about the image without ever receiving one. |
| `generate_image` | model tool | Generates one image from a prompt via the configured endpoint (`images/generations`, accepts `b64_json` or `url` responses), saves it into the workspace, returns the saved path. With the `dashscope` provider it also accepts an optional `reference_image` for image editing (I2I). |
| auto-understand | `agent/pre-step` waterfall | When you attach an image to a chat message, the plugin describes it with the vision model and rewrites the message to carry that text before it enters the log — the model never sees an image block, and the request-reconstruction invariant holds because the rewritten message is exactly what is logged. It rewrites whenever enabled (no "does the model accept images" gate: a text-only endpoint declared image-capable for attachment preflight must still be rewritten, or the provider rejects the image mid-turn); set `autoUnderstand: false` when your main model genuinely accepts images. |

## Install

The plugin is a standard dsh **bundle**. Install it into the profile that boots your Web UI:

```sh
dsh plugin --profile web add /path/to/dsh-image-plugins   # local checkout
dsh plugin --profile web add dsh-image-plugins            # once published
```

Then restart `dsh web` (or the profile's process).

> The bundle inserts its row **without configuration**, so after install nothing is enabled until you configure it (next section). The plugin loads fine either way.

## Configure

Override the `image-plugins` row (same id) in your profile's `cordis.patch.yml`, or pass a `--patch` overlay:

```yaml
- id: image-plugins
  name: dsh-image-plugins
  config:
    vision:
      baseUrl: 'https://your-vision-endpoint.example.com/v1'
      apiKey: 'env:VISION_API_KEY'   # literal key or env:NAME
      model: 'your-vision-model'
      timeoutMs: 60000               # optional
      maxImageBytes: 20971520        # optional, bytes
      systemPrompt: ''               # optional, sent before the image
      defaultPrompt: ''              # optional, used when the model gives no prompt
    image:
      provider: 'openai'             # 'openai' (default) or 'dashscope'
      baseUrl: 'https://your-image-endpoint.example.com/v1'
      apiKey: 'env:IMAGE_API_KEY'
      model: 'your-image-model'
      timeoutMs: 120000              # optional
      defaultSize: '1024x1024'       # optional
      outputDir: 'generated'         # optional, workspace-relative
    autoUnderstand: true             # optional, default true
```

Notes:

- Each block is independent: configure only `vision`, only `image`, or both. A partially filled block (e.g. `baseUrl` without `apiKey`) fails the load loudly.
- `apiKey` accepts a literal value or `env:VARNAME` resolved from the process environment. Keys never enter the session log or tool results.
- The profile patch targets the row by id and replaces its whole config — restate every key you need.
- Endpoints must be OpenAI-compatible: vision = `POST {baseUrl}/chat/completions` accepting `image_url` data URLs; image generation = `POST {baseUrl}/images/generations` returning `data[0].b64_json` or `data[0].url`.

### DashScope (阿里云百炼)

DashScope's compatible-mode path does **not** serve `images/generations` (it 404s), so image generation speaks the native Model Studio API through `provider: 'dashscope'`. Vision (`understand_image` / auto-understand), by contrast, works through the compatible-mode `chat/completions` path with any VL model. Both share the same API key:

```yaml
- id: image-plugins
  name: dsh-image-plugins
  config:
    vision:
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1'
      apiKey: 'sk-...'                # 百炼 API Key
      model: 'qwen3.7-flash'          # any VL model (verified with qwen3.7-flash)
    image:
      provider: 'dashscope'
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1'  # a /v1 or /compatible-mode/v1 suffix is normalized away
      apiKey: 'sk-...'                # 百炼 API Key
      model: 'qwen-image-3.0-pro'
      defaultSize: '1024x1024'        # converted to the native 1024*1024 form
```

The image adapter calls `POST /api/v1/services/aigc/multimodal-generation/generation` (sync), maps `output.choices[0].message.content[0].image`, and downloads the PNG (URLs expire after 24 h). Works with the `qwen-image` family, including `qwen-image-3.0-pro`.

### Image editing (I2I) with a reference image

With the `dashscope` provider, `generate_image` accepts an optional `reference_image` path. The reference (PNG/JPEG/WebP/GIF, ≤ 10 MiB, default cap configurable via `image.maxReferenceBytes`) is sent to the model as base64 alongside the prompt:

> Change the color of `images/logo.png` to blue, keep everything else identical.

The model edits the reference image instead of generating from scratch. The `openai` flavor has no image input and rejects the parameter with a clear error.

## Use

### Understand an image (V1 tool)

Put the image somewhere in the workspace, then ask the agent, e.g.:

> Look at `images/screenshot.png` and tell me what it shows.

The agent calls `understand_image` with the path (and optionally a specific question as `prompt`).

### Generate an image (V1 tool)

> Generate an image of a red apple on a wooden table.

The agent calls `generate_image`; the file lands in the workspace under `generated/` (or your configured `outputDir`) and the tool result reports the path.

### Attach an image in chat (V2 auto-understand)

The host refuses to admit an attachment unless the **routed model** declares image input. A text-only endpoint (like DeepSeek's) therefore needs a hand-declared model profile claiming `input: [text, image]` — the plugin rewrites the image to text at `agent/pre-step` before the provider ever sees it, so the claim never has to be true on the wire. With the pi-ai custom provider this is a settings-level addition (the pi-ai catalog already ships the `deepseek` route with `deepseek-v4-flash` / `deepseek-v4-pro`):

```yaml
# $DSH_HOME/settings.yaml
llm-pi-ai:
  providers:
    deepseek:
      displayName: DeepSeek（图片兼容）
      apiKeyEnv: DEEPSEEK_API_KEY
      modelOverrides:
        deepseek-v4-flash:
          input: [text, image]
```

Then, in the Web UI, **select that provider's model** in the session model selector (it appears under the display name), attach the image, and send: the plugin describes the image with your configured vision model and the DeepSeek model sees the description — no tool call needed. The `understand_image` tool stays available for deeper questions. Attaching an image while the plain text-only model is selected still refuses, naming the model.

If your main model genuinely accepts images (e.g. a qwen-vl route), set `autoUnderstand: false` so the real image reaches it instead of a description.

## How it stays compatible with dsh's architecture

- Tools are registered through the documented `ctx.tools` seam (`@deepseek-ai/dsh-tools` `defineTool`); tool results are durable log entries, which is exactly the channel the "model-visible ⟺ logged" invariant requires.
- Auto-understand uses the documented `agent/pre-step` waterfall (same mechanism as the first-party `time-context` plugin): the rewritten messages are what the loop appends to the log, so the request-reconstruction invariant is preserved.
- The plugin depends only on published `@deepseek-ai/dsh-tools` and `@deepseek-ai/schemastery`; no internal modules.

## Development

```sh
npm install
npm test          # unit tests against mock endpoints + real Cordis mount
npm run build     # tsc -> lib/
```

Smoke-verify against a scratch profile (does not touch your real profiles):

```sh
DSH_HOME=/tmp/dsh-image-test-home dsh plugin --profile test add /path/to/dsh-image-plugins
DSH_HOME=/tmp/dsh-image-test-home dsh --profile test --dump-config   # shows the layer
```

## Known Limitations and Deferred Work

- **Binary writes bypass the fs approval events.** The fs seam exposes no binary write today, so `generate_image` resolves the target through `ctx.fs` (consistent path rules) but writes the bytes with `node:fs`. The write therefore does not emit `fs/write-intent` approval events. Switch to a seam write when the fs service grows one.
- **Vision responses are text-only.** The plugin returns descriptions as text; it never emits image content blocks, because a text-only route cannot carry them into the next request.
- **No inline chat preview yet.** Generated images are returned as paths with a generic tool card (the path is clickable to open). An inline preview needs a client-side `tool.call.toolview` registration (V1.5, not shipped).
- **No video generation.** Planned as a background-job capability (`ctx.jobs`) once a provider interface is chosen.
- **No per-request retry/backoff** for endpoint failures; the caller sees the error.
- **Version pinning.** Built and tested against `@deepseek-ai/*` 0.1.0-rc.6; dsh is in developer preview and breaking changes are expected between releases. Re-run `npm test` after upgrading the host.
- **Description caching.** Auto-understand caches descriptions per attachment id (content-addressed) in memory, bounded to 64 entries.

## License

MIT
