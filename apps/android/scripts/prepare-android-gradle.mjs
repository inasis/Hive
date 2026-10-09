import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const androidRoot = resolve(fileURLToPath(new URL("../android", import.meta.url)));
const gradleFiles = [
  resolve(androidRoot, "app/build.gradle"),
  resolve(androidRoot, "capacitor-cordova-android-plugins/build.gradle"),
];
const flatDirectoryPattern = /^([\t ]*)flatDir\s*\{\r?\n[\t ]*dirs\b([^\r\n]*)\r?\n\1\}\r?\n?/gm;

for (const gradleFile of gradleFiles) {
  let contents = await readFile(gradleFile, "utf8");
  const matches = [...contents.matchAll(flatDirectoryPattern)];
  if (matches.length === 0) {
    if (/\bflatDir\b/.test(contents)) {
      throw new Error(`Unrecognized flatDir repository declaration in ${gradleFile}`);
    }
    continue;
  }

  for (const match of matches) {
    const configuredDirectories = [...match[2].matchAll(/['"]([^'"]+)['"]/g)];
    if (configuredDirectories.length === 0) {
      throw new Error(`Could not read flatDir paths in ${gradleFile}`);
    }
    for (const [, relativeDirectory] of configuredDirectories) {
      const localArtifacts = await findLocalArtifacts(resolve(dirname(gradleFile), relativeDirectory));
      if (localArtifacts.length > 0) {
        throw new Error(
          `Cannot remove flatDir from ${gradleFile}; local JAR/AAR artifacts still need review: ${localArtifacts.join(", ")}`,
        );
      }
    }
  }

  contents = contents.replace(flatDirectoryPattern, "");
  contents = contents.replace(/^[\t ]*repositories[\t ]*\{\r?\n(?:[\t ]*\r?\n)*[\t ]*\}\r?\n?/gm, "");
  await writeFile(gradleFile, contents, "utf8");
  console.log(`Removed unused flatDir repository declaration from ${gradleFile}`);
}

async function findLocalArtifacts(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }

  const artifacts = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) artifacts.push(...await findLocalArtifacts(path));
    else if (entry.isFile() && /\.(?:aar|jar)$/i.test(entry.name)) artifacts.push(path);
  }
  return artifacts;
}
