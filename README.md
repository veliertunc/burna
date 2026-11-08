# Burna

Burna is a local web app for writing disc images and selected files to CDs and DVDs. macOS handles writing, verifying, and ejecting the disc.

## Run locally

Use a Mac with a CD/DVD writer, a blank writable disc, and the Node.js version in `package.json`.

```sh
pnpm install
pnpm dev
```

Open the loopback URL printed by Astro, usually `http://127.0.0.1:4321`. Choose **Burn image** or **Burn files**, select the source, and use **Check drive** before starting the burn.

For a local production build, run `pnpm build` followed by `pnpm start`. The production server defaults to `http://127.0.0.1:4321`.

## Supported formats

| Format | Select | Media and requirements |
| --- | --- | --- |
| ISO | One `.iso` | CD or DVD. Sector-aligned ISO 9660 or UDF. |
| CDR | One `.cdr` | CD or DVD. A raw CD/DVD master with 2,048-byte sectors. |
| DMG | One `.dmg` | CD or DVD. An unencrypted, single-file UDIF image. Burna converts it to a CD/DVD master. |
| BIN/CUE | One `.cue` and all referenced `.bin` files, plus the `.cdt` file if referenced | CD. The CUE must describe one session and use local filenames and binary tracks. macOS reads the track layout. |
| CloneCD | A matching `.ccd`, `.img`, and `.sub` | CD. Single-session, unscrambled images. Burna writes a track copy after you confirm that it can omit raw subchannel data and embedded CD-Text. |
| CHD | One self-contained `.chd` | Use the matching blank CD or DVD. Install [chdman](https://docs.mamedev.org/tools/chdman.html) with `brew install rom-tools` and make it available on `PATH`. CD extraction uses single-session BIN/CUE and may omit raw subchannel data. |

**Burn files** creates a data CD or DVD with the selected files at the disc root.

Use one connected writer at a time. Burna checks for blank writable media and stages files on the Mac. Conversion and data-disc jobs need temporary disk space for the source files and the prepared image. The burn API accepts loopback requests on the Mac connected to the writer.
