<script lang="ts">
  export let summaryData: SummaryData

  import { t } from "../lib/i18n"
</script>

<header data-tauri-drag-region>
  <h1>{$t("summary.system")}</h1>
  <div class="divider"></div>
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

  ul {
    margin-top: 0;
    margin-bottom: 20px;
    padding-left: 10px;
  }
</style>
