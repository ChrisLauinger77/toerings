<script lang="ts">
  export let lines: string[]
</script>

{#each lines as line, index}
  {#if index > 0}<br />{/if}{line}
{/each}
