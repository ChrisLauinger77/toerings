import type { Locale } from "./i18n"

/** One native update at a time, with a finite retry budget for each new selection. */
export function createMenuLocaleSync(apply: (_locale: Locale) => Promise<void>) {
  const retryDelays = [250, 1000]
  let requestedLocale: Locale | undefined
  let appliedLocale: Locale | undefined
  let revision = 0
  let retries = 0
  let inFlight = false
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined

  async function synchronize() {
    if (
      disposed ||
      inFlight ||
      requestedLocale === undefined ||
      requestedLocale === appliedLocale
    ) {
      return
    }
    const locale = requestedLocale
    const attemptRevision = revision
    let failed = false
    inFlight = true
    try {
      await apply(locale)
      if (!disposed) appliedLocale = locale
    } catch {
      // A failed menu replacement may have partially changed native state.
      // Even a return to the previously applied language must be reconciled.
      if (!disposed) appliedLocale = undefined
      failed = true
    } finally {
      inFlight = false
    }
    if (disposed) return

    if (attemptRevision !== revision) {
      // Skip intermediate selections, and do not charge an old failure to the
      // latest selection's retry budget.
      void synchronize()
    } else if (failed && retries < retryDelays.length) {
      timer = setTimeout(() => {
        timer = undefined
        void synchronize()
      }, retryDelays[retries++])
    }
  }

  return {
    request(locale: Locale) {
      if (disposed || requestedLocale === locale) return
      requestedLocale = locale
      revision++
      retries = 0
      clearTimeout(timer)
      timer = undefined
      void synchronize()
    },
    dispose() {
      disposed = true
      clearTimeout(timer)
      timer = undefined
    }
  }
}
