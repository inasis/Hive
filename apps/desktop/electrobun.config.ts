import type { ElectrobunConfig } from "electrobun";

const copy: Record<string, string> = {
  "../web/dist": "views/mainview",
  ".hutch/node_modules/@lydell": "bun/node_modules/@lydell",
};
if (process.platform === "linux") {
  copy[".hutch/gtk-settings-helper"] = "bun/bin/gtk-settings-helper";
}

export default {
  app: {
    name: "Hive",
    identifier: "dev.hive.codex-bridge",
    version: "0.1.0",
  },
  build: {
    mainProcess: "bun",
    bun: { entrypoint: "src/bun/index.ts" },
    copy,
  },
} satisfies ElectrobunConfig;
