import { execFile } from "node:child_process"
import { open, stat } from "node:fs/promises"
import { promisify } from "node:util"

import type { BurnMode } from "@/lib/burn"

const exec = promisify(execFile)
const hdiutil = "/usr/bin/hdiutil"
const sectorSize = 2048

export class BurnError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message)
  }
}

export async function getDisc() {
  if (process.platform !== "darwin") {
    throw new BurnError("Burna currently requires a macOS host.", 501)
  }

  const { stdout } = await exec("/usr/bin/drutil", ["status", "-xml"], {
    timeout: 10_000,
  })
  // Match the status records, excluding declarations in drutil's inline DTD.
  const drives = [
    ...stdout.matchAll(/<statusfordevice>([\s\S]*?)<\/statusfordevice>/g),
  ]
  if (!drives.length) {
    throw new BurnError(
      "Connect a CD/DVD writer and check the drive again.",
      409
    )
  }
  if (drives.length !== 1) {
    throw new BurnError("Connect only the CD/DVD writer you want to use.", 409)
  }

  const drive = drives[0][1]
  const media = drive.match(
    /<mediaInfo>\s*<blank\s*\/>([\s\S]*?)<\/mediaInfo>/
  )?.[1]
  const kind = media?.match(/<mediaClass value="(CD|DVD)"\s*\/>/)?.[1]
  const space = media?.match(/<freeSpace msf="(\d+):(\d+):(\d+)"\s*\/>/)
  if (!kind || !space || /<mediaIs(?:Busy|InTransition)\s*\/>/.test(drive)) {
    throw new BurnError(
      "Insert a blank, writable CD or DVD and check again.",
      409
    )
  }

  // MSF encodes the free sector count as minutes, seconds and 75 frames/second.
  const [, minutes, seconds, frames] = space.map(Number)
  const capacity = ((minutes * 60 + seconds) * 75 + frames) * sectorSize
  if (!capacity) {
    throw new BurnError("The disc has no writable space.", 409)
  }
  return { kind, capacity }
}

async function validateIso(path: string) {
  const image = await open(path, "r")
  try {
    const { size } = await image.stat()
    if (size % sectorSize === 0) {
      const descriptors = Buffer.alloc(64 * sectorSize)
      const { bytesRead } = await image.read(
        descriptors,
        0,
        descriptors.length,
        16 * sectorSize
      )
      for (
        let offset = 0;
        offset + sectorSize <= bytesRead;
        offset += sectorSize
      ) {
        const identifier = descriptors.toString("ascii", offset + 1, offset + 6)
        if (
          (identifier === "CD001" &&
            descriptors[offset] === 1 &&
            descriptors[offset + 6] === 1) ||
          identifier === "NSR02" ||
          identifier === "NSR03"
        )
          return
      }
    }
    throw new BurnError("Choose a valid ISO 9660 or UDF optical disc image.")
  } finally {
    await image.close()
  }
}

export async function burnDisc(mode: BurnMode, source: string, image: string) {
  if (mode === "data") {
    try {
      await exec(
        hdiutil,
        [
          "makehybrid",
          "-o",
          image,
          source,
          "-iso",
          "-joliet",
          "-udf",
          "-default-volume-name",
          "BURNA",
        ],
        { timeout: 30 * 60_000 }
      )
    } catch (error) {
      console.error("Burna could not create the data disc image", error)
      throw new BurnError(
        "Could not build the data disc. Check the file names and available disk space.",
        422
      )
    }
  } else {
    await validateIso(image)
  }

  const disc = await getDisc()
  if ((await stat(image)).size > disc.capacity) {
    throw new BurnError(
      "The disc image is larger than the available space on the blank disc.",
      413
    )
  }

  try {
    const operation = exec(hdiutil, [
      "burn",
      image,
      "-srcimagekey",
      "diskimage-class=CRawDiskImage",
      "-nosynth",
      "-noaddpmap",
      "-noskipfinalfree",
      "-forceclose",
      "-verifyburn",
      "-eject",
      "-quiet",
    ])
    operation.child.stdin?.end()
    await operation
  } catch (error) {
    console.error("Burna could not burn and verify the disc", error)
    throw new BurnError(
      "macOS could not burn or verify the disc. Check the drive and try with fresh media.",
      422
    )
  }
}
