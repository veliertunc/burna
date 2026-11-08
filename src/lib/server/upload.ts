import { createWriteStream } from "node:fs"
import { join } from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { ReadableStream as NodeReadableStream } from "node:stream/web"
import busboy from "busboy"

import { maxFiles, maxRequestBytes } from "@/lib/burn"
import { BurnError } from "./burn-error"

export async function stageFiles(request: Request, source: string) {
  if (
    !request.body ||
    !request.headers.get("content-type")?.startsWith("multipart/form-data;")
  ) {
    throw new BurnError("Submit the files using the Burna form.", 415)
  }

  const tooLarge = new BurnError(
    "The files exceed the supported DVD size.",
    413
  )
  if (Number(request.headers.get("content-length")) > maxRequestBytes)
    throw tooLarge

  let parser: ReturnType<typeof busboy>
  try {
    parser = busboy({
      headers: Object.fromEntries(request.headers),
      defParamCharset: "utf8",
      preservePath: true,
      limits: { files: maxFiles, fields: 0 },
    })
  } catch {
    throw new BurnError("The upload could not be read.")
  }

  const names = new Map<string, string>()
  const writes: Promise<void>[] = []
  let fileError: BurnError | undefined
  let received = 0
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      received += chunk.length
      if (received > maxRequestBytes) done(tooLarge)
      else done(null, chunk)
    },
  })

  parser.on("filesLimit", () => {
    fileError = new BurnError(`Choose up to ${maxFiles} files.`)
  })
  parser.on("fieldsLimit", () => {
    fileError = new BurnError("The upload contains an unexpected field.")
  })
  parser.on("file", (field, stream, info) => {
    let filename = ""
    try {
      filename = decodeURIComponent(info.filename ?? "")
    } catch {
      fileError = new BurnError("The upload contains an invalid file name.")
    }
    const key = filename.normalize("NFC").toLowerCase()
    if (
      field !== "files" ||
      !filename ||
      filename === "." ||
      filename === ".." ||
      // eslint-disable-next-line no-control-regex -- Reject control characters in filenames.
      /[/\\:\x00-\x1f\x7f]/.test(filename) ||
      Buffer.byteLength(filename) > 255 ||
      names.has(key)
    ) {
      fileError = new BurnError("Choose files with valid, unique file names.")
    }
    if (fileError) {
      stream.resume()
      return
    }

    names.set(key, filename)
    const target = join(source, filename)
    writes.push(
      pipeline(stream, createWriteStream(target, { flags: "wx" })).catch(() => {
        fileError ??= new BurnError(
          "Could not save the upload. Check available disk space.",
          507
        )
        parser.destroy(fileError)
      })
    )
  })

  try {
    await pipeline(
      Readable.fromWeb(
        request.body as unknown as NodeReadableStream<Uint8Array>
      ),
      limit,
      parser
    )
  } catch (error) {
    if (error instanceof BurnError) throw error
    throw new BurnError("The upload was interrupted or could not be read.")
  } finally {
    await Promise.all(writes)
  }

  if (fileError) throw fileError
  if (!names.size) throw new BurnError("Choose at least one file.")
  return [...names.values()]
}
