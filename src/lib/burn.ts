export const maxDiscBytes = 8_547_991_552
export const maxFiles = 1000
export const maxRequestBytes = maxDiscBytes + 1024 * 1024

export type BurnMode = "image" | "data"
export const imageAccept = ".iso,.cdr,.dmg,.chd,.cue,.bin,.cdt,.ccd,.img,.sub"

export function imageFormat(files: string[]) {
  const names = files.map((file) => file.normalize("NFC").toLowerCase())
  const extensions = names.map((name) => name.slice(name.lastIndexOf(".")))
  if (extensions.length === 1) {
    const [ext] = extensions
    if (ext === ".iso" || ext === ".cdr" || ext === ".dmg" || ext === ".chd") {
      return ext.slice(1) as "iso" | "cdr" | "dmg" | "chd"
    }
  }
  if (
    extensions.filter((ext) => ext === ".cue").length === 1 &&
    extensions.includes(".bin") &&
    extensions.every((ext) => [".cue", ".bin", ".cdt"].includes(ext))
  )
    return "cue"

  const clone = names.find((name) => name.endsWith(".ccd"))
  if (clone && names.length === 3) {
    const stem = clone.slice(0, -4)
    if (names.includes(stem + ".img") && names.includes(stem + ".sub"))
      return "ccd"
  }
}
