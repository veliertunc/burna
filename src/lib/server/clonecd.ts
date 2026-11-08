import { BurnError } from "./burn-error"

const trackModes = ["AUDIO", "MODE1/2352", "MODE2/2352"]

function parseSections(layout: string) {
  const sections = new Map<string, Map<string, string>>()
  let section: Map<string, string> | undefined
  for (const raw of layout.split(/\r\n|\n|\r/)) {
    const line = raw.trim()
    if (!line || /^[;#]/.test(line)) continue
    const header = line.match(/^\[([^\]]+)\]$/)
    if (header) {
      const name = header[1].trim().replace(/\s+/g, " ").toUpperCase()
      if (sections.has(name))
        throw new BurnError("The CloneCD layout repeats a section.")
      section = new Map()
      sections.set(name, section)
      continue
    }
    const property = line.match(/^([^=]+)=(.*)$/)
    if (!property || !section)
      throw new BurnError("The CloneCD layout could not be read.")
    const name = property[1].trim().replace(/\s+/g, " ").toUpperCase()
    if (section.has(name))
      throw new BurnError("The CloneCD layout repeats a property.")
    section.set(name, property[2].trim())
  }
  return sections
}

function msf(frames: number) {
  return [Math.floor(frames / 4500), Math.floor(frames / 75) % 60, frames % 75]
    .map((value) => String(value).padStart(2, "0"))
    .join(":")
}

export function cloneCue(layout: string, sectors: number) {
  const sections = parseSections(layout)
  const disc = sections.get("DISC")
  if (
    !sections.has("CLONECD") ||
    disc?.get("SESSIONS") !== "1" ||
    disc.get("DATATRACKSSCRAMBLED") !== "0"
  ) {
    throw new BurnError(
      "CloneCD track copies require a single session with unscrambled tracks."
    )
  }

  const lines: string[] = []
  const catalog = disc.get("CATALOG") ?? ""
  if (/^\d{13}$/.test(catalog)) lines.push(`CATALOG ${catalog}`)
  lines.push('FILE "clone.bin" BINARY')

  const tracks = [...sections]
    .flatMap(([name, values]) => {
      const match = name.match(/^TRACK (\d{1,2})$/)
      return match ? [{ number: Number(match[1]), values }] : []
    })
    .sort((a, b) => a.number - b.number)
  if (!tracks.length) throw new BurnError("The CloneCD layout has no tracks.")

  let previousSector = -1
  for (const [offset, { number, values }] of tracks.entries()) {
    const mode = trackModes[Number(values.get("MODE"))]
    if (!mode || number !== offset + 1) {
      throw new BurnError(
        "The CloneCD layout contains an invalid track number or mode."
      )
    }
    lines.push(`  TRACK ${String(number).padStart(2, "0")} ${mode}`)
    const flags = values.get("FLAGS") ?? ""
    if (/^(?:DCP|4CH|PRE|SCMS)(?:\s+(?:DCP|4CH|PRE|SCMS))*$/i.test(flags)) {
      lines.push(`    FLAGS ${flags.toUpperCase()}`)
    }
    const isrc = values.get("ISRC") ?? ""
    if (mode === "AUDIO" && /^[A-Z0-9]{5}\d{7}$/i.test(isrc)) {
      lines.push(`    ISRC ${isrc.toUpperCase()}`)
    }

    const indexes = [...values]
      .flatMap(([name, value]) => {
        const match = name.match(/^INDEX (\d{1,2})$/)
        return match ? [{ index: Number(match[1]), value }] : []
      })
      .sort((a, b) => a.index - b.index)
    if (!indexes.some(({ index }) => index === 1)) {
      throw new BurnError("Each CloneCD track must have an INDEX 1.")
    }
    let previousIndex = -1
    for (const { index, value } of indexes) {
      const sector = Number(value)
      if (
        !/^\d+$/.test(value) ||
        sector >= sectors ||
        sector <= previousSector ||
        index === previousIndex
      ) {
        throw new BurnError(
          "The CloneCD layout contains an invalid track index."
        )
      }
      lines.push(`    INDEX ${String(index).padStart(2, "0")} ${msf(sector)}`)
      previousSector = sector
      previousIndex = index
    }
  }
  return lines.join("\n") + "\n"
}
