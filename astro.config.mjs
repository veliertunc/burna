// @ts-check

import node from "@astrojs/node"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "astro/config"
import react from "@astrojs/react"
import { maxRequestBytes } from "./src/lib/burn.ts"

// https://astro.build/config
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone", bodySizeLimit: maxRequestBytes }),
  server: { host: "127.0.0.1" },
  security: {
    allowedDomains: [{ hostname: "127.0.0.1" }, { hostname: "localhost" }],
  },
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [react()],
})
