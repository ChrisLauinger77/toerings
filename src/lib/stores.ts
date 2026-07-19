import { writable } from "svelte/store"
import { colord, type Colord } from "colord"

const storageKey = "toerings.preferences.v1"

type Preferences = {
  foregroundColor: string
  backgroundColor: string
  titleColor: string
  accentColor: string
  arcTrackColor: string
  arcCapColor: string
  fontFamily: string
}

const defaults: Preferences = {
  foregroundColor: "#ffffff",
  backgroundColor: "rgba(0, 0, 0, 0.5)",
  titleColor: "#00ff00",
  accentColor: "#ff00ff",
  arcTrackColor: "rgba(255, 255, 255, 0.2)",
  arcCapColor: "#ffffff",
  fontFamily: "Inter, Avenir, Helvetica, Arial, sans-serif"
}

function loadPreferences(): Preferences {
  try {
    const stored = localStorage.getItem(storageKey)
    return stored ? { ...defaults, ...JSON.parse(stored) } : { ...defaults }
  } catch {
    return { ...defaults }
  }
}

const preferences = loadPreferences()

function savePreferences() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(preferences))
  } catch {
    // Keep preferences usable when storage is unavailable.
  }
}

function persistedColor(name: keyof Preferences, fallback: string) {
  const savedColor = colord(preferences[name])
  const store = writable(savedColor.isValid() ? savedColor : colord(fallback))

  store.subscribe((color: Colord) => {
    preferences[name] = color.toRgbString()
    savePreferences()
  })

  return store
}

function persistedFont() {
  const savedFont = preferences.fontFamily
  const store = writable(typeof savedFont === "string" ? savedFont : defaults.fontFamily)

  store.subscribe(font => {
    preferences.fontFamily = font
    savePreferences()
  })

  return store
}

export const foregroundColor = persistedColor("foregroundColor", defaults.foregroundColor)
export const backgroundColor = persistedColor("backgroundColor", defaults.backgroundColor)
export const titleColor = persistedColor("titleColor", defaults.titleColor)
export const accentColor = persistedColor("accentColor", defaults.accentColor)
export const arcTrackColor = persistedColor("arcTrackColor", defaults.arcTrackColor)
export const arcCapColor = persistedColor("arcCapColor", defaults.arcCapColor)
export const fontFamily = persistedFont()
