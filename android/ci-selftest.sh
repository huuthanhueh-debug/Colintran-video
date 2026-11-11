#!/usr/bin/env bash
# Runs on an Android emulator in CI: install the APK, start it in self-test mode (renders a
# short video inside the WebView and saves it through the Java bridge), then read the verdict
# from logcat. Exit 0 only when a real video file was written on the device.
set -u
# Paths are relative to the app folder, wherever the script is called from.
DIST="$(cd "$(dirname "$0")/.." && pwd)/dist"
APK="$DIST/promptgate-video.apk"
PKG=com.promptgate.video
adb install -r "$APK" || exit 1
adb logcat -c
adb shell am start -W -n "$PKG/.MainActivity" --ez selftest true || exit 1
verdict=""
for _ in $(seq 1 60); do
  verdict=$(adb logcat -d -s PGV:I | grep -o 'PGV_SELFTEST.*' | tail -1)
  [ -n "$verdict" ] && break
  sleep 3
done
adb exec-out screencap -p > "$DIST/emulator.png"
adb logcat -d > "$DIST/logcat.txt"
echo "verdict: ${verdict:-none (timed out)}"
case "$verdict" in "PGV_SELFTEST ok"*) ;; *) exit 1 ;; esac
saved=$(adb shell ls -l /sdcard/Movies/PromptGateVideo/ 2>&1)
echo "$saved"
echo "$saved" | grep -q 'pgv-selftest' || { echo "exported file not found on the device"; exit 1; }
echo "device self-test passed"
