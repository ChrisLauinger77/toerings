<script lang="ts">
  export let preferencesVisible

  import ColorPicker from "svelte-awesome-color-picker"
  import { get } from "svelte/store"

  import {
    foregroundColor,
    backgroundColor,
    titleColor,
    accentColor,
    fontFamily,
    arcTrackColor,
    arcCapColor
  } from "../lib/stores"

  function closePreferences() {
    preferencesVisible = false
  }

  function updateFontFamily(event: Event) {
    fontFamily.set((event.currentTarget as HTMLInputElement).value)
  }
</script>

<aside>
  <h1>Preferences</h1>

  <button on:click={closePreferences} aria-label="close">✕</button>
  <div class="picker">
    <ColorPicker
      rgb={get(foregroundColor).toRgb()}
      label="Foreground color"
      isAlpha={false}
      onInput={({ color }) => color && foregroundColor.set(color)}
    />
  </div>
  <div class="picker">
    <ColorPicker
      rgb={get(backgroundColor).toRgb()}
      label="Background color"
      onInput={({ color }) => color && backgroundColor.set(color)}
    />
  </div>
  <div class="picker">
    <ColorPicker
      rgb={get(titleColor).toRgb()}
      label="Title color"
      isAlpha={false}
      onInput={({ color }) => color && titleColor.set(color)}
    />
  </div>
  <div class="picker">
    <ColorPicker
      rgb={get(accentColor).toRgb()}
      label="Accent color"
      isAlpha={false}
      onInput={({ color }) => color && accentColor.set(color)}
    />
  </div>
  <div class="picker">
    <ColorPicker
      rgb={get(arcTrackColor).toRgb()}
      label="Arc track color"
      isAlpha={true}
      onInput={({ color }) => color && arcTrackColor.set(color)}
    />
  </div>
  <div class="picker">
    <ColorPicker
      rgb={get(arcCapColor).toRgb()}
      label="Arc cap color"
      isAlpha={true}
      onInput={({ color }) => color && arcCapColor.set(color)}
    />
  </div>
  <form on:submit|preventDefault={() => {}}>
    <fieldset>
      <div>
        <label for="font-family">Font</label>
        <input
          type="text"
          id="font-family"
          value={get(fontFamily)}
          on:change={updateFontFamily}
          placeholder="Avenir, Arial"
        />
      </div>
    </fieldset>
  </form>
</aside>

<style>
  aside {
    position: relative;
    width: 325px;
    background-color: white;
    color: #2b3e51;
    padding: 15px;
  }

  h1 {
    font-weight: 500;
    margin-bottom: 20px;
  }

  .picker {
    margin-bottom: 20px;
    font-size: 12px;
  }

  label {
    font-size: 14px;
  }

  input {
    width: 100%;
    padding: 12px;
    border: 1px solid #cfd9db;
    background-color: #ffffff;
    border-radius: 0.25em;
    box-shadow: inset 0 1px 1px rgb(0 0 0 / 8%);
  }

  input:focus {
    outline: none;
    border-color: #2c3e50;
    box-shadow: 0 0 5px rgb(44 151 222 / 20%);
  }

  button {
    position: absolute;
    top: 10px;
    right: 10px;
    border: none;
    background-color: white;
    font-size: 30px;
    border-radius: 5px;
    cursor: pointer;
  }

  button:hover {
    background-color: #f1f1f1;
  }
</style>
