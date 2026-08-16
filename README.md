# dsh-image-plugins

[![npm version](https://img.shields.io/npm/v/dsh-image-plugins)](https://www.npmjs.com/package/dsh-image-plugins)

Multimodal capability for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) behind a text-only main model (e.g. DeepSeek's official chat route, which cannot carry images). The plugin understands image files and generates images through **fully configurable endpoints** — bring your own `baseUrl` / `apiKey` / `model` for a vision model and for an image-generation model. Any OpenAI-compatible endpoint works; an optional `dashscope` adapter speaks the Alibaba Model Studio native API.

Everything is optional: a capability is enabled only when its config block is present, so an unconfigured install is inert and safe. No API keys are shipped in the package — each user configures their own.

## What it provides

| Capability | Kind | Behavior |
|---|---|---|
| `understand_image` | model tool | Reads a workspace image file, sends it to your vision endpoint (`chat/completions` + base64 `image_url`), returns the model's text description as the tool result. The description enters the session log, so a text-only main model can reason about the image without ever receiving one. |
| `generate_image` | model tool | Generates an image from a prompt via your endpoint, saves it into the workspace, returns the saved path. With the `dashscope` provider it also accepts an optional `reference_image` for image editing (I2I). |

## Quick start

1. **Install** (npm; or see [Install](#install) for other channels):

   ```sh
   dsh plugin --profile web add dsh-image-plugins
   ```

2. **Configure** — override the `image-plugins` row in your profile's `cordis.patch.yml` with **your own** endpoint and key (any OpenAI-compatible provider):

   ```yaml
   - id: image-plugins
     name: dsh-image-plugins
     config:
       vision:
         baseUrl: 'https://your-vision-endpoint.example.com/v1'
         apiKey: 'sk-...'
         model: 'your-vision-model'
       image:
         baseUrl: 'https://your-image-endpoint.example.com/v1'
         apiKey: 'sk-...'
         model: 'your-image-model'
         defaultSize: '1024x1024'
   ```

3. **Restart `dsh web`**, then in the workspace:

   - 看图：*"Look at `images/screenshot.png` and tell me what it shows."*
   - 生图：*"Generate an image of a red apple on a wooden table."*（保存到 `generated/`）
   - 图生图（需 `dashscope` provider）：*"Change the color of `images/logo.png` to blue."*

## Install

The plugin is a standard dsh **bundle**. From npm (recommended):

```sh
dsh plugin --profile web add dsh-image-plugins
```

Other channels:

```sh
# GitHub (pin a version; the first install needs allowBuilds, see below)
dsh plugin --profile web add github:alanzhao0128/dsh-image-plugins#v0.1.0

# Tarball (npm pack output, send the file)
dsh plugin --profile web add ./dsh-image-plugins-0.1.0.tgz

# Local checkout
dsh plugin --profile web add /path/to/dsh-image-plugins
```

Then restart `dsh web` (or the profile's process). For a GitHub install, pnpm ≥ 10 refuses to run the package's build script until you allow it in the profile's `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  dsh-image-plugins: true
```

then re-run the `add` command. npm and tarball installs ship built artifacts and need no allowance.

> The bundle inserts its row **without configuration**, so after install nothing is enabled until you configure it. The plugin loads fine either way.

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
```

Notes:

- Each block is independent: configure only `vision`, only `image`, or both. A partially filled block (e.g. `baseUrl` without `apiKey`) fails the load loudly.
- `apiKey` accepts a literal value or `env:VARNAME` resolved from the process environment. Keys never enter the session log or tool results.
- The profile patch targets the row by id and replaces its whole config — restate every key you need.
- Endpoints must be OpenAI-compatible: vision = `POST {baseUrl}/chat/completions` accepting `image_url` data URLs; image generation = `POST {baseUrl}/images/generations` returning `data[0].b64_json` or `data[0].url`. Anything compatible — OpenAI, 硅基流动, 智谱, 通义兼容模式, Ollama, etc. — works as-is.

### DashScope (阿里云百炼)

DashScope's compatible-mode path does **not** serve `images/generations` (it 404s), so image generation speaks the native Model Studio API through `provider: 'dashscope'`. Vision (`understand_image`) works through the compatible-mode `chat/completions` path with any VL model. Both share the same API key:

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

With the `dashscope` provider, `generate_image` accepts an optional `reference_image` path. The reference (PNG/JPEG/WebP/GIF, ≤ 10 MiB, cap configurable via `image.maxReferenceBytes`) is sent to the model as base64 alongside the prompt:

> Change the color of `images/logo.png` to blue, keep everything else identical.

The model edits the reference image instead of generating from scratch. The `openai` flavor has no image input and rejects the parameter with a clear error.

## Use

### Understand an image (V1 tool, recommended)

Put the image somewhere in the workspace, then ask the agent:

> Look at `images/screenshot.png` and tell me what it shows.

The agent calls `understand_image` with the path, optionally passing a specific question as `prompt` (e.g. *"what is the trend of the third row in this chart?"*).

### Generate an image (V1 tool, recommended)

> Generate an image of a red apple on a wooden table.

The agent calls `generate_image`; the file lands in the workspace under `generated/` (or your configured `outputDir`) and the tool result reports the path.

## Distribution

| Channel | Install command | Notes |
|---|---|---|
| npm | `dsh plugin --profile web add dsh-image-plugins` | Recommended; no build allowance |
| GitHub | `dsh plugin add github:alanzhao0128/dsh-image-plugins#v0.1.0` | Needs `allowBuilds` once |
| Tarball | `dsh plugin add ./dsh-image-plugins-0.1.0.tgz` | From `npm pack`; safe to delete after install (a later `pnpm install` in the profile may then need the file back) |

## How it stays compatible with dsh's architecture

- Tools are registered through the documented `ctx.tools` seam (`@deepseek-ai/dsh-tools` `defineTool`); tool results are durable log entries, which is exactly the channel the "model-visible ⟺ logged" invariant requires.
- The plugin depends only on published `@deepseek-ai/dsh-tools` and `@deepseek-ai/schemastery`; no internal modules.

## Development

```sh
npm install
npm test          # unit tests against mock endpoints + real Cordis mount
npm run build     # tsc -> lib/ (also runs on prepare)
```

Smoke-verify against a scratch profile (does not touch your real profiles):

```sh
DSH_HOME=/tmp/dsh-image-test-home dsh plugin --profile test add /path/to/dsh-image-plugins
DSH_HOME=/tmp/dsh-image-test-home dsh --profile test --dump-config   # shows the layer
```

## Known Limitations and Deferred Work

- **Binary writes bypass the fs approval events.** The fs seam exposes no binary write today, so `generate_image` resolves the target through `ctx.fs` (consistent path rules, session-workspace cwd) but writes the bytes with `node:fs`. The write therefore does not emit `fs/write-intent` approval events. Switch to a seam write when the fs service grows one.
- **Vision responses are text-only.** The plugin returns descriptions as text; it never emits image content blocks, because a text-only route cannot carry them into the next request.
- **No inline chat preview yet.** Generated images are returned as paths with a generic tool card (the path is clickable to open). An inline preview needs a client-side `tool.call.toolview` registration (V1.5, not shipped).
- **No video generation.** Planned as a background-job capability (`ctx.jobs`) once a provider interface is chosen.
- **No per-request retry/backoff** for endpoint failures; the caller sees the error.
- **Version pinning.** Built and tested against `@deepseek-ai/*` 0.1.0-rc.6; dsh is in developer preview and breaking changes are expected between releases. Re-run `npm test` after upgrading the host.

## License

MIT
