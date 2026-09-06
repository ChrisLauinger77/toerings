/** A single outstanding request, with recovery and component-owned cancellation. */
export function startPolling<T>(options: {
  collect: () => Promise<T>
  receive: (_value: T) => void
  failed: () => void
  intervalMs?: number
  maxBackoffMs?: number
}) {
  const interval = options.intervalMs ?? 1000
  const maxBackoff = options.maxBackoffMs ?? 10000
  let disposed = false
  let failures = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  async function poll() {
    const started = performance.now()
    try {
      const value = await options.collect()
      if (disposed) return
      options.receive(value)
      failures = 0
    } catch {
      if (disposed) return
      failures++
      options.failed()
    }
    if (!disposed) {
      const delay = failures
        ? Math.min(interval * 2 ** Math.min(failures - 1, 10), maxBackoff)
        : Math.max(interval - (performance.now() - started), 0)
      timer = setTimeout(poll, delay)
    }
  }

  void poll()
  return () => {
    disposed = true
    clearTimeout(timer)
  }
}
