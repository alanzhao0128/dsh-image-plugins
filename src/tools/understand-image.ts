/**
 * The `understand_image` tool: reads an image file from the workspace and
 * sends it to the configured vision model, returning the model's text
 * description as the tool result (which enters the session log, so a
 * text-only main model can reason about images without ever receiving one).
 * @module dsh-image-plugins/src/tools/understand-image
 */

import { basename, extname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import type { VisionConfig } from '../config.js'
import { DEFAULT_MAX_IMAGE_BYTES, DEFAULT_TIMEOUT_MS, DEFAULT_VISION_PROMPT } from '../config.js'
import { sessionResolveOptions } from '../session-cwd.js'
import { callVision } from '../vision.js'

/** Raster formats accepted by the tool, keyed by lowercase extension. */
const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/** Register the understand_image tool. The vision endpoint must be configured. */
export function applyUnderstandImageTool(ctx: Context, vision: VisionConfig): void {
  ctx.tools.register(defineTool({
    name: 'understand_image',
    description: 'Understand an image file: send it to the configured vision model and return its text description. Use it when the user references an image file (screenshot, chart, photo) and asks what it shows or asks a question about its content.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path to the image file, resolved by the filesystem backend.' },
      prompt: { type: 'string', description: 'Specific question or instruction about the image. Defaults to a general description.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          description: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [
        { type: 'text', text: `<path>${value.path}</path>\n<content>\n${value.description}\n</content>` },
      ],
    },
    async execute(args, exec) {
      if (args.file_path.trim() === '') throw new Error('file_path must be a non-empty string')
      const mediaType = IMAGE_EXTENSIONS[extname(args.file_path).toLowerCase()]
      if (mediaType === undefined) {
        throw new Error(`cannot understand "${args.file_path}": only PNG/JPEG/WebP/GIF files are supported`)
      }
      const fs = ctx.get('fs')
      if (fs === undefined) throw new Error('cannot understand an image: no filesystem service is mounted')
      const target = await fs.resolve(args.file_path, sessionResolveOptions(exec, exec.signal))
      const maxBytes = vision.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES
      const data = await fs.readBytes(target, exec.signal, maxBytes)
      const description = await callVision(
        {
          baseUrl: vision.baseUrl,
          apiKey: vision.apiKey,
          model: vision.model,
          timeoutMs: vision.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          systemPrompt: vision.systemPrompt,
          signal: exec.signal,
        },
        args.prompt ?? vision.defaultPrompt ?? DEFAULT_VISION_PROMPT,
        { mediaType, data, name: basename(target.displayPath) },
      )
      return { path: target.displayPath, description }
    },
    presentCall(args): GenericCallView {
      return {
        card: 'generic',
        title: `Understand image ${args.file_path}`,
        kind: 'read',
        locations: [{ path: args.file_path }],
      }
    },
  }))
}
