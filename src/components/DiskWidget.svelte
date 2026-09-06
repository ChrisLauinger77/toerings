<script lang="ts">
  export let diskData: Array<DiskData>
  export let ioData: Array<{ read: number | null; write: number | null }>
  export let processList: Array<Process>

  import { uniqueDisks } from "../lib/telemetry"

  import { toMetric, calcStrokeWidth } from "../lib/utils"
  import { t } from "../lib/i18n"
  import { foregroundColor } from "../lib/stores"
  import ArcStack from "./ArcStack.svelte"
  import ArcWidget from "./ArcWidget.svelte"
  import ProcessList from "./ProcessList.svelte"

  function formatPath(filepath: string): string {
    if (filepath === "/") {
      return "/"
    }
    return filepath.split(/[\\/]/).filter(Boolean).at(-1) ?? filepath
  }

  $: pathSortedDisks = uniqueDisks(diskData)

  $: ioSortedProcesses = [...processList]
    .sort(
      (a, b) =>
        b.write_bytes_per_sec +
        b.read_bytes_per_sec -
        (a.write_bytes_per_sec + a.read_bytes_per_sec)
    )
    .slice(0, 5)

  $: arcs = pathSortedDisks
    .filter(
      (disk): disk is DiskData & { used_space: number; total_space: number } =>
        disk.used_space !== null && disk.total_space !== null && disk.total_space > 0
    )
    .slice(0, 4)
    .map(disk => ({
      label: formatPath(disk.mount_point),
      value: disk.used_space,
      max: disk.total_space,
      tooltip: [
        disk.name,
        disk.mount_point,
        `${((disk.used_space / disk.total_space) * 100).toFixed(1)}% ${$t("disk.used")}`
      ]
    }))

  $: latestIo = ioData.at(-1) ?? { read: 0, write: 0 }
  $: attrs = [
    {
      key: $t("disk.read"),
      value: latestIo.read === null ? $t("common.notAvailable") : `${toMetric(latestIo.read)}/s`
    },
    {
      key: $t("disk.write"),
      value: latestIo.write === null ? $t("common.notAvailable") : `${toMetric(latestIo.write)}/s`
    }
  ]

  $: plotDatas = [
    {
      x: ioData.map((_, i) => i),
      y: ioData.map(point => point.read),
      color: $foregroundColor
    },
    {
      x: ioData.map((_, i) => i),
      y: ioData.map(point => point.write),
      color: $foregroundColor
    }
  ]
</script>

<ArcWidget {attrs}>
  <ArcStack slot="arcStack" {arcs} size={120} strokeWidth={calcStrokeWidth(arcs.length)} />
  <ProcessList slot="content" title={$t("disk.title")} {plotDatas} processList={ioSortedProcesses}>
    <span slot="processVal" let:process>
      r:{toMetric(process.read_bytes_per_sec, 0)}, w:{toMetric(process.write_bytes_per_sec, 0)}
    </span>
  </ProcessList>
</ArcWidget>
