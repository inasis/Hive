#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="$ROOT_DIR/apps/android"
APK_PATH="$ANDROID_DIR/android/app/build/outputs/apk/debug/app-debug.apk"
STAGED_APK="$ROOT_DIR/artifacts/android/Hive-android-debug.apk"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  printf 'Node.js 20+ and npm are required to build the Android app.\n' >&2
  exit 1
fi
java_is_21_home() {
  local candidate="$1"
  [[ -x "$candidate/bin/java" && -x "$candidate/bin/javac" ]] || return 1
  "$candidate/bin/javac" -version 2>&1 | grep -Eq '^javac 21([.]|$)'
}

find_java_21_home() {
  local candidate
  for candidate in \
    "${JAVA_HOME_21:-}" \
    "${JAVA_HOME_21_X64:-}" \
    "${JAVA_HOME_21_AARCH64:-}" \
    "${JAVA_HOME:-}"; do
    if [[ -n "$candidate" ]] && java_is_21_home "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  if [[ -x /usr/libexec/java_home ]]; then
    candidate="$(/usr/libexec/java_home -v 21 2>/dev/null || true)"
    if [[ -n "$candidate" ]] && java_is_21_home "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  fi

  for candidate in \
    /usr/lib/jvm/*21* \
    /opt/java/openjdk-21* \
    /opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
    /usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
    "${HOME:-}"/.sdkman/candidates/java/21*; do
    if java_is_21_home "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

JAVA_21_HOME="$(find_java_21_home || true)"
if [[ -z "$JAVA_21_HOME" ]]; then
  printf 'A Java 21 JDK and an Android SDK are required to build the Android app. Set JAVA_HOME to a Java 21 JDK.\n' >&2
  exit 1
fi
export JAVA_HOME="$JAVA_21_HOME"
export PATH="$JAVA_HOME/bin:$PATH"
printf 'Using Java 21 for Android Gradle: %s\n' "$JAVA_HOME"

cd "$ROOT_DIR"
npm run build --workspace=hive-android

if [[ ! -f "$APK_PATH" ]]; then
  printf 'Android build completed without producing %s\n' "$APK_PATH" >&2
  exit 1
fi
mkdir -p "$(dirname -- "$STAGED_APK")"
cp "$APK_PATH" "$STAGED_APK"
printf 'APK: %s\n' "$STAGED_APK"
