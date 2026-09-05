import assert from "node:assert/strict"
import test from "node:test"
import { registerHooks } from "node:module"
import { colord } from "colord"

test("chart teardown releases its renderer and a color change is applied on the next draw", async () => {
  // Keep the renderer stub local to this import; other widget tests use the real library.
  const renderer = `export default class {
    constructor() { this.series = [{}, {}]; this.destroyed = false }
    setData(data) { this.data = data; this.drawnColor = this.series[1].stroke() }
    destroy() { this.destroyed = true }
  }`
  const url = `data:text/javascript,${encodeURIComponent(renderer)}`
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "uplot" && context.parentURL?.endsWith("?lifecycle-test")) {
        return { url, shortCircuit: true }
      }
      return nextResolve(specifier, context)
    }
  })
  try {
    const { default: Renderer } = await import(url)
    const instances = []
    const originalSetData = Renderer.prototype.setData
    Renderer.prototype.setData = function capture(data) {
      instances.push(this)
      originalSetData.call(this, data)
    }
    const { uPlotAction, styleVars } = await import("../src/lib/actions.ts?lifecycle-test")
    const action = uPlotAction({}, { x: [0], y: [0] })
    const color = colord("#ff0000")
    action.update({ x: [0, 1], y: [0, null], color })
    const instance = instances.at(-1)
    assert.equal(instance.drawnColor, color.alpha(0.7).lighten(0.2).toHslString())
    assert.deepEqual(instance.data[1], [0, null])
    action.destroy()
    assert.equal(instance.destroyed, true)

    const values = new Map()
    const props = Object.freeze({ color: "red", background: "black" })
    const styles = styleVars(
      {
        style: {
          setProperty: (key, value) => values.set(key, value),
          removeProperty: key => values.delete(key)
        }
      },
      props
    )
    styles.update({ color: "blue" })
    assert.deepEqual([...values], [["--color", "blue"]])
    assert.equal(props.background, "black")
  } finally {
    hooks.deregister()
  }
})
