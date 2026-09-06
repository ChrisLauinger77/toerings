import assert from "node:assert/strict"
import test from "node:test"
import { clampPosition, createWindowGeometry, windowHeight } from "../src/lib/windowGeometry.ts"
import { calcStrokeWidth, ringLayout } from "../src/lib/utils.ts"

const monitor = {
  scaleFactor: 1,
  workArea: { position: { x: 0, y: 25 }, size: { width: 1920, height: 1015 } }
}

test("work areas, negative coordinates, and DPI constrain window placement", () => {
  assert.deepEqual(clampPosition({ x: 5000, y: -100 }, { width: 325, height: 850 }, [monitor]), {
    x: 1595,
    y: 25
  })
  const small = {
    scaleFactor: 2,
    workArea: { position: { x: -1920, y: 0 }, size: { width: 1920, height: 1400 } }
  }
  assert.equal(windowHeight(small), 700)
  assert.equal(windowHeight(monitor), 850)
  assert.deepEqual(clampPosition({ x: -2000, y: 20 }, { width: 650, height: 1400 }, [small]), {
    x: -1920,
    y: 0
  })
})

test("preferences preserve the main panel anchor through expansion and rapid toggles", async () => {
  let position = { x: 1500, y: 50 }
  let size = { width: 325, height: 850 }
  let saved
  let left
  const geometry = createWindowGeometry({
    position: () => Promise.resolve(position),
    size: () => Promise.resolve(size),
    setPosition: value => {
      position = value
      return Promise.resolve()
    },
    setSize: value => {
      size = value
      return Promise.resolve()
    },
    currentMonitor: () => Promise.resolve(monitor),
    monitors: () => Promise.resolve([monitor]),
    persist: value => {
      saved = value
    },
    sideChanged: value => {
      left = value
    }
  })
  await geometry.resize(true)
  assert.equal(position.x, 1175)
  assert.equal(saved.x, 1500)
  assert.equal(left, true)
  await Promise.all([geometry.resize(false), geometry.resize(true), geometry.resize(false)])
  assert.equal(size.width, 325)
  assert.equal(position.x, 1500)
  assert.equal(saved.x, 1500)
  assert.equal(left, false)
  geometry.dispose()
})

test("all logical CPUs retain positive SVG radii without changing smaller layouts", () => {
  for (const count of [1, 4, 8, 12, 16, 24, 32, 64, 128]) {
    const layout = ringLayout(120, count, calcStrokeWidth(count))
    assert.ok(layout.strokeWidth > 0)
    for (let index = 0; index < count; index++) {
      assert.ok((120 - layout.levelWidth * index) / 2 - 5 - layout.strokeWidth / 2 > 0)
    }
  }
  assert.deepEqual(ringLayout(120, 8, 4), { strokeWidth: 4, levelWidth: 10 })
})

test("unsupported positioning does not prevent resizing or dispose cancellation", async () => {
  let size = { width: 325, height: 850 }
  let resizeCount = 0
  let saved = false
  const geometry = createWindowGeometry({
    position: () => Promise.reject(new Error("unsupported compositor operation")),
    size: () => Promise.resolve(size),
    setPosition: () => Promise.reject(new Error("unsupported compositor operation")),
    setSize: value => {
      resizeCount++
      size = value
      return Promise.resolve()
    },
    currentMonitor: () =>
      Promise.resolve({
        ...monitor,
        workArea: { ...monitor.workArea, size: { width: 1920, height: 700 } }
      }),
    monitors: () => Promise.resolve([monitor]),
    persist: () => {
      saved = true
    },
    sideChanged: () => {}
  })
  await geometry.resize(true)
  assert.deepEqual(size, { width: 650, height: 700 })
  assert.equal(saved, false)
  const pending = geometry.resize(false)
  geometry.dispose()
  await pending
  assert.equal(resizeCount, 1)
})

test("moving to a shorter monitor refits once without disturbing ordinary dragging", async () => {
  let current = monitor
  let position = { x: 30, y: 50 }
  let size = { width: 325, height: 850 }
  let resizes = 0
  const geometry = createWindowGeometry({
    position: () => Promise.resolve(position),
    size: () => Promise.resolve(size),
    setPosition: value => {
      position = value
      return Promise.resolve()
    },
    setSize: value => {
      resizes++
      size = value
      return Promise.resolve()
    },
    currentMonitor: () => Promise.resolve(current),
    monitors: () => Promise.resolve([current]),
    persist: () => {},
    sideChanged: () => {}
  })
  await geometry.resize(false)
  await geometry.refreshMonitor()
  assert.equal(resizes, 1)
  current = {
    scaleFactor: 1,
    workArea: { position: { x: 1920, y: 0 }, size: { width: 1920, height: 600 } }
  }
  position = { x: 2000, y: 50 }
  geometry.moved(position)
  await geometry.refreshMonitor()
  assert.equal(size.height, 600)
  assert.deepEqual(position, { x: 2000, y: 0 })
  assert.equal(resizes, 2)
  geometry.dispose()
})
