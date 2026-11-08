import type { APIRoute } from "astro"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { burnDisc, BurnError, getDisc } from "@/lib/server/optical"
import { stageFiles } from "@/lib/server/upload"

let busy = false

function reply(data: object, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  })
}

function failure(error: unknown) {
  if (error instanceof BurnError)
    return reply({ error: error.message }, error.status)
  console.error("Burna operation failed", error)
  return reply(
    { error: "The local burner could not complete the request." },
    500
  )
}

function isLocal({ clientAddress, request, url }: Parameters<APIRoute>[0]) {
  return (
    ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(clientAddress) &&
    ["127.0.0.1", "localhost"].includes(url.hostname) &&
    request.headers.get("Host") === url.host &&
    !request.headers.has("X-Forwarded-For") &&
    request.headers.get("X-Burna-Request") === "1" &&
    (request.method === "GET" || request.headers.get("Origin") === url.origin)
  )
}

export const GET: APIRoute = async (context) => {
  if (!isLocal(context)) return reply({ error: "Open Burna on this Mac." }, 403)
  if (busy) return reply({ error: "A burn is already in progress." }, 409)

  try {
    return reply(await getDisc())
  } catch (error) {
    return failure(error)
  }
}

export const POST: APIRoute = async (context) => {
  if (!isLocal(context)) return reply({ error: "Open Burna on this Mac." }, 403)
  if (busy) return reply({ error: "A burn is already in progress." }, 409)

  const mode = context.url.searchParams.get("mode")
  if (mode !== "iso" && mode !== "data") {
    return reply({ error: "Choose an ISO image or a data disc." }, 400)
  }

  busy = true
  let directory: string | undefined
  try {
    await getDisc()
    directory = await mkdtemp(join(tmpdir(), "burna-"))
    const source = join(directory, "files")
    const image = join(directory, "disc.iso")
    await mkdir(source)
    await stageFiles(context.request, mode, source, image)
    await burnDisc(mode, source, image)
    return reply({ message: "The disc was burned, verified, and ejected." })
  } catch (error) {
    return failure(error)
  } finally {
    try {
      if (directory) await rm(directory, { recursive: true, force: true })
    } catch (error) {
      console.error("Burna could not remove temporary files", error)
    } finally {
      busy = false
    }
  }
}
