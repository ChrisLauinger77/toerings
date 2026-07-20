<script lang="ts">
  interface CPUProps {
    perCoreUtil: Array<number>
    cpuLoads: Array<number>
  }

  export let cpuData: CPUProps
  export let processList: Array<Process>
  export let tempData: Array<TempData>

  import { mean } from "lodash-es"
  import { t } from "../lib/i18n"
  import { calcStrokeWidth } from "../lib/utils"
  import { foregroundColor } from "../lib/stores"
  import ArcStack from "./ArcStack.svelte"
  import ArcWidget from "./ArcWidget.svelte"
  import ProcessList from "./ProcessList.svelte"

  $: arcs = cpuData.perCoreUtil.map(utilPercent => ({
    value: utilPercent,
    max: 100
  }))

  $: plotData = {
    x: cpuData.cpuLoads.map((_, i) => i),
    y: cpuData.cpuLoads,
    color: $foregroundColor
  }

  $: avgDieTemp = mean(tempData.map(sensor => sensor.temperature))
  $: attrs = [
    { key: $t("cpu.temperature"), value: `${avgDieTemp.toFixed(1)}°C` },
    { key: $t("cpu.load"), value: (cpuData.cpuLoads.at(-1) ?? 0).toFixed(2) }
  ]
  $: cpuSortedProcesses = [...processList]
    .sort((a, b) => b.cpu_usage_percent - a.cpu_usage_percent)
    .slice(0, 5)
</script>

<ArcWidget {attrs}>
  <ArcStack slot="arcStack" {arcs} size={120} strokeWidth={calcStrokeWidth(arcs.length)} />
  <ProcessList
    slot="content"
    title={$t("cpu.title")}
    plotDatas={[plotData]}
    processList={cpuSortedProcesses}
  >
    <span slot="processVal" let:process>{process.cpu_usage_percent.toFixed(2)}%</span>
  </ProcessList>
</ArcWidget>
