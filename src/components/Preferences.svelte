<script lang="ts">
  export let preferencesVisible: boolean

  import ColorPicker from "svelte-awesome-color-picker"
  import type { Locale } from "../lib/i18n"

  import { activeLocale, localeSetting, t, type LocaleSetting } from "../lib/i18n"
  import {
    accentColor,
    applyTheme,
    arcCapColor,
    arcTrackColor,
    backgroundColor,
    fontFamily,
    foregroundColor,
    resetAppearance,
    titleColor,
    type ThemeName
  } from "../lib/stores"

  const fontPresets = [
    "Inter, Avenir, Helvetica, Arial, sans-serif",
    "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
  ]

  let customFontEditorOpen = false
  let selectedFont = ""
  $: selectedFont =
    customFontEditorOpen || !fontPresets.includes($fontFamily) ? "custom" : $fontFamily

  function closePreferences() {
    preferencesVisible = false
  }

  function selectTheme(theme: ThemeName) {
    applyTheme(theme)
  }

  function updateFontPreset(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value
    customFontEditorOpen = value === "custom"
    if (value !== "custom") fontFamily.set(value)
  }

  function updateCustomFont(event: Event) {
    fontFamily.set((event.currentTarget as HTMLInputElement).value)
  }

  function updateLocale(event: Event) {
    localeSetting.set((event.currentTarget as HTMLSelectElement).value as LocaleSetting)
  }

  function restoreDefaults() {
    customFontEditorOpen = false
    resetAppearance()
  }

  function pickerTexts(locale: Locale) {
    const labels = {
      en: ["hue", "saturation", "brightness", "red", "green", "blue", "alpha", "hex color"],
      de: ["Farbton", "Sättigung", "Helligkeit", "Rot", "Grün", "Blau", "Alpha", "Hex-Farbe"],
      fr: ["teinte", "saturation", "luminosité", "rouge", "vert", "bleu", "alpha", "couleur hex"],
      es: ["tono", "saturación", "brillo", "rojo", "verde", "azul", "alfa", "color hex"]
    }[locale]

    return {
      label: {
        h: labels[0],
        s: labels[1],
        v: labels[2],
        r: labels[3],
        g: labels[4],
        b: labels[5],
        a: labels[6],
        hex: labels[7]
      }
    }
  }
</script>

