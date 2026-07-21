#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <AppImage>" >&2
  exit 2
fi

appimage_path=$(realpath "$1")
if [[ ! -f "$appimage_path" ]]; then
  echo "AppImage not found: $appimage_path" >&2
  exit 2
fi

for command in dd mksquashfs realpath sed; do
  if ! command -v "$command" >/dev/null; then
    echo "Required command not found: $command" >&2
    exit 2
  fi
done

work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' EXIT

runtime_path="$work_dir/runtime"
filesystem_path="$work_dir/filesystem.squashfs"
output_path="$work_dir/repacked.AppImage"

runtime_size=$("$appimage_path" --appimage-offset)
dd if="$appimage_path" of="$runtime_path" bs=1 count="$runtime_size" status=none

(
  cd "$work_dir"
  "$appimage_path" --appimage-extract >/dev/null
)

library_dir="$work_dir/squashfs-root/usr/lib"
app_run="$work_dir/squashfs-root/AppRun"
gtk_hook="$work_dir/squashfs-root/apprun-hooks/linuxdeploy-plugin-gtk.sh"
excluded_libraries=(
  "libblkid.so.1"
  "libelf.so.1"
  "libffi.so.8"
  "libgio-2.0.so"
  "libgio-2.0.so.0"
  "libglib-2.0.so.0"
  "libgmodule-2.0.so.0"
  "libgobject-2.0.so"
  "libgobject-2.0.so.0"
  "libmount.so.1"
  "libpcre2-8.so.0"
  "libselinux.so.1"
  "libwayland-client.so.0"
  "libwayland-cursor.so.0"
  "libwayland-egl.so.1"
  "libwayland-server.so.0"
  "libzstd.so.1"
)

for library in "${excluded_libraries[@]}"; do
  find "$library_dir" -maxdepth 1 \( -name "$library" -o -name "$library.*" \) -delete
done

if [[ ! -f "$app_run" ]]; then
  echo "AppRun launcher not found: $app_run" >&2
  exit 2
fi

if [[ ! -f "$gtk_hook" ]]; then
  echo "GTK AppRun hook not found: $gtk_hook" >&2
  exit 2
fi

# Prefer a host libsystemd when one is installed. The bundled copy remains a
# fallback for distributions without libsystemd, but may require a newer glibc
# than an older host provides when it comes from the AppImage build system.
sed -i '/^source "\$this_dir"\/apprun-hooks\/"linuxdeploy-plugin-gtk.sh"$/i\
ldconfig_command=""\
for candidate in /usr/sbin/ldconfig /sbin/ldconfig; do\
  if [[ -x "$candidate" ]]; then\
    ldconfig_command="$candidate"\
    break\
  fi\
done\
if [[ -z "$ldconfig_command" ]] && command -v ldconfig >\/dev\/null; then\
  ldconfig_command=$(command -v ldconfig)\
fi\
if [[ -n "$ldconfig_command" ]]; then\
  host_systemd=$("$ldconfig_command" -p 2>\/dev\/null | awk '\''$1 == "libsystemd.so.0" && $2 ~ /x86-64/ { print $NF; exit }'\'')\
  if [[ -n "$host_systemd" && -f "$host_systemd" ]]; then\
    export LD_PRELOAD="$host_systemd${LD_PRELOAD:+:$LD_PRELOAD}"\
  fi\
fi\
' "$app_run"

# linuxdeploy forces every AppImage through X11. On Wayland this sends the
# native menu and the WebView through XWayland, where menu activation can leave
# the WebView without pointer or keyboard focus. Keep the native backend and
# avoid the WebKit EGL failure by disabling compositing instead.
sed -i '/^export GDK_BACKEND=x11 /d' "$gtk_hook"
printf '%s\n' 'export WEBKIT_DISABLE_COMPOSITING_MODE=1' >> "$gtk_hook"

mksquashfs "$work_dir/squashfs-root" "$filesystem_path" \
  -comp zstd \
  -b 131072 \
  -noappend \
  -all-root \
  -no-xattrs \
  -mkfs-time 0 \
  -quiet

cp "$runtime_path" "$output_path"
dd if="$filesystem_path" of="$output_path" bs=1M oflag=append conv=notrunc status=none
chmod +x "$output_path"
mv "$output_path" "$appimage_path"
