import { randomBytes } from "node:crypto"
import { createServer } from "node:http"

process.env.ASTRO_NODE_AUTOSTART = "disabled"
process.env.BURNA_DESKTOP_TOKEN = randomBytes(32).toString("hex")
process.env.PATH = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  process.env.PATH,
  "/usr/bin",
  "/bin",
]
  .filter(Boolean)
  .join(":")

const { handler } = await import("./server/entry.mjs")
const server = createServer((request, response) => {
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
  )
  handler(request, response)
})

server.listen(0, "127.0.0.1", () => {
  process.stdout.write(
    `BURNA_READY ${server.address().port} ${process.env.BURNA_DESKTOP_TOKEN}\n`
  )
})

// The Tauri process keeps stdin open. Stop serving when it exits, leaving
// any native burn and its temporary-file cleanup to finish.
process.stdin.on("end", () => server.close())
process.stdin.resume()
