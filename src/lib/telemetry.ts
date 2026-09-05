export const emptyMemory = (): MemData => ({
  mem_total_in_kib: 0,
  mem_used_in_kib: 0,
  use_percent: null
})

export function finiteValue(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

export function normalizeData(data: Data) {
  return {
    cpu: data.cpu?.map(cpu => ({ ...cpu, cpu_usage: finiteValue(cpu.cpu_usage) ?? 0 })) ?? [],
    processes: data.list_of_processes ?? [],
    temperatures: data.temperature_sensors ?? [],
    memory: data.memory ?? emptyMemory(),
    swap: data.swap ?? emptyMemory(),
    disks: data.disks ?? [],
    cpuAvailable: data.cpu !== null,
    memoryAvailable: data.memory !== null,
    swapAvailable: data.swap !== null,
    cpuLoad: data.cpu
      ? data.cpu.reduce((sum, cpu) => sum + (finiteValue(cpu.cpu_usage) ?? 0), 0) / 100
      : null,
    memoryPercent: finiteValue(data.memory?.use_percent),
    read:
      data.list_of_processes?.reduce((sum, process) => sum + process.read_bytes_per_sec, 0) ?? null,
    write:
      data.list_of_processes?.reduce((sum, process) => sum + process.write_bytes_per_sec, 0) ??
      null,
    rx: data.network?.rx ?? null,
    tx: data.network?.tx ?? null
  }
}

export function collectionStatus(data: Data): "starting" | "stale" | "partial" | "ready" {
  if (data.failed) return "stale"
  if (data.sequence === 0 || data.age_ms === null) return "starting"
  if (data.age_ms > 5000) return "stale"
  return [
    data.cpu,
    data.memory,
    data.swap,
    data.network,
    data.list_of_processes,
    data.disks,
    data.temperature_sensors
  ].some(value => value === null)
    ? "partial"
    : "ready"
}

export function uniqueDisks(disks: DiskData[]): DiskData[] {
  const seen = new Set<string>()
  return [...disks]
    .sort((a, b) => a.mount_point.localeCompare(b.mount_point))
    .filter(disk => {
      // Capacity changes do not change identity. Keep distinct mounts of the same device.
      const identity = JSON.stringify([disk.name, disk.mount_point])
      if (seen.has(identity)) return false
      seen.add(identity)
      return true
    })
}
