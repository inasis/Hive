import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { electrobunViteAliases } from "../desktop/.hutch/devkit/api/config/electrobun-vite";

const webRoot = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(webRoot, "../desktop");
const resolveFromWeb = createRequire(import.meta.url);

export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: [
      ...electrobunViteAliases(join(desktopRoot, ".hutch/devkit")),
      { find: "mermaid", replacement: resolveFromWeb.resolve("mermaid") },
    ],
  },
  build: { outDir: "dist", emptyOutDir: true },
  server: { host: "127.0.0.1", port: 4173, strictPort: true },
});
