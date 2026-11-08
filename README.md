# Burna

Burna is a local web app for writing an existing ISO image to a CD or DVD or creating a data disc from selected files. macOS handles writing, verifying and ejecting the disc.

## Run locally

Use a Mac with a CD/DVD writer, a blank writable disc and the Node.js version in `package.json`.

```sh
pnpm install
pnpm dev
```

Open the loopback URL printed by Astro, usually `http://127.0.0.1:4321`. Choose **Burn ISO** or **Burn files**, select the source, and use **Check drive** before starting the burn.

For a local production build, run `pnpm build` followed by `pnpm start`. The production server uses port 4321 by default and listens on `127.0.0.1`.

## Supported workflows

- **Burn ISO** writes a sector-aligned ISO 9660 or UDF optical image as a disc image.
- **Burn files** creates a data CD or DVD with the selected files at the disc root.
- Use one connected writer at a time. The app checks for blank CD or DVD media and compares the image size against the disc's reported writable space.
- Files are staged on the Mac and removed after the job finishes. A data disc job needs temporary space for both the source files and the generated image.
- Run the server on the Mac physically connected to the writer. The burn API accepts loopback requests from the local app.
