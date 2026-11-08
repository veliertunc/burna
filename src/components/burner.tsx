import { useState, type SubmitEvent } from "react"
import {
  DiscIcon,
  FileArrowUpIcon,
  FolderOpenIcon,
} from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import {
  imageAccept,
  imageFormat,
  maxDiscBytes,
  maxFiles,
  type BurnMode,
} from "@/lib/burn"

const modes = [
  { id: "image", label: "Burn image", icon: DiscIcon },
  { id: "data", label: "Burn files", icon: FolderOpenIcon },
] as const

declare global {
  interface Window {
    readonly __BURNA_DESKTOP_TOKEN__?: string
  }
}

function requestHeaders() {
  const headers = new Headers({ "X-Burna-Request": "1" })
  if (window.__BURNA_DESKTOP_TOKEN__) {
    headers.set("X-Burna-Desktop", window.__BURNA_DESKTOP_TOKEN__)
  }
  return headers
}

function formatSize(bytes: number) {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`
  return `${bytes} B`
}

export function Burner() {
  const [mode, setMode] = useState<BurnMode>("image")
  const [files, setFiles] = useState<File[]>([])
  const [trackCopy, setTrackCopy] = useState(false)
  const [disc, setDisc] = useState<{ kind: string; capacity: number }>()
  const [working, setWorking] = useState<"checking" | "burning">()
  const [notice, setNotice] = useState<{ message: string; error: boolean }>()

  const size = files.reduce((total, file) => total + file.size, 0)
  const format =
    mode === "image" ? imageFormat(files.map((file) => file.name)) : undefined
  const invalidImage =
    mode === "image" &&
    files.length > 0 &&
    (!format || files.some((file) => !file.size))
  const discLimit =
    mode === "data" || format === "iso" || format === "cdr"
      ? (disc?.capacity ?? maxDiscBytes)
      : maxDiscBytes
  const tooLarge = size > Math.min(maxDiscBytes, discLimit)
  const needsCd = disc?.kind === "DVD" && (format === "cue" || format === "ccd")
  const canBurn =
    !working &&
    !!disc &&
    files.length > 0 &&
    files.length <= maxFiles &&
    !invalidImage &&
    !tooLarge &&
    !needsCd &&
    (format !== "ccd" || trackCopy)

  async function checkDrive() {
    setWorking("checking")
    setNotice(undefined)
    setDisc(undefined)
    try {
      const response = await fetch("/api/burn", { headers: requestHeaders() })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      setDisc(result)
    } catch (error) {
      setNotice({
        message:
          error instanceof Error ? error.message : "The drive check failed.",
        error: true,
      })
    } finally {
      setWorking(undefined)
    }
  }

  async function burn(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canBurn) return

    setWorking("burning")
    setNotice(undefined)
    const body = new FormData()
    for (const file of files)
      body.append("files", file, encodeURIComponent(file.name))
    try {
      const response = await fetch(
        `/api/burn?mode=${mode}&trackCopy=${trackCopy ? "1" : "0"}`,
        {
          method: "POST",
          headers: requestHeaders(),
          body,
        }
      )
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      setNotice({ message: result.message, error: false })
    } catch (error) {
      setNotice({
        message:
          error instanceof Error ? error.message : "The burn request failed.",
        error: true,
      })
    } finally {
      setDisc(undefined)
      setWorking(undefined)
    }
  }

  return (
    <form onSubmit={burn} className="space-y-6">
      <fieldset disabled={!!working} className="space-y-3">
        <legend className="mb-3 text-sm font-medium">
          1. Choose what to burn
        </legend>
        <div className="grid grid-cols-2 gap-2">
          {modes.map(({ id, label, icon: Icon }) => (
            <Button
              key={id}
              type="button"
              variant={mode === id ? "default" : "outline"}
              size="lg"
              aria-pressed={mode === id}
              onClick={() => {
                if (mode !== id) {
                  setMode(id)
                  setFiles([])
                  setTrackCopy(false)
                  setNotice(undefined)
                }
              }}
            >
              <Icon aria-hidden="true" />
              {label}
            </Button>
          ))}
        </div>
        <label className="block space-y-2 border border-border p-4 text-sm">
          <span className="flex items-center gap-2 font-medium">
            <FileArrowUpIcon className="size-4" aria-hidden="true" />
            {mode === "image" ? "Disc image" : "Data files"}
          </span>
          <span className="block text-xs leading-relaxed text-muted-foreground">
            {mode === "image"
              ? "Choose one ISO, CDR, DMG, or CHD, or select all files in a BIN/CUE or CloneCD set."
              : "Create a data CD or DVD from the files you select."}
          </span>
          <input
            key={mode}
            type="file"
            accept={mode === "image" ? imageAccept : undefined}
            multiple
            onChange={(event) => {
              setFiles(Array.from(event.currentTarget.files ?? []))
              setTrackCopy(false)
              setNotice(undefined)
            }}
            className="block w-full min-w-0 text-xs file:mr-3 file:border-0 file:bg-muted file:px-3 file:py-2 file:font-medium"
          />
          {files.length > 0 && (
            <span className="block text-xs break-all text-muted-foreground">
              {files.length === 1 ? files[0].name : `${files.length} files`} ·{" "}
              {formatSize(size)}
            </span>
          )}
        </label>
        {invalidImage && (
          <p role="alert" className="text-sm text-destructive">
            Choose non-empty files for one supported image or a complete image
            set.
          </p>
        )}
        {tooLarge && (
          <p role="alert" className="text-sm text-destructive">
            {size > maxDiscBytes
              ? "The selection exceeds the upload limit."
              : "The selection exceeds the available disc size."}
          </p>
        )}
        {format === "ccd" && (
          <label className="flex items-start gap-2 text-xs leading-relaxed">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={trackCopy}
              onChange={(event) => setTrackCopy(event.currentTarget.checked)}
            />
            Burn the CloneCD tracks and omit raw subchannel data and embedded
            CD-Text.
          </label>
        )}
        {format === "chd" && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            CHD requires chdman. CD extraction uses the track layout and can
            omit raw subchannel data.
          </p>
        )}
        {needsCd && (
          <p role="alert" className="text-sm text-destructive">
            Insert a blank CD for this image.
          </p>
        )}
        {files.length > maxFiles && (
          <p role="alert" className="text-sm text-destructive">
            Choose up to {maxFiles} files.
          </p>
        )}
      </fieldset>

      <fieldset disabled={!!working} className="space-y-3">
        <legend className="mb-3 text-sm font-medium">
          2. Prepare the drive
        </legend>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Connect one writer and insert a blank, writable CD or DVD.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" onClick={checkDrive}>
            {working === "checking" ? "Checking…" : "Check drive"}
          </Button>
          {disc && (
            <p className="text-xs" role="status">
              Blank {disc.kind} · {formatSize(disc.capacity)} available
            </p>
          )}
        </div>
      </fieldset>

      <div className="space-y-3 border-t border-border pt-5">
        <Button type="submit" size="lg" disabled={!canBurn} className="w-full">
          <DiscIcon aria-hidden="true" />
          {working === "burning" ? "Burning disc…" : "Burn and verify disc"}
        </Button>
        {working === "burning" && (
          <p
            role="status"
            className="text-xs leading-relaxed text-muted-foreground"
          >
            Staging files, writing the disc, and verifying the result. Keep the
            drive connected.
          </p>
        )}
        {notice && (
          <p
            role={notice.error ? "alert" : "status"}
            className={notice.error ? "text-sm text-destructive" : "text-sm"}
          >
            {notice.message}
          </p>
        )}
      </div>
    </form>
  )
}
