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

export const defaultPreferences: Preferences = {
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
    return stored ? { ...defaultPreferences, ...JSON.parse(stored) } : { ...defaultPreferences }
  } catch {
    return { ...defaultPreferences }
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
  const store = writable(typeof savedFont === "string" ? savedFont : defaultPreferences.fontFamily)

  store.subscribe(font => {
    preferences.fontFamily = font
    savePreferences()
  })

  return store
}

export const foregroundColor = persistedColor("foregroundColor", defaultPreferences.foregroundColor)
export const backgroundColor = persistedColor("backgroundColor", defaultPreferences.backgroundColor)
export const titleColor = persistedColor("titleColor", defaultPreferences.titleColor)
export const accentColor = persistedColor("accentColor", defaultPreferences.accentColor)
export const arcTrackColor = persistedColor("arcTrackColor", defaultPreferences.arcTrackColor)
export const arcCapColor = persistedColor("arcCapColor", defaultPreferences.arcCapColor)
export const fontFamily = persistedFont()

export type ThemeName = "default" | "midnight" | "light"

const themes: Record<ThemeName, Preferences> = {
  default: defaultPreferences,
  midnight: {
    foregroundColor: "#dbeafe",
    backgroundColor: "rgba(7, 12, 24, 0.92)",
    titleColor: "#7dd3fc",
    accentColor: "#c084fc",
    arcTrackColor: "rgba(148, 163, 184, 0.22)",
    arcCapColor: "#f8fafc",
    fontFamily: defaultPreferences.fontFamily
  },
  light: {
    foregroundColor: "#243047",
    backgroundColor: "rgba(248, 250, 252, 0.94)",
    titleColor: "#047857",
    accentColor: "#c026d3",
    arcTrackColor: "rgba(36, 48, 71, 0.18)",
    arcCapColor: "#243047",
    fontFamily: defaultPreferences.fontFamily
  }
}

export function applyTheme(theme: ThemeName) {
  const values = themes[theme]
  foregroundColor.set(colord(values.foregroundColor))
  backgroundColor.set(colord(values.backgroundColor))
  titleColor.set(colord(values.titleColor))
  accentColor.set(colord(values.accentColor))
  arcTrackColor.set(colord(values.arcTrackColor))
  arcCapColor.set(colord(values.arcCapColor))
  fontFamily.set(values.fontFamily)
}

export function resetAppearance() {
  applyTheme("default")
}
