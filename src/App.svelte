<script lang="ts">
  import { invoke } from "@tauri-apps/api/tauri"
  import { appWindow, currentMonitor, LogicalSize, PhysicalPosition } from "@tauri-apps/api/window"
  import { listen } from "@tauri-apps/api/event"
  import { sum, pick } from "lodash-es"
  import { onMount } from "svelte"
  import "uplot/dist/uPlot.min.css"

  import { styleVars } from "./lib/actions"
  import {
    foregroundColor,
    backgroundColor,
    titleColor,
    accentColor,
    fontFamily
  } from "./lib/stores"
  import { sleep, saturatedPush } from "./lib/utils"
  import SummaryWidget from "./components/SummaryWidget.svelte"
  import CPUWidget from "./components/CPUWidget.svelte"
  import MemWidget from "./components/MemWidget.svelte"
  import DiskWidget from "./components/DiskWidget.svelte"
  import NetWidget from "./components/NetWidget.svelte"
  import Preferences from "./components/Preferences.svelte"

  const windowPositionStorageKey = "toerings.window-position.v1"

  let preferencesVisible = false

  function loadWindowPosition(): PhysicalPosition | null {
    try {
      const stored = localStorage.getItem(windowPositionStorageKey)
      if (!stored) return null

      const position = JSON.parse(stored)
      if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return null

      return new PhysicalPosition(position.x, position.y)
    } catch {
      return null
    }
  }

  function saveWindowPosition(position: PhysicalPosition) {
    try {
      localStorage.setItem(
        windowPositionStorageKey,
        JSON.stringify({ x: position.x, y: position.y })
      )
    } catch {
      // Keep the window usable when storage is unavailable.
    }
  }

  async function resizeWindow(showPreferences: boolean) {
    try {
      await appWindow.setSize(new LogicalSize(showPreferences ? 650 : 325, 850))
      if (!showPreferences || !preferencesVisible) return

      const [monitor, position, size] = await Promise.all([
        currentMonitor(),
        appWindow.outerPosition(),
        appWindow.outerSize()
      ])
      if (!monitor || !preferencesVisible) return

      const minX = monitor.position.x
      const maxX = minX + monitor.size.width - size.width
      const visibleX = Math.min(Math.max(position.x, minX), Math.max(minX, maxX))

      if (visibleX !== position.x) {
        await appWindow.setPosition(new PhysicalPosition(visibleX, position.y))
      }
    } catch {
      // Keep the current window geometry if monitor information is unavailable.
    }
  }

  onMount(() => {
    let disposed = false
    const unlisteners: Array<() => void> = []

    async function setupWindow() {
      const savedPosition = loadWindowPosition()
      if (savedPosition) {
        try {
          await appWindow.setPosition(savedPosition)
        } catch {
          // Fall back to the configured position if restoring fails.
        }
      }

      const listeners = await Promise.all([
        listen("openPreferences", () => {
          preferencesVisible = true
        }),
        appWindow.onMoved(({ payload }) => {
          saveWindowPosition(payload)
        })
      ])

      if (disposed) {
        listeners.forEach(unlisten => unlisten())
      } else {
        unlisteners.push(...listeners)
      }
    }

    setupWindow()

    return () => {
      disposed = true
      unlisteners.forEach(unlisten => unlisten())
    }
  })

  $: resizeWindow(preferencesVisible)

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      preferencesVisible = false
    }
  }

  const graphXLimit = 60

  let summaryData: SummaryData = {
    uptime: "0s",
    hostname: null,
    kernel_name: null,
    kernel_version: null,
    os_version: null
  }

  let cpuData = {
    perCoreUtil: [],
    cpuLoads: Array(60).fill(0)
  }
  let processList: Array<Process> = []
  let tempData: Array<TempData> = []
  let memData = {
    ram: {
      usage: {
        mem_total_in_kib: 0,
        mem_used_in_kib: 0,
        use_percent: null
      },
      percentages: Array(60).fill(0)
    },
    swap: {
      usage: {
        mem_total_in_kib: 0,
        mem_used_in_kib: 0,
        use_percent: null
      }
    }
  }

  let diskData: Array<DiskData> = []
  let ioData = Array(60).fill({ read: 0, write: 0 })

  let networkData = {
    rx: Array(60).fill(0),
    tx: Array(60).fill(0)
  }

  let localIp = ""

  let lastDataCollection = 0

  async function collectData() {
    lastDataCollection = Date.now()
    const data: Data = await invoke("collect_data")
    processData(data)
    const sleepMs = Math.max(lastDataCollection + 1000 - Date.now(), 0)
    await sleep(sleepMs)
    collectData()
  }

  function processData(data: Data) {
    summaryData = pick(data, ["uptime", "hostname", "kernel_name", "kernel_version", "os_version"])
    processList = data.list_of_processes

    cpuData.perCoreUtil = data.cpu.map(cpu => cpu.cpu_usage)
    saturatedPush(cpuData.cpuLoads, sum(cpuData.perCoreUtil) / 100, graphXLimit)
    cpuData = cpuData

    tempData = data.temperature_sensors

    memData.ram.usage = data.memory
    saturatedPush(memData.ram.percentages, data.memory.use_percent, graphXLimit)
    memData.swap.usage = data.swap

    diskData = data.disks

    const ioDataPoint = {
      read: sum(data.list_of_processes.map(process => process.read_bytes_per_sec)),
      write: sum(data.list_of_processes.map(process => process.write_bytes_per_sec))
    }
    saturatedPush(ioData, ioDataPoint, graphXLimit)
    ioData = ioData

    saturatedPush(networkData.rx, data.network.rx, graphXLimit)
    saturatedPush(networkData.tx, data.network.tx, graphXLimit)
    networkData = networkData

    localIp = data.local_ip
  }

  collectData()

  $: cssVars = {
    foregroundColor: $foregroundColor.toHslString(),
    backgroundColor: $backgroundColor.toHslString(),
    titleColor: $titleColor.toHslString(),
    accentColor: $accentColor.toHslString(),
    fontFamily: $fontFamily
  }
</script>

<svelte:window on:keydown={onKeydown} />

<div class="flex" use:styleVars={cssVars}>
  <main>
    <SummaryWidget {summaryData} />
    <CPUWidget {cpuData} {tempData} {processList} />
    <MemWidget {memData} {processList} />
    <DiskWidget {diskData} {ioData} {processList} />
    <NetWidget {networkData} {localIp} hostname={summaryData.hostname} />
  </main>

  {#if preferencesVisible}
    <Preferences bind:preferencesVisible />
  {/if}
</div>

<style>
  .flex {
    background-color: var(--backgroundColor);
    display: flex;
  }

  main {
    width: 325px;
    padding: 10px;
    max-height: 850px;
    overflow-y: hidden;
    font-family: var(--fontFamily);
    color: var(--foregroundColor);
  }
</style>
