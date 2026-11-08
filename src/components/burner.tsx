import { useState, type SubmitEvent } from "react"
import {
  DiscIcon,
  FileArrowUpIcon,
  FolderOpenIcon,
} from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import { maxDiscBytes, maxFiles, type BurnMode } from "@/lib/burn"

const modes = [
  { id: "iso", label: "Burn ISO", icon: DiscIcon },
  { id: "data", label: "Burn files", icon: FolderOpenIcon },
] as const

const headers = { "X-Burna-Request": "1" }

function formatSize(bytes: number) {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`
  return `${bytes} B`
}

export function Burner() {
  const [mode, setMode] = useState<BurnMode>("iso")
  const [files, setFiles] = useState<File[]>([])
  const [disc, setDisc] = useState<{ kind: string; capacity: number }>()
  const [working, setWorking] = useState<"checking" | "burning">()
  const [notice, setNotice] = useState<{ message: string; error: boolean }>()

  const size = files.reduce((total, file) => total + file.size, 0)
  const invalidImage =
    mode === "iso" &&
    files.some((file) => !/\.iso$/i.test(file.name) || !file.size)
  const tooLarge = size > Math.min(maxDiscBytes, disc?.capacity ?? maxDiscBytes)

  async function checkDrive() {
    setWorking("checking")
    setNotice(undefined)
    setDisc(undefined)
    try {
      const response = await fetch("/api/burn", { headers })
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
    if (
      working ||
      !disc ||
      !files.length ||
      tooLarge ||
      invalidImage ||
      files.length > maxFiles
    )
      return

    setWorking("burning")
    setNotice(undefined)
    const body = new FormData()
    for (const file of files)
      body.append("files", file, encodeURIComponent(file.name))
    try {
      const response = await fetch(`/api/burn?mode=${mode}`, {
        method: "POST",
        headers,
        body,
      })
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
            {mode === "iso" ? "ISO image" : "Data files"}
          </span>
          <span className="block text-xs leading-relaxed text-muted-foreground">
            {mode === "iso"
              ? "Write an existing ISO image to a CD or DVD."
              : "Create a data CD or DVD from the files you select."}
          </span>
          <input
            key={mode}
            type="file"
            accept={mode === "iso" ? ".iso" : undefined}
            multiple={mode === "data"}
            onChange={(event) =>
              setFiles(Array.from(event.currentTarget.files ?? []))
            }
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
            Choose a non-empty .iso image.
          </p>
        )}
        {tooLarge && (
          <p role="alert" className="text-sm text-destructive">
            The selection exceeds the available disc size.
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
        <Button
          type="submit"
          size="lg"
          disabled={
            !!working ||
            !disc ||
            !files.length ||
            invalidImage ||
            tooLarge ||
            files.length > maxFiles
          }
          className="w-full"
        >
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
