import { execFile } from "node:child_process"
import { link, mkdir, open, readFile, stat, writeFile } from "node:fs/promises"
import { extname, join } from "node:path"
import { promisify } from "node:util"

import { imageFormat } from "@/lib/burn"
import { BurnError } from "./burn-error"
import { cloneCue } from "./clonecd"

const exec = promisify(execFile)
const toolTimeout = 30 * 60_000
const maxSheetBytes = 1024 * 1024
const sheetCommands =
  /^(?:CATALOG|FLAGS|INDEX|ISRC|PERFORMER|POSTGAP|PREGAP|SONGWRITER|TITLE|TRACK)[ \t]+\S/i
type Disc = { kind: string; capacity: number }

function key(name: string) {
  return name.normalize("NFC").toLowerCase()
}

function requireCd(disc: Disc) {
  if (disc.kind !== "CD")
    throw new BurnError("Insert a blank CD for this track-based image.", 409)
}

function ensureFits(bytes: number | bigint, disc: Disc) {
  if (bytes > disc.capacity) {
    throw new BurnError(
      "The expanded image is larger than the available space on the disc.",
      413
    )
  }
}

async function convert(
  tool: string,
  args: string[],
  message: string,
  cwd?: string
) {
  try {
    const operation = exec(tool, args, { cwd, timeout: toolTimeout })
    operation.child.stdin?.end()
    const { stdout } = await operation
    return stdout
  } catch (error) {
    if (
      tool === "chdman" &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new BurnError(
        "chdman is required for CHD images. Install it with brew install rom-tools.",
        501
      )
    }
    console.error(`Burna conversion failed using ${tool}`, error)
    throw new BurnError(message, 422)
  }
}

async function readSheet(path: string) {
  const { size } = await stat(path)
  if (!size || size > maxSheetBytes)
    throw new BurnError("The image layout file is empty or too large.")
  return readFile(path, "utf8")
}

async function prepareCue(
  cue: string,
  companions: string[],
  source: string,
  directory: string
) {
  const sheet = await readSheet(cue)
  const available = new Map(companions.map((name) => [key(name), name]))
  const tracks = join(directory, "tracks")
  await mkdir(tracks)
  const lines: string[] = []
  let binaryFiles = 0
  let hasCdText = false

  for (const rawLine of sheet.split(/\r\n|\n|\r/)) {
    const line = rawLine.trim()
    if (/^REM[ \t]+SESSION[ \t]+0*(?:[2-9]|[1-9]\d+)\b/i.test(line)) {
      throw new BurnError("This CUE sheet describes more than one CD session.")
    }
    if (!line || /^REM(?:\s|$)/i.test(line)) continue
    const file = line.match(/^FILE[ \t]+(?:"([^"]+)"|([^"\s]+))[ \t]+BINARY$/i)
    const text = line.match(/^CDTEXTFILE[ \t]+(?:"([^"]+)"|([^"\s]+))$/i)
    const reference = file ?? text
    if (reference) {
      const name = available.get(key(reference[1] ?? reference[2]))
      const extension = file ? ".bin" : ".cdt"
      if (!name || extname(name).toLowerCase() !== extension) {
        throw new BurnError(
          "Select every file referenced by the CUE sheet. Use local filenames and binary tracks."
        )
      }
      if (text) {
        if (hasCdText)
          throw new BurnError("Use one CD-Text file per CUE sheet.")
        hasCdText = true
      }
      const alias = file ? `track-${++binaryFiles}.bin` : "disc.cdt"
      await link(join(source, name), join(tracks, alias))
      lines.push(file ? `FILE "${alias}" BINARY` : `CDTEXTFILE "${alias}"`)
    } else if (
      sheetCommands.test(line) &&
      !/\p{Cc}/u.test(line.replaceAll("\t", ""))
    ) {
      lines.push(line)
    } else {
      throw new BurnError(
        "The CUE sheet contains an unsupported command or file type."
      )
    }
  }

  if (!binaryFiles)
    throw new BurnError(
      "The CUE sheet must reference at least one binary track file."
    )
  const path = join(tracks, "disc.cue")
  await writeFile(path, lines.join("\n") + "\n", { flag: "wx" })
  return { kind: "cue" as const, path }
}

