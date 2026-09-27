import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "dev.hive.codexbridge",
  appName: "Hive",
  webDir: "../desktop/dist",
  server: {
    androidScheme: "https",
  },
};

export default config;
