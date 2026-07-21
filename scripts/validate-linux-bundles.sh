#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "Usage: $0 <deb> <rpm> <AppImage>" >&2
  exit 2
fi

deb_path=$(realpath "$1")
rpm_path=$(realpath "$2")
appimage_path=$(realpath "$3")

for bundle_path in "$deb_path" "$rpm_path" "$appimage_path"; do
  if [[ ! -f "$bundle_path" ]]; then
    echo "Bundle not found: $bundle_path" >&2
    exit 2
  fi
done

runner_temp=${RUNNER_TEMP:?RUNNER_TEMP must point to the CI temporary directory}
rpm_database=$(mktemp -d "$runner_temp/toerings-rpmdb.XXXXXX")
deb_check=$(mktemp -d "$runner_temp/toerings-deb.XXXXXX")
appimage_check=$(mktemp -d "$runner_temp/toerings-appimage.XXXXXX")
trap 'rm -rf "$rpm_database" "$deb_check" "$appimage_check"' EXIT

deb_description=$(dpkg-deb -f "$deb_path" Description)
test -n "$deb_description" && test "$deb_description" != "(none)"
test -n "$(rpm --dbpath "$rpm_database" -qp --qf '%{SUMMARY}' "$rpm_path")"

dpkg-deb -x "$deb_path" "$deb_check"
desktop_file="$deb_check/usr/share/applications/ToeRings.desktop"
test "$(sed -n 's/^Icon=//p' "$desktop_file")" = "ToeRings"
test -f "$deb_check/usr/share/icons/hicolor/256x256/apps/ToeRings.png"

(
  cd "$appimage_check"
  "$appimage_path" --appimage-extract >/dev/null
  test ! -e squashfs-root/usr/lib/libwayland-client.so.0
  test ! -e squashfs-root/usr/lib/libglib-2.0.so.0
  test -f squashfs-root/usr/lib/libsystemd.so.0
  app_run=squashfs-root/AppRun
  bash -n "$app_run"
  grep -F 'for candidate in /usr/sbin/ldconfig /sbin/ldconfig; do' "$app_run"
  grep -F 'host_systemd=$("$ldconfig_command" -p 2>/dev/null' "$app_run"
  grep -F 'export LD_PRELOAD="$host_systemd${LD_PRELOAD:+:$LD_PRELOAD}"' "$app_run"
  gtk_hook=squashfs-root/apprun-hooks/linuxdeploy-plugin-gtk.sh
  grep -Fx 'export WEBKIT_DISABLE_COMPOSITING_MODE=1' "$gtk_hook"
  ! grep -F 'export GDK_BACKEND=x11' "$gtk_hook"
)

bundle_dir=$(dirname "$(dirname "$rpm_path")")
docker run --rm --volume "$bundle_dir:/packages:ro" ubuntu:22.04 bash -c '
  set -euo pipefail
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y /packages/deb/*.deb
  DEBIAN_FRONTEND=noninteractive apt-get install -y xvfb
  set +e
  timeout 10s xvfb-run -a /usr/bin/ToeRings >/tmp/deb-smoke.log 2>&1
  deb_status=$?
  set -e
  cat /tmp/deb-smoke.log
  test "$deb_status" -eq 124
'

set +e
timeout 10s env APPIMAGE_EXTRACT_AND_RUN=1 xvfb-run -a "$appimage_path" \
  >"$runner_temp/appimage-smoke.log" 2>&1
appimage_status=$?
set -e

cat "$runner_temp/appimage-smoke.log"
test "$appimage_status" -eq 124
! grep -F "Could not create default EGL display" "$runner_temp/appimage-smoke.log"

docker run --rm --volume "$bundle_dir:/packages:ro" fedora:latest \
  bash -c 'dnf install -y /packages/rpm/*.rpm && rpm -q toe-rings'
