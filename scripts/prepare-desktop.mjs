import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { createWriteStream } from "node:fs"
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
} from "node:fs/promises"
import { join } from "node:path"
import { pipeline } from "node:stream/promises"
import { fileURLToPath } from "node:url"

const nodeVersion = "22.23.4"
// Checksums from the official release's SHASUMS256.txt.
const platforms = {
  arm64: {
    target: "aarch64-apple-darwin",
    sha256: "c9e1dbc748b33ed2d14f42445191ecaf14c56259c7a9a26d0042c49ec2b66428",
  },
  x64: {
    target: "x86_64-apple-darwin",
    sha256: "efcc2b0db6f94bf53eddb038fe2b370277a042bd29e4f19b8f8e23598795b819",
  },
}
const platform = platforms[process.arch]
const requestedTarget = process.env.TAURI_ENV_TARGET_TRIPLE
if (
  process.platform !== "darwin" ||
  !platform ||
  (requestedTarget && requestedTarget !== platform.target)
) {
  throw new Error(
    "Build Burna Desktop on a Mac with native Node and Rust for the target architecture."
  )
}

const root = fileURLToPath(new URL("..", import.meta.url))
const buildDir = join(root, "src-tauri", ".desktop")
const runtime = join(buildDir, "runtime")
const binaries = join(root, "src-tauri", "binaries")
const archiveBase = `node-v${nodeVersion}-darwin-${process.arch}`
const archive = join(buildDir, `${archiveBase}.tar.gz`)
const sidecar = join(binaries, `burna-node-${platform.target}`)

await mkdir(buildDir, { recursive: true })
await mkdir(binaries, { recursive: true })

async function checksum(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex")
}

let cached
try {
  cached = await checksum(archive)
} catch (error) {
  if (error.code !== "ENOENT") throw error
}
if (cached !== platform.sha256) {
  const temp = await mkdtemp(join(buildDir, "download-"))
  try {
    const partial = join(temp, "node.tar.gz")
    const url = `https://nodejs.org/dist/v${nodeVersion}/${archiveBase}.tar.gz`
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
    if (!response.ok || !response.body) {
      throw new Error(
        `Could not download the Node runtime (HTTP ${response.status}).`
      )
    }
    await pipeline(response.body, createWriteStream(partial))
    if ((await checksum(partial)) !== platform.sha256) {
      throw new Error(
        "The downloaded Node runtime did not match its SHA-256 checksum."
      )
    }
    await rename(partial, archive)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

execFileSync("pnpm", ["build"], {
  cwd: root,
  env: { ...process.env, BURNA_DESKTOP_BUILD: "1" },
  stdio: "inherit",
})

const unpacked = await mkdtemp(join(buildDir, "node-"))
try {
  execFileSync("/usr/bin/tar", [
    "-xzf",
    archive,
    "-C",
    unpacked,
    `${archiveBase}/bin/node`,
    `${archiveBase}/LICENSE`,
  ])
  // Replace the staging copy atomically so an interrupted build leaves it intact.
  const node = join(unpacked, archiveBase, "bin", "node")
  await chmod(node, 0o755)
  await rename(node, sidecar)
  await copyFile(
    join(unpacked, archiveBase, "LICENSE"),
    join(runtime, "NODE-LICENSE.txt")
  )
} finally {
  await rm(unpacked, { recursive: true, force: true })
}

await copyFile(
  join(root, "scripts", "desktop.mjs"),
  join(runtime, "desktop.mjs")
)
