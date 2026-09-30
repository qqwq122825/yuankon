#!/usr/bin/env bash
# Compile and execute the Android-free consent gate with the existing local Kotlin/JDK toolchain.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
JAVA="${JAVA_HOME:-$ROOT/.local-tools/jdk/Contents/Home}/bin/java"
CACHE="${GRADLE_USER_HOME:-$ROOT/.local-tools/gradle-home}/caches/modules-2/files-2.1"
jar() {
  local file
  file="$(find "$CACHE/$1" -name "$2" -type f -print -quit)"
  [[ -n "$file" ]] || { echo "Missing cached Kotlin dependency: $1/$2" >&2; exit 1; }
  printf '%s' "$file"
}
COMPILER="$(jar org.jetbrains.kotlin/kotlin-compiler-embeddable/1.9.22 'kotlin-compiler-embeddable-*.jar')"
STDLIB="$(jar org.jetbrains.kotlin/kotlin-stdlib/1.9.22 'kotlin-stdlib-*.jar')"
SCRIPT="$(jar org.jetbrains.kotlin/kotlin-script-runtime/1.9.22 'kotlin-script-runtime-*.jar')"
REFLECT="$(jar org.jetbrains.kotlin/kotlin-reflect/1.6.10 'kotlin-reflect-*.jar')"
TROVE="$(jar org.jetbrains.intellij.deps/trove4j 'trove4j-*.jar')"
ANNOTATIONS="$(jar org.jetbrains/annotations/13.0 'annotations-*.jar')"
mkdir -p "$ROOT/dist"
WORK="$(mktemp -d "$ROOT/dist/consent-test-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
SOURCE="$ROOT/apk-templates/b-packages/screenagent-1.7.4/app/src"
"$JAVA" -cp "$COMPILER:$STDLIB:$SCRIPT:$REFLECT:$TROVE:$ANNOTATIONS" \
  org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect -jvm-target 17 \
  -classpath "$STDLIB:$ANNOTATIONS" -d "$WORK/classes" \
  "$SOURCE/main/java/com/zaka/screenagent/ProjectionConsentGate.kt" \
  "$SOURCE/test/java/com/zaka/screenagent/ProjectionConsentGateTest.kt"
"$JAVA" -cp "$WORK/classes:$STDLIB" com.zaka.screenagent.ProjectionConsentGateTestKt