async function prepareClone(
  source: string,
  files: string[],
  directory: string,
  trackCopy: boolean
) {
  if (!trackCopy) {
    throw new BurnError(
      "Confirm that the CloneCD track copy may omit raw subchannel data and embedded CD-Text."
    )
  }
  const name = files.find((file) => key(file).endsWith(".ccd"))!
  const image = files.find((file) => key(file).endsWith(".img"))!
  const sub = files.find((file) => key(file).endsWith(".sub"))!
  const [{ size }, { size: subSize }] = await Promise.all([
    stat(join(source, image)),
    stat(join(source, sub)),
  ])
  if (!size || size % 2352 || subSize !== (size / 2352) * 96) {
    throw new BurnError("The CloneCD IMG and SUB sector counts do not match.")
  }

  const layout = await readSheet(join(source, name))
  const cue = cloneCue(layout, size / 2352)
  const path = join(directory, "clone.cue")
  await link(join(source, image), join(directory, "clone.bin"))
  await writeFile(path, cue, { flag: "wx" })
  return { kind: "cue" as const, path }
}

async function expandDmg(path: string, directory: string, disc: Disc) {
  const file = await open(path, "r")
  try {
    const { size } = await file.stat()
    const footer = Buffer.alloc(512)
    if (size >= footer.length)
      await file.read(footer, 0, footer.length, size - footer.length)
    if (
      footer.toString("ascii", 0, 4) !== "koly" ||
      footer.readUInt32BE(60) > 1
    ) {
      throw new BurnError("Choose an unencrypted, single-file UDIF DMG image.")
    }
    const sectors = footer.readBigUInt64BE(0x1ec)
    if (!sectors) throw new BurnError("The DMG image has no data sectors.")
    ensureFits(sectors * 512n, disc)
  } finally {
    await file.close()
  }

  const output = join(directory, "master.cdr")
  await convert(
    "/usr/bin/hdiutil",
    [
      "convert",
      "-srcimagekey",
      "diskimage-class=CUDIFDiskImage",
      "-format",
      "UDTO",
      "-o",
      output,
      path,
    ],
    "macOS could not convert the DMG into a CD/DVD master."
  )
  return output
}

async function expandChd(path: string, directory: string, disc: Disc) {
  const info = await convert(
    "chdman",
    ["info", "-i", path],
    "Could not read the CHD. Choose a self-contained CD or DVD image."
  )
  if (/^Parent SHA1:/m.test(info)) {
    throw new BurnError(
      "Choose a self-contained CHD that does not require a parent image."
    )
  }
  const length = Number(
    info.match(/^Logical size:\s*([\d,]+)\s+bytes/im)?.[1].replaceAll(",", "")
  )
  if (!Number.isSafeInteger(length) || length <= 0) {
    throw new BurnError("The CHD does not report a valid expanded size.")
  }

  const dvd = /^Metadata:\s+Tag='DVD '/m.test(info)
  if (dvd) {
    if (disc.kind !== "DVD")
      throw new BurnError("Insert a blank DVD for this CHD.", 409)
    ensureFits(length, disc)
    const output = join(directory, "dvd.iso")
    await convert(
      "chdman",
      ["extractdvd", "-i", path, "-o", output],
      "Could not extract the DVD image from the CHD."
    )
    return { kind: "raw" as const, path: output }
  }

  if (!/^Metadata:\s+Tag='(?:CHCD|CHTR|CHT2)'/m.test(info)) {
    throw new BurnError(
      "Choose a CD or DVD CHD. Other CHD media types cannot be burned here."
    )
  }
  requireCd(disc)
  // CHD CD frames contain 2352 track bytes plus 96 subchannel bytes.
  ensureFits(Math.ceil(length / 2448) * 2048, disc)
  const cue = join(directory, "cd.cue")
  await convert(
    "chdman",
    ["extractcd", "-i", path, "-o", "cd.cue", "-ob", "cd.bin"],
    "Could not extract the CD tracks from the CHD.",
    directory
  )
  return prepareCue(cue, ["cd.bin"], directory, directory)
}

export async function prepareImage(
  source: string,
  files: string[],
  directory: string,
  disc: Disc,
  trackCopy: boolean
) {
  const format = imageFormat(files)
  const path = join(source, files[0])
  switch (format) {
    case "iso":
      return { kind: "iso" as const, path }
    case "cdr":
      return { kind: "raw" as const, path }
    case "dmg":
      return {
        kind: "raw" as const,
        path: await expandDmg(path, directory, disc),
      }
    case "chd":
      return expandChd(path, directory, disc)
    case "cue": {
      requireCd(disc)
      const cue = files.find((file) => key(file).endsWith(".cue"))!
      return prepareCue(join(source, cue), files, source, directory)
    }
    case "ccd":
      requireCd(disc)
      return prepareClone(source, files, directory, trackCopy)
    default:
      throw new BurnError(
        "Choose one ISO, CDR, DMG, or CHD, or select a complete BIN/CUE or CloneCD set."
      )
  }
}
