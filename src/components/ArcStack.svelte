<script lang="ts">
  export let arcs: Array<ArcSpec>
  export let size = 100
  export let strokeWidth = 8

  interface ArcSpec {
    value: number
    max: number
    label?: string
    tooltip?: string[]
  }

  import { ringLayout } from "../lib/utils"
  import { styleVars } from "../lib/actions"
  import { arcTrackColor, arcCapColor, foregroundColor } from "../lib/stores"
  import Arc from "./Arc.svelte"

  $: layout = ringLayout(size, arcs.length, strokeWidth)
  $: cssVars = {
    size: `${size}px`
  }
  $: trackColor = $arcTrackColor.toHslString()
  $: strokeColor = $foregroundColor.alpha(0.6).toHslString()
  $: capColor = $arcCapColor.toHslString()
</script>

<div class="arcs-container" use:styleVars={cssVars}>
  {#each arcs as arc, i}
    <div class="arc-wrap">
      <Arc
        {...arc}
        size={size - layout.levelWidth * i}
        strokeWidth={layout.strokeWidth}
        {strokeColor}
        {capColor}
        {trackColor}
      />
    </div>
  {/each}
</div>

<style>
  .arcs-container {
    position: relative;
    width: var(--size);
    height: var(--size);
  }

  .arc-wrap {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    height: fit-content;
  }
</style>
