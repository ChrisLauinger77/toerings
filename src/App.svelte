<script lang="ts">
  import { invoke } from "@tauri-apps/api/core"
  import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
  import {
    availableMonitors,
    currentMonitor,
    LogicalSize,
    PhysicalPosition
  } from "@tauri-apps/api/window"
  import { listen } from "@tauri-apps/api/event"
  import { pick } from "lodash-es"
  import { onMount } from "svelte"
  import "uplot/dist/uPlot.min.css"

  import { createWindowGeometry, type Position } from "./lib/windowGeometry"
  import { styleVars } from "./lib/actions"
  import { activeLocale } from "./lib/i18n"
  import { createMenuLocaleSync } from "./lib/menuLocale"
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
  let geometry: ReturnType<typeof createWindowGeometry> | undefined

  onMount(() => {
    const menuLocale = createMenuLocaleSync(locale => invoke<void>("set_menu_locale", { locale }))
    const unsubscribe = activeLocale.subscribe(menuLocale.request)
    return () => {
      unsubscribe()
      menuLocale.dispose()
    }
  })

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

  function saveWindowPosition(position: Position) {
    try {
      localStorage.setItem(
        windowPositionStorageKey,
        JSON.stringify({ x: position.x, y: position.y })
      )
    } catch {
      // Keep the window usable when storage is unavailable.
    }
  }

  onMount(() => {
    let disposed = false
    let monitorTimer: ReturnType<typeof setTimeout> | undefined
    const unlisteners: Array<() => void> = []

    function releaseListener(unlisten: () => void) {
      try {
        Promise.resolve(unlisten()).catch(() => {})
      } catch {
        // Continue releasing peers if a native listener has already disappeared.
      }
    }

    geometry = createWindowGeometry({
      position: () => appWindow.outerPosition(),
      size: () => appWindow.outerSize(),
      setSize: size => appWindow.setSize(new LogicalSize(size.width, size.height)),
      setPosition: position => appWindow.setPosition(new PhysicalPosition(position.x, position.y)),
      currentMonitor,
      monitors: availableMonitors,
      persist: saveWindowPosition,
      sideChanged: left => {
        preferencesOnLeft = left
      }
    })

    async function setupWindow() {
      await geometry!.restore(loadWindowPosition())
      if (disposed) return

      async function register(listener: Promise<() => void>) {
        try {
          const unlisten = await listener
          if (disposed) releaseListener(unlisten)
          else unlisteners.push(unlisten)
        } catch {
          // One unavailable native event must not leak another listener.
        }
      }
      await Promise.all([
        register(
          listen("openPreferences", () => {
            preferencesVisible = true
          })
        ),
        register(
          appWindow.onMoved(({ payload }) => {
            geometry?.moved(payload)
            clearTimeout(monitorTimer)
            monitorTimer = setTimeout(() => geometry?.refreshMonitor(), 250)
          })
        ),
        register(
          appWindow.onScaleChanged(() => {
            geometry?.resize(preferencesVisible)
          })
        )
      ])
    }

    setupWindow()

    return () => {
      disposed = true
      clearTimeout(monitorTimer)
      geometry?.dispose()
      unlisteners.forEach(releaseListener)
    }
  })

  $: geometry?.resize(preferencesVisible)

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
    height: 100%;
    flex: 0 0 325px;
    padding: 10px;
    max-height: 850px;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: none;
    font-family: var(--fontFamily);
    color: var(--foregroundColor);
  }

  main::-webkit-scrollbar {
    display: none;
  }
</style>
