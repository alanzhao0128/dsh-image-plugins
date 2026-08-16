/**
 * The `generate_image` tool: generates one image from a text prompt through
 * the configured OpenAI-compatible endpoint, saves the bytes into the
 * workspace with node:fs, and returns the saved path.
 *
 * The fs seam exposes no binary write today, so the tool writes with
 * node:fs/promises after resolving the target through ctx.fs. That resolution
 * keeps path rules consistent with the product, but the write itself does not
 * emit fs/write-intent approval events (a known limitation, see README).
 * @module dsh-image-plugins/src/tools/generate-image
 */

import { dirname, extname } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import type { ImageConfig } from '../config.js'
import { DEFAULT_IMAGE_OUTPUT_DIR, DEFAULT_IMAGE_SIZE, DEFAULT_IMAGE_TIMEOUT_MS, DEFAULT_MAX_REFERENCE_BYTES } from '../config.js'
import { callImageGen, type ReferenceImage } from '../image-gen.js'
import { sessionResolveOptions } from '../session-cwd.js'
import { truncate } from '../vision.js'

/** Raster formats accepted as reference images, keyed by lowercase extension. */
const REFERENCE_EXTENSIONS: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/** Read one reference image through the fs seam, enforcing the byte cap. */
async function readReferenceImage(
  ctx: Context,
  path: string,
  maxBytes: number,
  signal: AbortSignal | undefined,
  cwd: string | undefined,
): Promise<ReferenceImage> {
  const mediaType = REFERENCE_EXTENSIONS[extname(path).toLowerCase()]
  if (mediaType === undefined) {
    throw new Error(`cannot use "${path}" as a reference image: only PNG/JPEG/WebP/GIF files are supported`)
  }
  const fs = ctx.get('fs')
  if (fs === undefined) throw new Error('cannot read a reference image: no filesystem service is mounted')
  const target = await fs.resolve(path, {
    ...cwd === undefined ? {} : { cwd },
    signal,
  })
  const data = await fs.readBytes(target, signal, maxBytes)
  return { mediaType, data, name: path }
}

/** Derive a filesystem-safe name fragment from the prompt. */
export function slugify(prompt: string): string {
  const slug = prompt.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return slug === '' ? 'image' : slug
}

/** Default workspace-relative output path for a generated image. */
export function defaultOutputPath(outputDir: string, format: string, prompt: string, now = Date.now()): string {
  return `${outputDir.replace(/\/+$/, '')}/${now}-${slugify(prompt)}.${format}`
}

/** Register the generate_image tool. The generation endpoint must be configured. */
export function applyGenerateImageTool(ctx: Context, image: ImageConfig): void {
  ctx.tools.register(defineTool({
    name: 'generate_image',
    description: 'Generate an image from a text prompt using the configured image-generation model, save it into the workspace, and return the saved file path.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'Detailed description of the image to generate; for image editing, describe how the reference image should change.' },
      size: { type: 'string', description: 'Output size such as 1024x1024. Defaults to the configured size.' },
      output_path: { type: 'string', description: 'Where to save the image, relative to the workspace or absolute. Defaults to generated/<timestamp>.png.' },
      reference_image: { type: 'string', description: 'Path to a reference image (PNG/JPEG/WebP/GIF) for image editing (I2I); only supported with the dashscope provider.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          bytes: { type: 'integer', required: true },
          format: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [
        { type: 'text', text: `Saved generated image to ${value.path} (${value.bytes} bytes, ${value.format}).` },
      ],
    },
    async execute(args, exec) {
      if (args.prompt.trim() === '') throw new Error('prompt must be a non-empty string')
      const resolveOptions = sessionResolveOptions(exec, exec.signal)
      const referenceImages = args.reference_image === undefined
        ? undefined
        : [await readReferenceImage(ctx, args.reference_image, image.maxReferenceBytes ?? DEFAULT_MAX_REFERENCE_BYTES, exec.signal, resolveOptions.cwd)]
      if (referenceImages !== undefined && image.provider !== 'dashscope') {
        throw new Error('reference_image requires the dashscope provider; set image.provider to "dashscope" to use image editing')
      }
      const { data, format } = await callImageGen(
        {
          baseUrl: image.baseUrl,
          apiKey: image.apiKey,
          model: image.model,
          timeoutMs: image.timeoutMs ?? DEFAULT_IMAGE_TIMEOUT_MS,
          signal: exec.signal,
          size: args.size ?? image.defaultSize,
          provider: image.provider,
          referenceImages,
        },
        args.prompt,
      )
      const fs = ctx.get('fs')
      if (fs === undefined) throw new Error('cannot save a generated image: no filesystem service is mounted')
      const outputDir = image.outputDir ?? DEFAULT_IMAGE_OUTPUT_DIR
      const relative = args.output_path ?? defaultOutputPath(outputDir, format, args.prompt)
      const target = await fs.resolve(relative, resolveOptions)
      const processPath = fs.processPath(target)
      await mkdir(dirname(processPath), { recursive: true })
      await writeFile(processPath, data)
      return { path: target.displayPath, bytes: data.length, format }
    },
    presentCall(args): GenericCallView {
      return { card: 'generic', title: `Generate image: ${truncate(args.prompt, 60)}` }
    },
  }))
}
