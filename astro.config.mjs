// @ts-check

import node from "@astrojs/node"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "astro/config"
import react from "@astrojs/react"
import { maxRequestBytes } from "./src/lib/burn.ts"

const desktop = process.env.BURNA_DESKTOP_BUILD === "1"

// https://astro.build/config
export default defineConfig({
  output: "server",
  ...(desktop && {
    outDir: "./src-tauri/.desktop/runtime",
    image: { service: { entrypoint: "astro/assets/services/noop" } },
  }),
  adapter: node({ mode: "standalone", bodySizeLimit: maxRequestBytes }),
  server: { host: "127.0.0.1" },
  security: {
    allowedDomains: [{ hostname: "127.0.0.1" }, { hostname: "localhost" }],
  },
  vite: {
    plugins: [tailwindcss()],
    ...(desktop && { ssr: { noExternal: true } }),
  },
  integrations: [react()],
})
