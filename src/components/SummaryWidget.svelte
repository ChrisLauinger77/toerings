<script lang="ts">
  export let summaryData: SummaryData
  export let onOpenPreferences: () => void

  import { t } from "../lib/i18n"
</script>

<header>
  <h1 data-tauri-drag-region>{$t("summary.system")}</h1>
  <div class="divider" data-tauri-drag-region></div>
  <button
    type="button"
    on:click={onOpenPreferences}
    aria-label={$t("preferences.open")}
    title={$t("preferences.open")}
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h7M15 7h5M11 4v6M4 17h3M11 17h9M7 14v6" />
    </svg>
  </button>
</header>

<ul>
  <li><strong>{$t("summary.uptime")}</strong> {summaryData.uptime}</li>
  <li><strong>{$t("summary.osVersion")}</strong> {summaryData.os_version}</li>
  <li>
    <strong>{$t("summary.kernel")}</strong>
    {summaryData.kernel_name}
    {summaryData.kernel_version}
  </li>
</ul>

<style>
  header {
    display: flex;
    padding: 5px 10px 0 10px;
  }

  h1 {
    font-weight: 500;
    font-size: 13px;
    padding-right: 3px;
  }

  .divider {
    flex-grow: 1;
    border-top: 1px solid var(--foregroundColor);
    height: 0;
    align-self: center;
  }

  button {
    display: grid;
    flex: 0 0 auto;
    width: 24px;
    height: 24px;
    place-items: center;
    margin-left: 5px;
    padding: 0;
    color: var(--foregroundColor);
    background: rgb(255 255 255 / 8%);
    border: 1px solid rgb(255 255 255 / 18%);
    border-radius: 6px;
    cursor: pointer;
  }

  button:hover,
  button:focus-visible {
    color: var(--accentColor);
    background: rgb(255 255 255 / 14%);
  }

  button:focus-visible {
    outline: 1px solid currentColor;
    outline-offset: 1px;
  }

  svg {
    width: 15px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-width: 1.8;
  }

  ul {
    margin-top: 0;
    margin-bottom: 20px;
    padding-left: 10px;
  }
</style>
