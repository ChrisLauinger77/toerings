export interface Position {
  x: number
  y: number
}
export interface Size {
  width: number
  height: number
}
export interface ScreenArea {
  scaleFactor: number
  workArea: { position: Position; size: Size }
}

export function clampPosition(
  position: Position,
  size: Size,
  monitors: ScreenArea[]
): Position | null {
  let closest: Position | null = null
  let distance = Infinity
  for (const { workArea } of monitors) {
    const x = Math.min(
      Math.max(position.x, workArea.position.x),
      workArea.position.x + Math.max(0, workArea.size.width - size.width)
    )
    const y = Math.min(
      Math.max(position.y, workArea.position.y),
      workArea.position.y + Math.max(0, workArea.size.height - size.height)
    )
    const nextDistance = (x - position.x) ** 2 + (y - position.y) ** 2
    if (nextDistance < distance) {
      closest = { x, y }
      distance = nextDistance
    }
  }
  return closest
}

export function windowHeight(monitor: ScreenArea | null): number {
  return monitor
    ? Math.max(1, Math.min(850, Math.floor(monitor.workArea.size.height / monitor.scaleFactor)))
    : 850
}

/** Serializes native geometry mutations and persists the main panel's anchor. */
export function createWindowGeometry(options: {
  position: () => Promise<Position>
  size: () => Promise<Size>
  setSize: (_size: Size) => Promise<void>
  setPosition: (_position: Position) => Promise<void>
  currentMonitor: () => Promise<ScreenArea | null>
  monitors: () => Promise<ScreenArea[]>
  persist: (_position: Position) => void
  sideChanged: (_left: boolean) => void
}) {
  let queue = Promise.resolve()
  let disposed = false
  let busy = false
  let left = false
  let offset = 0
  let revision = 0
  let expectedMove: Position | null = null
  let lastMonitor = ""
  let preferencesVisible = false

  async function move(position: Position) {
    if (disposed) return
    expectedMove = position
    try {
      await options.setPosition(position)
    } catch {
      expectedMove = null
      // A compositor may support sizing but refuse explicit positioning.
    }
  }

  function enqueue(work: () => Promise<void>) {
    queue = queue
      .then(async () => {
        if (disposed) return
        busy = true
        try {
          await work()
        } finally {
          busy = false
        }
      })
      .catch(() => {
        // Unsupported positioning (for example on some Wayland compositors) must
        // not prevent a later operation from trying again.
      })
    return queue
  }

  const geometry = {
    restore(position: Position | null) {
      return enqueue(async () => {
        if (!position) return
        const [size, monitors] = await Promise.all([options.size(), options.monitors()])
        const restored = clampPosition(position, size, monitors)
        if (restored) await move(restored)
      })
    },
    resize(showPreferences: boolean) {
      preferencesVisible = showPreferences
      const request = ++revision
      return enqueue(async () => {
        if (request !== revision) return
        const [position, previousSize, monitor] = await Promise.all([
          options.position().catch(() => null),
          options.size(),
          options.currentMonitor().catch(() => null)
        ])
        if (disposed) return
        const mainWidth = monitor
          ? Math.round(325 * monitor.scaleFactor)
          : previousSize.width - offset
        const anchor = position && {
          x: position.x + (left ? previousSize.width - mainWidth : 0),
          y: position.y
        }
        await options.setSize({ width: showPreferences ? 650 : 325, height: windowHeight(monitor) })
        lastMonitor = JSON.stringify(monitor)
        const size = await options.size()
        if (disposed) return
        if (!anchor) {
          left = false
          offset = 0
          options.sideChanged(false)
          return
        }
        const right = monitor ? monitor.workArea.position.x + monitor.workArea.size.width : Infinity
        left = showPreferences && anchor.x + size.width > right
        offset = showPreferences ? Math.max(0, size.width - mainWidth) : 0
        const desired = { x: anchor.x - (left ? offset : 0), y: anchor.y }
        const target = monitor ? clampPosition(desired, size, [monitor])! : desired
        await move(target)
        if (disposed) return
        options.sideChanged(left)
        // Persist actual geometry; a compositor may constrain a requested move.
        const actual = await options.position()
        options.persist({ x: actual.x + (left ? offset : 0), y: actual.y })
      })
    },
    moved(position: Position) {
      if (disposed || busy) return
      if (expectedMove?.x === position.x && expectedMove?.y === position.y) {
        expectedMove = null
        return
      }
      options.persist({ x: position.x + (left ? offset : 0), y: position.y })
    },
    async refreshMonitor() {
      if (disposed) return
      const monitor = await options.currentMonitor().catch(() => null)
      if (!disposed && JSON.stringify(monitor) !== lastMonitor) {
        await geometry.resize(preferencesVisible)
      }
    },
    dispose() {
      disposed = true
    }
  }
  return geometry
}
