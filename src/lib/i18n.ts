import { derived, writable } from "svelte/store"

export type Locale = "en" | "de" | "fr" | "es"
export type LocaleSetting = "system" | Locale

const storageKey = "toerings.locale.v1"

const en = {
  "common.notAvailable": "N/A",
  "summary.system": "System",
  "summary.uptime": "Uptime:",
  "summary.osVersion": "OS Version:",
  "summary.kernel": "Kernel:",
  "cpu.title": "CPU",
  "cpu.temperature": "CPU Temp:",
  "cpu.load": "CPU Load:",
  "memory.title": "Mem",
  "memory.ram": "RAM",
  "memory.swap": "Swap",
  "memory.available": "Available:",
  "memory.used": "Used:",
  "disk.title": "Disk",
  "disk.read": "Read:",
  "disk.write": "Write:",
  "disk.used": "used",
  "network.title": "Net",
  "network.hostname": "Hostname:",
  "network.localIp": "Local IP:",
  "network.down": "Down",
  "network.up": "Up",
  "preferences.title": "Appearance",
  "preferences.subtitle": "Personalize ToeRings while previewing changes live.",
  "preferences.close": "Close preferences",
  "preferences.theme": "Theme",
  "preferences.defaultTheme": "Default",
  "preferences.midnightTheme": "Midnight",
  "preferences.lightTheme": "Light",
  "preferences.interfaceColors": "Interface colors",
  "preferences.ringColors": "Ring colors",
  "preferences.typography": "Typography",
  "preferences.language": "Language",
  "preferences.systemLanguage": "System language",
  "preferences.font": "Font",
  "preferences.customFont": "Custom font",
  "preferences.fontPlaceholder": "Font name or CSS font stack",
  "preferences.restoreDefaults": "Restore appearance defaults",
  "color.foreground": "Foreground",
  "color.background": "Background",
  "color.title": "Headings",
  "color.accent": "Accent",
  "color.arcTrack": "Ring track",
  "color.arcCap": "Ring cap",
  "font.system": "System sans serif",
  "font.classic": "Classic sans serif",
  "font.monospace": "Monospace",
  "font.custom": "Custom…"
} as const

export type TranslationKey = keyof typeof en

