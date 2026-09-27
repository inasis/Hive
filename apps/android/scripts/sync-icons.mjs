import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const iconRoot = resolve(appRoot, "assets/icons");
const resourceRoot = resolve(appRoot, "android/app/src/main/res");

for (const density of ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]) {
  const directory = resolve(resourceRoot, `mipmap-${density}`);
  await mkdir(directory, { recursive: true });
  const source = resolve(iconRoot, `hive-${density}.png`);
  await copyFile(source, resolve(directory, "ic_launcher.png"));
  await copyFile(source, resolve(directory, "ic_launcher_round.png"));
}

await mkdir(resolve(resourceRoot, "drawable"), { recursive: true });
await mkdir(resolve(resourceRoot, "drawable-v24"), { recursive: true });
await copyFile(resolve(iconRoot, "android/ic_launcher_background.xml"), resolve(resourceRoot, "drawable/ic_launcher_background.xml"));
await copyFile(resolve(iconRoot, "android/ic_launcher_foreground.xml"), resolve(resourceRoot, "drawable-v24/ic_launcher_foreground.xml"));
