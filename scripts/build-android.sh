#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="$ROOT_DIR/apps/desktop"
ANDROID_DIR="$ROOT_DIR/apps/android"
APK_PATH="$ANDROID_DIR/android/app/build/outputs/apk/debug/app-debug.apk"
STAGED_APK="$ROOT_DIR/artifacts/android/Hive-android-debug.apk"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  printf 'Node.js 20+ and npm are required to build the Android app.\n' >&2
  exit 1
fi
if ! command -v java >/dev/null 2>&1; then
  printf 'Java 17+ and an Android SDK are required to build the Android app.\n' >&2
  exit 1
fi

npm ci --prefix "$DESKTOP_DIR"
npm ci --prefix "$ANDROID_DIR"
npm run build --prefix "$ANDROID_DIR"

if [[ ! -f "$APK_PATH" ]]; then
  printf 'Android build completed without producing %s\n' "$APK_PATH" >&2
  exit 1
fi
mkdir -p "$(dirname -- "$STAGED_APK")"
cp "$APK_PATH" "$STAGED_APK"
printf 'APK: %s\n' "$STAGED_APK"