const translations: Record<Locale, Record<TranslationKey, string>> = {
  en,
  de: {
    "common.notAvailable": "k. A.",
    "summary.system": "System",
    "summary.uptime": "Laufzeit:",
    "summary.osVersion": "Betriebssystem:",
    "summary.kernel": "Kernel:",
    "cpu.title": "CPU",
    "cpu.temperature": "CPU-Temperatur:",
    "cpu.load": "CPU-Auslastung:",
    "memory.title": "Speicher",
    "memory.ram": "RAM",
    "memory.swap": "Swap",
    "memory.available": "Verfügbar:",
    "memory.used": "Verwendet:",
    "disk.title": "Datenträger",
    "disk.read": "Lesen:",
    "disk.write": "Schreiben:",
    "disk.used": "belegt",
    "network.title": "Netz",
    "network.hostname": "Hostname:",
    "network.localIp": "Lokale IP:",
    "network.down": "Download",
    "network.up": "Upload",
    "preferences.title": "Darstellung",
    "preferences.subtitle": "ToeRings anpassen und Änderungen sofort ansehen.",
    "preferences.close": "Einstellungen schließen",
    "preferences.theme": "Design",
    "preferences.defaultTheme": "Standard",
    "preferences.midnightTheme": "Mitternacht",
    "preferences.lightTheme": "Hell",
    "preferences.interfaceColors": "Oberflächenfarben",
    "preferences.ringColors": "Ringfarben",
    "preferences.typography": "Typografie",
    "preferences.language": "Sprache",
    "preferences.systemLanguage": "Systemsprache",
    "preferences.font": "Schriftart",
    "preferences.customFont": "Eigene Schriftart",
    "preferences.fontPlaceholder": "Schriftname oder CSS-Schriftliste",
    "preferences.restoreDefaults": "Darstellung zurücksetzen",
    "color.foreground": "Vordergrund",
    "color.background": "Hintergrund",
    "color.title": "Überschriften",
    "color.accent": "Akzent",
    "color.arcTrack": "Ringspur",
    "color.arcCap": "Ringende",
    "font.system": "Systemschrift",
    "font.classic": "Klassische Sans Serif",
    "font.monospace": "Monospace",
    "font.custom": "Eigene…"
  },
  fr: {
    "common.notAvailable": "N/D",
    "summary.system": "Système",
    "summary.uptime": "Disponibilité :",
    "summary.osVersion": "Version du SE :",
    "summary.kernel": "Noyau :",
    "cpu.title": "CPU",
    "cpu.temperature": "Temp. CPU :",
    "cpu.load": "Charge CPU :",
    "memory.title": "Mémoire",
    "memory.ram": "RAM",
    "memory.swap": "Swap",
    "memory.available": "Disponible :",
    "memory.used": "Utilisée :",
    "disk.title": "Disque",
    "disk.read": "Lecture :",
    "disk.write": "Écriture :",
    "disk.used": "utilisé",
    "network.title": "Réseau",
    "network.hostname": "Nom d’hôte :",
    "network.localIp": "IP locale :",
    "network.down": "Réception",
    "network.up": "Envoi",
    "preferences.title": "Apparence",
    "preferences.subtitle": "Personnalisez ToeRings avec un aperçu instantané.",
    "preferences.close": "Fermer les préférences",
    "preferences.theme": "Thème",
    "preferences.defaultTheme": "Par défaut",
    "preferences.midnightTheme": "Minuit",
    "preferences.lightTheme": "Clair",
    "preferences.interfaceColors": "Couleurs de l’interface",
    "preferences.ringColors": "Couleurs des anneaux",
    "preferences.typography": "Typographie",
    "preferences.language": "Langue",
    "preferences.systemLanguage": "Langue du système",
    "preferences.font": "Police",
    "preferences.customFont": "Police personnalisée",
    "preferences.fontPlaceholder": "Nom de police ou liste de polices CSS",
    "preferences.restoreDefaults": "Réinitialiser l’apparence",
    "color.foreground": "Premier plan",
    "color.background": "Arrière-plan",
    "color.title": "Titres",
    "color.accent": "Accent",
    "color.arcTrack": "Piste des anneaux",
    "color.arcCap": "Extrémité des anneaux",
    "font.system": "Sans serif système",
    "font.classic": "Sans serif classique",
    "font.monospace": "Chasse fixe",
    "font.custom": "Personnalisée…"
  },
  es: {
    "common.notAvailable": "N/D",
    "summary.system": "Sistema",
    "summary.uptime": "Tiempo activo:",
    "summary.osVersion": "Versión del SO:",
    "summary.kernel": "Núcleo:",
    "cpu.title": "CPU",
    "cpu.temperature": "Temp. de CPU:",
    "cpu.load": "Carga de CPU:",
    "memory.title": "Memoria",
    "memory.ram": "RAM",
    "memory.swap": "Swap",
    "memory.available": "Disponible:",
    "memory.used": "Usada:",
    "disk.title": "Disco",
    "disk.read": "Lectura:",
    "disk.write": "Escritura:",
    "disk.used": "usado",
    "network.title": "Red",
    "network.hostname": "Nombre del equipo:",
    "network.localIp": "IP local:",
    "network.down": "Bajada",
    "network.up": "Subida",
    "preferences.title": "Apariencia",
    "preferences.subtitle": "Personaliza ToeRings y observa los cambios al instante.",
    "preferences.close": "Cerrar preferencias",
    "preferences.theme": "Tema",
    "preferences.defaultTheme": "Predeterminado",
    "preferences.midnightTheme": "Medianoche",
    "preferences.lightTheme": "Claro",
    "preferences.interfaceColors": "Colores de la interfaz",
    "preferences.ringColors": "Colores de los anillos",
    "preferences.typography": "Tipografía",
    "preferences.language": "Idioma",
    "preferences.systemLanguage": "Idioma del sistema",
    "preferences.font": "Fuente",
    "preferences.customFont": "Fuente personalizada",
    "preferences.fontPlaceholder": "Nombre de fuente o lista de fuentes CSS",
    "preferences.restoreDefaults": "Restaurar apariencia",
    "color.foreground": "Primer plano",
    "color.background": "Fondo",
    "color.title": "Títulos",
    "color.accent": "Acento",
    "color.arcTrack": "Pista de los anillos",
    "color.arcCap": "Extremo de los anillos",
    "font.system": "Sans serif del sistema",
    "font.classic": "Sans serif clásica",
    "font.monospace": "Monoespaciada",
    "font.custom": "Personalizada…"
  }
}

function detectSystemLocale(): Locale {
  const language = typeof navigator === "undefined" ? "en" : navigator.language.toLowerCase()
  const locale = language.split("-")[0]
  return locale === "de" || locale === "fr" || locale === "es" ? locale : "en"
}

function loadLocaleSetting(): LocaleSetting {
  try {
    const saved = localStorage.getItem(storageKey)
    return saved === "system" ||
      saved === "en" ||
      saved === "de" ||
      saved === "fr" ||
      saved === "es"
      ? saved
      : "system"
  } catch {
    return "system"
  }
}

export const localeSetting = writable<LocaleSetting>(loadLocaleSetting())

localeSetting.subscribe(locale => {
  try {
    localStorage.setItem(storageKey, locale)
  } catch {
    // Keep language selection usable when storage is unavailable.
  }
})

export const activeLocale = derived(localeSetting, locale =>
  locale === "system" ? detectSystemLocale() : locale
)

export const t = derived(activeLocale, locale => (key: TranslationKey) => translations[locale][key])
