<script lang="ts">
  export let memData: {
    ram: { usage: MemData; percentages: Array<number | null> }
    swap: { usage: MemData }
  }
  export let memoryAvailable = true
  export let swapAvailable = true
  export let processList: Array<Process>

  import { toMetric, calcStrokeWidth } from "../lib/utils"
  import { t } from "../lib/i18n"
  import { foregroundColor } from "../lib/stores"
  import ArcStack from "./ArcStack.svelte"
  import ArcWidget from "./ArcWidget.svelte"
  import ProcessList from "./ProcessList.svelte"

  $: arcs = [
    {
      value: memData.ram.usage.mem_used_in_kib,
      max: memData.ram.usage.mem_total_in_kib,
      label: $t("memory.ram")
    },
    {
      value: memData.swap.usage.mem_used_in_kib,
      max: memData.swap.usage.mem_total_in_kib,
      label: $t("memory.swap")
    }
  ].filter((_, index) => (index === 0 ? memoryAvailable : swapAvailable))

  $: attrs = [
    {
      key: $t("memory.total"),
      value: memoryAvailable
        ? toMetric(memData.ram.usage.mem_total_in_kib * 1024)
        : $t("common.notAvailable")
    },
    {
      key: $t("memory.used"),
      value: memoryAvailable
        ? toMetric(memData.ram.usage.mem_used_in_kib * 1024)
        : $t("common.notAvailable")
    }
  ]
  $: plotData = {
    x: memData.ram.percentages.map((_, i) => i),
    y: memData.ram.percentages,
    color: $foregroundColor
  }

  $: memSortedProcesses = [...processList]
    .sort((a, b) => b.mem_usage_bytes - a.mem_usage_bytes)
    .slice(0, 5)
</script>

<ArcWidget {attrs}>
  <ArcStack slot="arcStack" {arcs} size={120} strokeWidth={calcStrokeWidth(arcs.length)} />
  <ProcessList
    slot="content"
    title={$t("memory.title")}
    plotDatas={[plotData]}
    processList={memSortedProcesses}
  >
    <span slot="processVal" let:process>{toMetric(process.mem_usage_bytes)}</span>
  </ProcessList>
</ArcWidget>