<aside aria-label={$t("preferences.title")}>
  <header>
    <div>
      <h1>{$t("preferences.title")}</h1>
      <p>{$t("preferences.subtitle")}</p>
    </div>
    <button
      class="icon-button"
      type="button"
      on:click={closePreferences}
      aria-label={$t("preferences.close")}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  </header>

  <section>
    <h2>{$t("preferences.theme")}</h2>
    <div class="themes">
      <button class="theme" type="button" on:click={() => selectTheme("default")}>
        <span class="theme-preview default-preview"><i></i><i></i><i></i></span>
        <span>{$t("preferences.defaultTheme")}</span>
      </button>
      <button class="theme" type="button" on:click={() => selectTheme("midnight")}>
        <span class="theme-preview midnight-preview"><i></i><i></i><i></i></span>
        <span>{$t("preferences.midnightTheme")}</span>
      </button>
      <button class="theme" type="button" on:click={() => selectTheme("light")}>
        <span class="theme-preview light-preview"><i></i><i></i><i></i></span>
        <span>{$t("preferences.lightTheme")}</span>
      </button>
    </div>
  </section>

  <section>
    <h2>{$t("preferences.interfaceColors")}</h2>
    <div class="settings-card color-settings">
      <div class="color-row">
        <ColorPicker
          rgb={$foregroundColor.toRgb()}
          label={$t("color.foreground")}
          isAlpha={false}
          texts={pickerTexts($activeLocale)}
          textInputModes={["hex", "rgb"]}
          onInput={({ color }) => color && foregroundColor.set(color)}
        />
      </div>
      <div class="color-row">
        <ColorPicker
          rgb={$backgroundColor.toRgb()}
          label={$t("color.background")}
          texts={pickerTexts($activeLocale)}
          textInputModes={["hex", "rgb"]}
          onInput={({ color }) => color && backgroundColor.set(color)}
        />
      </div>
      <div class="color-row">
        <ColorPicker
          rgb={$titleColor.toRgb()}
          label={$t("color.title")}
          isAlpha={false}
          texts={pickerTexts($activeLocale)}
          textInputModes={["hex", "rgb"]}
          onInput={({ color }) => color && titleColor.set(color)}
        />
      </div>
      <div class="color-row">
        <ColorPicker
          rgb={$accentColor.toRgb()}
          label={$t("color.accent")}
          isAlpha={false}
          texts={pickerTexts($activeLocale)}
          textInputModes={["hex", "rgb"]}
          onInput={({ color }) => color && accentColor.set(color)}
        />
      </div>
    </div>
  </section>

  <section>
    <h2>{$t("preferences.ringColors")}</h2>
    <div class="settings-card color-settings">
      <div class="color-row">
        <ColorPicker
          rgb={$arcTrackColor.toRgb()}
          label={$t("color.arcTrack")}
          texts={pickerTexts($activeLocale)}
          textInputModes={["hex", "rgb"]}
          onInput={({ color }) => color && arcTrackColor.set(color)}
        />
      </div>
      <div class="color-row">
        <ColorPicker
          rgb={$arcCapColor.toRgb()}
          label={$t("color.arcCap")}
          texts={pickerTexts($activeLocale)}
          textInputModes={["hex", "rgb"]}
          onInput={({ color }) => color && arcCapColor.set(color)}
        />
      </div>
    </div>
  </section>

  <section>
    <h2>{$t("preferences.typography")}</h2>
    <div class="settings-card form-settings">
      <label for="font-family">{$t("preferences.font")}</label>
      <select id="font-family" value={selectedFont} on:change={updateFontPreset}>
        <option value={fontPresets[0]}>{$t("font.classic")}</option>
        <option value={fontPresets[1]}>{$t("font.system")}</option>
        <option value={fontPresets[2]}>{$t("font.monospace")}</option>
        <option value="custom">{$t("font.custom")}</option>
      </select>
      {#if selectedFont === "custom"}
        <label for="custom-font">{$t("preferences.customFont")}</label>
        <input
          id="custom-font"
          type="text"
          value={$fontFamily}
          on:change={updateCustomFont}
          placeholder={$t("preferences.fontPlaceholder")}
        />
      {/if}
    </div>
  </section>

  <section>
    <h2>{$t("preferences.language")}</h2>
    <div class="settings-card form-settings">
      <select
        aria-label={$t("preferences.language")}
        value={$localeSetting}
        on:change={updateLocale}
      >
        <option value="system">{$t("preferences.systemLanguage")}</option>
        <option value="en">English</option>
        <option value="de">Deutsch</option>
        <option value="fr">Français</option>
        <option value="es">Español</option>
      </select>
    </div>
  </section>

  <button class="reset-button" type="button" on:click={restoreDefaults}>
    {$t("preferences.restoreDefaults")}
  </button>
</aside>

<style>
  aside {
    width: 325px;
    height: 850px;
    overflow-y: auto;
    padding: 22px 18px 28px;
    color: #e8edf5;
    background:
      radial-gradient(circle at 100% 0%, rgb(56 189 248 / 10%), transparent 34%),
      linear-gradient(180deg, rgb(18 24 35 / 98%), rgb(11 16 24 / 98%));
    border-left: 1px solid rgb(255 255 255 / 10%);
    font-family: Inter, Avenir, Helvetica, Arial, sans-serif;
    scrollbar-width: thin;
    scrollbar-color: rgb(148 163 184 / 35%) transparent;
  }

  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 14px;
    margin-bottom: 24px;
  }

  h1,
  h2,
  p {
    margin: 0;
  }

  h1 {
    color: #f8fafc;
    font-size: 21px;
    font-weight: 650;
    letter-spacing: -0.02em;
  }

  header p {
    margin-top: 5px;
    max-width: 230px;
    color: #94a3b8;
    font-size: 11px;
    line-height: 1.45;
  }

  .icon-button {
    display: grid;
    flex: 0 0 auto;
    width: 32px;
    height: 32px;
    place-items: center;
    padding: 0;
    color: #cbd5e1;
    background: rgb(255 255 255 / 6%);
    border: 1px solid rgb(255 255 255 / 8%);
    border-radius: 9px;
    cursor: pointer;
  }

  .icon-button:hover {
    color: white;
    background: rgb(255 255 255 / 12%);
  }

  .icon-button svg {
    width: 17px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-width: 1.8;
  }

  section {
    margin-bottom: 20px;
  }

  h2 {
    margin: 0 0 8px 2px;
    color: #94a3b8;
    font-size: 10px;
    font-weight: 650;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .themes {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 7px;
  }

  .theme {
    min-width: 0;
    padding: 7px;
    color: #cbd5e1;
    background: rgb(255 255 255 / 4%);
    border: 1px solid rgb(255 255 255 / 9%);
    border-radius: 11px;
    font: inherit;
    font-size: 10px;
    cursor: pointer;
  }

  .theme:hover,
  .theme:focus-visible {
    color: white;
    background: rgb(255 255 255 / 8%);
    border-color: rgb(125 211 252 / 45%);
  }

  .theme-preview {
    position: relative;
    display: block;
    height: 35px;
    margin-bottom: 6px;
    overflow: hidden;
    background: #080808;
    border-radius: 7px;
  }

  .theme-preview i {
    position: absolute;
    left: 10px;
    width: 43px;
    height: 2px;
    background: white;
    border-radius: 2px;
  }

  .theme-preview i:nth-child(1) {
    top: 9px;
    background: #00ff00;
  }

  .theme-preview i:nth-child(2) {
    top: 16px;
    background: #ff00ff;
  }

  .theme-preview i:nth-child(3) {
    top: 23px;
  }

  .midnight-preview {
    background: #070c18;
  }

  .midnight-preview i:nth-child(1) {
    background: #7dd3fc;
  }

  .midnight-preview i:nth-child(2) {
    background: #c084fc;
  }

  .midnight-preview i:nth-child(3) {
    background: #dbeafe;
  }

  .light-preview {
    background: #f8fafc;
  }

  .light-preview i:nth-child(1) {
    background: #047857;
  }

  .light-preview i:nth-child(2) {
    background: #c026d3;
  }

  .light-preview i:nth-child(3) {
    background: #243047;
  }

  .settings-card {
    overflow: visible;
    background: rgb(255 255 255 / 5%);
    border: 1px solid rgb(255 255 255 / 8%);
    border-radius: 12px;
  }

  .color-settings {
    padding: 2px 12px;
  }

  .color-row {
    min-height: 44px;
    padding: 8px 0;
    border-bottom: 1px solid rgb(255 255 255 / 7%);
  }

  .color-row:last-child {
    border-bottom: 0;
  }

  .color-row :global(.color-picker) {
    display: block;
    --cp-bg-color: #18212f;
    --cp-border-color: rgb(148 163 184 / 30%);
    --focus-color: #38bdf8;
    --input-size: 27px;
    --picker-z-index: 10;
  }

  .color-settings :global(label) {
    color: #e2e8f0;
    font-size: 12px;
  }

  .form-settings {
    display: grid;
    gap: 8px;
    padding: 12px;
  }

  label {
    color: #cbd5e1;
    font-size: 11px;
  }

  select,
  input {
    width: 100%;
    min-height: 36px;
    padding: 8px 10px;
    color: #f1f5f9;
    background-color: #101722;
    border: 1px solid rgb(148 163 184 / 24%);
    border-radius: 8px;
    font: inherit;
    font-size: 11px;
  }

  select:focus,
  input:focus,
  button:focus-visible {
    outline: 2px solid rgb(56 189 248 / 75%);
    outline-offset: 2px;
  }

  .reset-button {
    width: 100%;
    padding: 10px 12px;
    color: #cbd5e1;
    background: transparent;
    border: 1px solid rgb(148 163 184 / 24%);
    border-radius: 9px;
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }

  .reset-button:hover {
    color: white;
    background: rgb(255 255 255 / 6%);
  }
</style>
