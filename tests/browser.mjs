// Manual browser fixture: npm run dev, then /tests/browser.html?cpus=128&height=600.
// It uses the real frontend with Tauri's mock transport; no public IP request is sent.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks"
import { unmount } from "svelte"

const query = new URLSearchParams(location.search)
const height = Number(query.get("height") || 850)
const cpuCount = Number(query.get("cpus") || 8)
const monitor = {
  name: "fixture",
  scaleFactor: 1,
  position: { x: 0, y: 0 },
  size: { width: 1920, height },
  workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height } }
}
let position = { x: 30, y: 0 }
let size = { width: 325, height }
let sequence = 0
let mode = query.get("mode") || "ready"
let requests = 0
const missing = {
  cpu: null,
  memory: null,
  swap: null,
  network: null,
  list_of_processes: null,
  temperature_sensors: null,
  disks: null
}
const full = {
  cpu: Array.from({ length: cpuCount }, (_, index) => ({ cpu_usage: 20 + (index % 80) })),
  memory: { mem_total_in_kib: 8 * 1024 ** 2, mem_used_in_kib: 4 * 1024 ** 2, use_percent: 50 },
  swap: { mem_total_in_kib: 0, mem_used_in_kib: 0, use_percent: null },
  network: { rx: 1024 ** 2, tx: 512 * 1024, total_rx: 0, total_tx: 0 },
  list_of_processes: [],
  temperature_sensors: [{ name: "fixture", temperature: 42 }],
  disks: [
    {
      name: "<img src=x onerror=alert(1)>",
      mount_point: "/mounted/<script>",
      free_space: 50,
      used_space: 50,
      total_space: 100
    }
  ]
}
mockWindows("main")
mockIPC(
  (cmd, args) => {
    if (cmd === "collect_data") {
      requests++
      if (mode === "rejected") throw new Error("simulated IPC outage")
      return {
        ...(mode === "missing" ? missing : full),
        sequence: ++sequence,
        failed: false,
        age_ms: mode === "stale" ? 6000 : 0,
        uptime: "1h",
        hostname: "regression-fixture",
        kernel_name: "fixture",
        kernel_version: "1",
        os_version: "fixture",
        local_ip: "192.0.2.1"
      }
    }
    if (cmd === "get_external_ip") return "203.0.113.1"
    if (cmd === "plugin:window|outer_position") return position
    if (cmd === "plugin:window|outer_size") return size
    if (cmd === "plugin:window|current_monitor") return monitor
    if (cmd === "plugin:window|available_monitors") return [monitor]
    if (cmd === "plugin:window|set_position") position = args.position.data
    if (cmd === "plugin:window|set_size") {
      size = args.size.data
      document.getElementById("app").style.width = `${size.width}px`
      document.getElementById("app").style.height = `${size.height}px`
    }
  },
  { shouldMockEvents: true }
)
import("../src/main.ts").then(({ default: app }) => {
  // Deliberately isolated in a fixture page, outside the production entry point.
  window.fixture = {
    setMode(value) {
      mode = value
    },
    requests: () => requests,
    geometry: () => ({ position, size }),
    stop: () => unmount(app)
  }
})
