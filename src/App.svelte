<script lang="ts">
  import { invoke } from "@tauri-apps/api/core"
  import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
  import {
    availableMonitors,
    currentMonitor,
    LogicalSize,
    PhysicalPosition,
    type Monitor,
    type PhysicalSize
  } from "@tauri-apps/api/window"
  import { listen } from "@tauri-apps/api/event"
  import { pick } from "lodash-es"
  import { onMount } from "svelte"
  import "uplot/dist/uPlot.min.css"

  import { styleVars } from "./lib/actions"
  import { activeLocale } from "./lib/i18n"
  import {
    foregroundColor,
    backgroundColor,
    titleColor,
    accentColor,
    fontFamily
  } from "./lib/stores"
  import { saturatedPush } from "./lib/utils"
  import { startPolling } from "./lib/polling"
  import { normalizeData, collectionStatus } from "./lib/telemetry"
  import { t } from "./lib/i18n"
  import SummaryWidget from "./components/SummaryWidget.svelte"
  import CPUWidget from "./components/CPUWidget.svelte"
  import MemWidget from "./components/MemWidget.svelte"
  import DiskWidget from "./components/DiskWidget.svelte"
  import NetWidget from "./components/NetWidget.svelte"
  import Preferences from "./components/Preferences.svelte"

  const appWindow = getCurrentWebviewWindow()

  const windowPositionStorageKey = "toerings.window-position.v1"

  let preferencesVisible = false
  let preferencesOnLeft = false
  let resizeRequest = 0
  let currentMenuLocale = ""

  $: if ($activeLocale !== currentMenuLocale) {
    currentMenuLocale = $activeLocale
    invoke("set_menu_locale", { locale: $activeLocale }).catch(() => {
      // The web preview has no native menu to update.
    })
  }

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

  function clampWindowPosition(
    position: PhysicalPosition,
    size: PhysicalSize,
    monitors: Monitor[]
  ): PhysicalPosition | null {
    let closestPosition: PhysicalPosition | null = null
    let closestDistance = Number.POSITIVE_INFINITY

    for (const monitor of monitors) {
      const minX = monitor.position.x
      const minY = monitor.position.y
      const maxX = minX + Math.max(0, monitor.size.width - size.width)
      const maxY = minY + Math.max(0, monitor.size.height - size.height)
      const x = Math.min(Math.max(position.x, minX), maxX)
      const y = Math.min(Math.max(position.y, minY), maxY)
      const distance = (x - position.x) ** 2 + (y - position.y) ** 2

      if (distance < closestDistance) {
        closestDistance = distance
        closestPosition = new PhysicalPosition(x, y)
      }
    }

    return closestPosition
  }

  async function resizeWindow(showPreferences: boolean) {
    const request = ++resizeRequest

    try {
      const [position, previousSize] = await Promise.all([
        appWindow.outerPosition(),
        appWindow.outerSize()
      ])
      if (request !== resizeRequest) return

      await appWindow.setSize(new LogicalSize(showPreferences ? 650 : 325, 850))
      const size = await appWindow.outerSize()
      if (request !== resizeRequest) return

      if (!showPreferences) {
        if (preferencesOnLeft) {
          await appWindow.setPosition(
            new PhysicalPosition(position.x + previousSize.width - size.width, position.y)
          )
        }
        preferencesOnLeft = false
        return
      }

      const monitor = await currentMonitor()
      if (!monitor || !preferencesVisible || request !== resizeRequest) return

      const minX = monitor.position.x
      const monitorRight = minX + monitor.size.width
      preferencesOnLeft = position.x + size.width > monitorRight

      if (preferencesOnLeft) {
        const widthDifference = size.width - previousSize.width
        const expandedX = Math.max(minX, position.x - widthDifference)
        await appWindow.setPosition(new PhysicalPosition(expandedX, position.y))
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
          const [size, monitors] = await Promise.all([appWindow.outerSize(), availableMonitors()])
          const restoredPosition = clampWindowPosition(savedPosition, size, monitors)
          if (restoredPosition) await appWindow.setPosition(restoredPosition)
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
    if ((e.ctrlKey || e.metaKey) && e.key === ",") {
      e.preventDefault()
      preferencesVisible = true
      return
    }

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

  let cpuData: { perCoreUtil: Array<number>; cpuLoads: Array<number | null> } = {
    perCoreUtil: [],
    cpuLoads: Array(60).fill(0)
  }
  let processList: Array<Process> = []
  let tempData: Array<TempData> = []
  let memData: {
    ram: { usage: MemData; percentages: Array<number | null> }
    swap: { usage: MemData }
  } = {
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
  let ioData: Array<{ read: number | null; write: number | null }> = Array(60).fill({
    read: 0,
    write: 0
  })

  let networkData: { rx: Array<number | null>; tx: Array<number | null> } = {
    rx: Array(60).fill(0),
    tx: Array(60).fill(0)
  }

  let localIp: string | null = null
  let externalIp: string | null = null

  const externalIpRefreshMs = 10 * 60 * 1000

  onMount(() =>
    startPolling<string | null>({
      collect: () => invoke<string | null>("get_external_ip"),
      receive: detectedIp => {
        if (detectedIp !== null) externalIp = detectedIp
      },
      failed: () => {}, // Keep the last detected address when the lookup is unavailable.
      intervalMs: externalIpRefreshMs,
      maxBackoffMs: externalIpRefreshMs
    })
  )

  let status: "starting" | "stale" | "partial" | "ready" = "starting"
  let lastSequence = 0
  let memoryAvailable = false
  let swapAvailable = false

  onMount(() =>
    startPolling<Data>({
      collect: () => invoke<Data>("collect_data"),
      receive: data => {
        status = collectionStatus(data)
        if (status === "stale" || status === "starting" || data.sequence === lastSequence) return
        processData(data)
        lastSequence = data.sequence
      },
      failed: () => {
        status = "stale"
      }
    })
  )

  function processData(data: Data) {
    const sample = normalizeData(data)
    summaryData = pick(data, ["uptime", "hostname", "kernel_name", "kernel_version", "os_version"])
    processList = sample.processes
    cpuData.perCoreUtil = sample.cpu.map(cpu => cpu.cpu_usage)
    saturatedPush(cpuData.cpuLoads, sample.cpuLoad, graphXLimit)
    cpuData = cpuData
    tempData = sample.temperatures
    memData.ram.usage = sample.memory
    saturatedPush(memData.ram.percentages, sample.memoryPercent, graphXLimit)
    memData.swap.usage = sample.swap
    memoryAvailable = sample.memoryAvailable
    swapAvailable = sample.swapAvailable
    diskData = sample.disks
    saturatedPush(ioData, { read: sample.read, write: sample.write }, graphXLimit)
    ioData = ioData
    saturatedPush(networkData.rx, sample.rx, graphXLimit)
    saturatedPush(networkData.tx, sample.tx, graphXLimit)
    networkData = networkData
    localIp = data.local_ip
  }

  $: cssVars = {
    foregroundColor: $foregroundColor.toHslString(),
    backgroundColor: $backgroundColor.toHslString(),
    titleColor: $titleColor.toHslString(),
    accentColor: $accentColor.toHslString(),
    fontFamily: $fontFamily
  }
</script>

<svelte:window on:keydown={onKeydown} />

<div class:preferences-left={preferencesOnLeft} class="flex" use:styleVars={cssVars}>
  <main>
    <SummaryWidget {summaryData} onOpenPreferences={() => (preferencesVisible = true)} />
    {#if status !== "ready"}
      <p class="collection-status" role="status">{$t(`collection.${status}`)}</p>
    {/if}
    <CPUWidget {cpuData} {tempData} {processList} />
    <MemWidget {memData} {processList} {memoryAvailable} {swapAvailable} />
    <DiskWidget {diskData} {ioData} {processList} />
    <NetWidget {networkData} {localIp} {externalIp} hostname={summaryData.hostname} />
  </main>

  {#if preferencesVisible}
    <Preferences bind:preferencesVisible />
  {/if}
</div>

<style>
  .collection-status {
    margin: 0 10px 8px;
    color: var(--accentColor);
  }
  .flex {
    width: 100%;
    height: 100%;
    overflow: hidden;
    background-color: var(--backgroundColor);
    display: flex;
  }

  .preferences-left {
    flex-direction: row-reverse;
  }

  main {
    width: 325px;
    height: 850px;
    flex: 0 0 325px;
    padding: 10px;
    max-height: 850px;
    overflow: hidden;
    font-family: var(--fontFamily);
    color: var(--foregroundColor);
  }
</style>
