import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { electrobunViteAliases } from "./.hutch/devkit/api/config/electrobun-vite";

const desktopRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: electrobunViteAliases(join(desktopRoot, ".hutch/devkit")),
  },
  build: { outDir: "dist", emptyOutDir: true },
  server: { host: "127.0.0.1", port: 4173, strictPort: true },
});
