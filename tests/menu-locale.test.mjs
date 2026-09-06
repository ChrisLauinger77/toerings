import assert from "node:assert/strict"
import test from "node:test"
import { setImmediate } from "node:timers/promises"
import { get } from "svelte/store"
import { activeLocale, localeSetting, t } from "../src/lib/i18n.ts"
import { createMenuLocaleSync } from "../src/lib/menuLocale.ts"

function fixture(context) {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const calls = []
  let active = 0
  let maxActive = 0
  let nativeLocale = "en"
  const sync = createMenuLocaleSync(locale => {
    active++
    maxActive = Math.max(maxActive, active)
    return new Promise((resolve, reject) => {
      calls.push({
        locale,
        succeed() {
          nativeLocale = locale
          active--
          resolve()
        },
        fail() {
          active--
          reject(new Error("transient native failure"))
        }
      })
    })
  })
  context.after(() => {
    sync.dispose()
    assert.ok(maxActive <= 1, "native updates must never overlap")
  })
  return {
    sync,
    calls,
    nativeLocale: () => nativeLocale,
    async advance(milliseconds) {
      context.mock.timers.tick(milliseconds)
      await setImmediate()
    }
  }
}

test("native language is acknowledged after success and duplicate requests stay idle", async context => {
  const { sync, calls, nativeLocale, advance } = fixture(context)
  sync.request("de")
  sync.request("de")
  assert.equal(calls.length, 1)
  assert.equal(nativeLocale(), "en")
  calls[0].succeed()
  await setImmediate()
  sync.request("de")
  await advance(10000)
  assert.equal(nativeLocale(), "de")
  assert.equal(calls.length, 1)
})

test("a rejected language update retries automatically and stops after success", async context => {
  const { sync, calls, nativeLocale, advance } = fixture(context)
  sync.request("de")
  calls[0].fail()
  await setImmediate()
  sync.request("de")
  await advance(249)
  assert.equal(calls.length, 1, "failure must back off rather than spin")
  assert.equal(nativeLocale(), "en")
  await advance(1)
  assert.deepEqual(
    calls.map(call => call.locale),
    ["de", "de"]
  )
  calls[1].succeed()
  await setImmediate()
  await advance(10000)
  assert.equal(nativeLocale(), "de")
  assert.equal(calls.length, 2)
})

test("permanent failure exhausts two retries until a different language is selected", async context => {
  const { sync, calls, advance } = fixture(context)
  sync.request("fr")
  calls[0].fail()
  await setImmediate()
  await advance(250)
  calls[1].fail()
  await setImmediate()
  await advance(999)
  assert.equal(calls.length, 2)
  await advance(1)
  calls[2].fail()
  await setImmediate()
  for (let index = 0; index < 5; index++) {
    sync.request("fr")
    await advance(60000)
  }
  assert.equal(calls.length, 3)
  sync.request("es")
  assert.equal(calls[3].locale, "es")
  calls[3].fail()
  await setImmediate()
  await advance(250)
  assert.equal(calls[4].locale, "es", "the new selection has its own retry budget")
  calls[4].succeed()
  await setImmediate()
})

test("rapid changes serialize and coalesce to the latest language", async context => {
  const { sync, calls, nativeLocale, advance } = fixture(context)
  sync.request("de")
  sync.request("fr")
  sync.request("es")
  assert.equal(calls.length, 1)
  calls[0].succeed()
  await setImmediate()
  assert.deepEqual(
    calls.map(call => call.locale),
    ["de", "es"]
  )
  calls[1].succeed()
  await setImmediate()
  await advance(10000)
  assert.equal(nativeLocale(), "es")
  assert.equal(calls.length, 2)
})

test("an old failure cannot delay or consume retries for the latest request", async context => {
  const { sync, calls, advance } = fixture(context)
  sync.request("de")
  sync.request("fr")
  sync.request("es")
  calls[0].fail()
  await setImmediate()
  assert.deepEqual(
    calls.map(call => call.locale),
    ["de", "es"]
  )
  calls[1].fail()
  await setImmediate()
  await advance(250)
  calls[2].fail()
  await setImmediate()
  await advance(1000)
  assert.deepEqual(
    calls.map(call => call.locale),
    ["de", "es", "es", "es"]
  )
  calls[3].succeed()
  await setImmediate()
})

test("a new selection cancels a stale retry timer", async context => {
  const { sync, calls, nativeLocale, advance } = fixture(context)
  sync.request("de")
  calls[0].fail()
  await setImmediate()
  sync.request("fr")
  assert.deepEqual(
    calls.map(call => call.locale),
    ["de", "fr"]
  )
  calls[1].succeed()
  await setImmediate()
  await advance(10000)
  assert.equal(nativeLocale(), "fr")
  assert.equal(calls.length, 2)
})

test("returning to an applied language reconciles an intervening success or failure", async context => {
  const { sync, calls, nativeLocale } = fixture(context)
  sync.request("en")
  calls[0].succeed()
  await setImmediate()
  for (const finish of ["succeed", "fail"]) {
    const index = calls.length
    sync.request("de")
    sync.request("en")
    calls[index][finish]()
    await setImmediate()
    assert.equal(calls[index + 1].locale, "en")
    calls[index + 1].succeed()
    await setImmediate()
    assert.equal(nativeLocale(), "en")
  }
})

test("returning to the in-flight language uses that success without a redundant update", async context => {
  const { sync, calls, advance } = fixture(context)
  sync.request("de")
  sync.request("fr")
  sync.request("de")
  calls[0].succeed()
  await setImmediate()
  await advance(10000)
  assert.equal(calls.length, 1)
})

test("disposal cancels retries and ignores late completions and queued selections", async context => {
  const { sync, calls, advance } = fixture(context)
  sync.request("de")
  calls[0].fail()
  await setImmediate()
  sync.dispose()
  await advance(10000)
  sync.request("fr")
  assert.equal(calls.length, 1)

  for (const reject of [false, true]) {
    let complete
    let attempts = 0
    const pending = createMenuLocaleSync(
      () =>
        new Promise((resolve, fail) => {
          attempts++
          complete = () => (reject ? fail(new Error("late failure")) : resolve())
        })
    )
    pending.request("de")
    pending.request("fr")
    pending.dispose()
    complete()
    await setImmediate()
    await advance(10000)
    pending.request("es")
    assert.equal(attempts, 1)
  }
})

test("web translations update immediately while native synchronization waits", async context => {
  const previous = get(localeSetting)
  const { sync, calls, nativeLocale } = fixture(context)
  localeSetting.set("en")
  const unsubscribe = activeLocale.subscribe(sync.request)
  try {
    localeSetting.set("de")
    assert.equal(get(localeSetting), "de")
    assert.equal(get(t)("preferences.language"), "Sprache")
    assert.equal(nativeLocale(), "en")
    assert.equal(calls.length, 1)
    calls[0].succeed()
    await setImmediate()
    assert.equal(calls[1].locale, "de")
    calls[1].succeed()
    await setImmediate()
    assert.equal(nativeLocale(), "de")
  } finally {
    unsubscribe()
    localeSetting.set(previous)
  }
})
