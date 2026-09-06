import assert from "node:assert/strict"
import test from "node:test"
import { render } from "svelte/server"
import TooltipText from "../src/components/TooltipText.svelte"
import CPUWidget from "../src/components/CPUWidget.svelte"
import MemWidget from "../src/components/MemWidget.svelte"
import DiskWidget from "../src/components/DiskWidget.svelte"
import NetWidget from "../src/components/NetWidget.svelte"
import { collectionStatus, normalizeData, uniqueDisks } from "../src/lib/telemetry.ts"
import { startPolling } from "../src/lib/polling.ts"

const missing = {
  cpu: null,
  memory: null,
  swap: null,
  network: null,
  list_of_processes: null,
  temperature_sensors: null,
  disks: null,
  sequence: 1,
  age_ms: 0,
  failed: false
}

test("unavailable sources produce graph gaps and safe widget inputs", () => {
  const data = normalizeData(missing)
  assert.deepEqual(data.cpu, [])
  assert.deepEqual(data.temperatures, [])
  assert.equal(data.cpuLoad, null)
  assert.equal(data.memoryPercent, null)
  assert.equal(data.read, null)
  assert.equal(data.rx, null)
  assert.equal(data.memoryAvailable, false)
  assert.equal(collectionStatus(missing), "partial")
  assert.equal(collectionStatus({ ...missing, age_ms: 6000 }), "stale")
  assert.equal(collectionStatus({ ...missing, sequence: 0 }), "starting")
})

test("blocked startup becomes stale after five seconds and recovers on publication", () => {
  const initial = { ...missing, sequence: 0 }
  assert.equal(collectionStatus(initial), "starting")
  assert.equal(collectionStatus({ ...initial, age_ms: 5000 }), "starting")
  assert.equal(collectionStatus({ ...initial, age_ms: 5001 }), "stale")
  assert.equal(collectionStatus({ ...initial, failed: true }), "stale")
  assert.equal(collectionStatus(missing), "partial")
  const memory = { mem_total_in_kib: 100, mem_used_in_kib: 50, use_percent: 50 }
  assert.equal(
    collectionStatus({
      ...missing,
      cpu: [],
      memory,
      swap: memory,
      network: { rx: 0, tx: 0 },
      list_of_processes: [],
      temperature_sensors: [],
      disks: []
    }),
    "ready"
  )
})

test("all widgets render unavailable telemetry without invalid numbers or exceptions", () => {
  const sample = normalizeData(missing)
  const widgets = [
    [
      CPUWidget,
      {
        cpuData: { perCoreUtil: [], cpuLoads: [null] },
        tempData: sample.temperatures,
        processList: sample.processes
      }
    ],
    [
      MemWidget,
      {
        memData: {
          ram: { usage: sample.memory, percentages: [null] },
          swap: { usage: sample.swap }
        },
        processList: [],
        memoryAvailable: false,
        swapAvailable: false
      }
    ],
    [
      DiskWidget,
      { diskData: sample.disks, ioData: [{ read: null, write: null }], processList: [] }
    ],
    [NetWidget, { networkData: { rx: [null], tx: [null] }, hostname: null }]
  ]
  for (const [widget, props] of widgets) {
    const { body } = render(widget, { props })
    assert.ok(body.includes("N/A"))
    assert.ok(!/NaN|undefined|Infinity/.test(body))
  }
})

test("disk tooltip content is escaped even when supplied by mounted metadata", () => {
  const { body } = render(TooltipText, {
    props: { lines: ["<img src=x onerror=alert(1)>", "/mnt/a&b", "50% used"] }
  })
  assert.ok(body.includes("&lt;img"))
  assert.ok(body.includes("a&amp;b"))
  assert.ok(body.includes("<br"))
  assert.ok(!body.includes("<img"))
})

test("process widgets retain names, rankings, memory bytes and I/O without unused metadata", () => {
  const processes = [
    {
      name: "cpu-worker",
      cpu_usage_percent: 75,
      mem_usage_bytes: 1024,
      read_bytes_per_sec: 100,
      write_bytes_per_sec: 200
    },
    {
      name: "memory-worker",
      cpu_usage_percent: 25,
      mem_usage_bytes: 2048,
      read_bytes_per_sec: 300,
      write_bytes_per_sec: 400
    }
  ]
  const sample = normalizeData({ ...missing, list_of_processes: processes })
  assert.equal(sample.read, 400)
  assert.equal(sample.write, 600)
  const memory = { mem_total_in_kib: 100, mem_used_in_kib: 50, use_percent: 50 }
  const widgets = [
    [
      CPUWidget,
      { cpuData: { perCoreUtil: [75], cpuLoads: [0.75] }, tempData: [] },
      "cpu-worker",
      "memory-worker",
      "75.00%"
    ],
    [
      MemWidget,
      { memData: { ram: { usage: memory, percentages: [50] }, swap: { usage: memory } } },
      "memory-worker",
      "cpu-worker",
      "2.0kB"
    ],
    [
      DiskWidget,
      { diskData: [], ioData: [{ read: sample.read, write: sample.write }] },
      "memory-worker",
      "cpu-worker",
      "r:300B, w:400B"
    ]
  ]
  for (const [widget, props, first, second, expectedValue] of widgets) {
    const body = render(widget, { props: { ...props, processList: sample.processes } }).body
    assert.ok(body.includes(first) && body.indexOf(first) < body.indexOf(second))
    assert.ok(body.includes(expectedValue), expectedValue)
    assert.ok(!/NaN|undefined|Infinity/.test(body))
    const legacy = render(widget, {
      props: {
        ...props,
        processList: processes.map(process => ({
          ...process,
          parent_pid: 1,
          mem_usage_percent: 99,
          uid: 1000,
          user: "worker",
          total_read_bytes: 1000000,
          total_write_bytes: 2000000
        }))
      }
    }).body
    assert.equal(body, legacy, "removing unused IPC properties must not change rendered output")
  }
})

test("displayed load, throughput and freshness do not depend on removed snapshot fields", () => {
  const memory = { mem_total_in_kib: 100, mem_used_in_kib: 50, use_percent: 50 }
  const data = {
    ...missing,
    cpu: [
      { data_type: { Cpu: 0 }, cpu_usage: 75 },
      { data_type: { Cpu: 1 }, cpu_usage: 25 }
    ],
    memory,
    swap: memory,
    network: { rx: 1024, tx: 2048 },
    list_of_processes: [{ read_bytes_per_sec: 100, write_bytes_per_sec: 200 }],
    temperature_sensors: [],
    disks: []
  }
  const legacy = {
    ...data,
    last_collection_time: 123456,
    load_avg: [99, 98, 97],
    io: { device: { read_bytes: 1000000, write_bytes: 2000000 } },
    network: { ...data.network, total_rx: 3000000, total_tx: 4000000 }
  }
  const sample = normalizeData(data)
  assert.deepEqual(sample, normalizeData(legacy))
  assert.equal(sample.cpuLoad, 1)
  assert.equal(sample.read, 100)
  assert.equal(sample.write, 200)
  assert.equal(sample.rx, 1024)
  assert.equal(sample.tx, 2048)
  for (const snapshot of [data, legacy]) {
    assert.equal(collectionStatus(snapshot), "ready")
    assert.equal(collectionStatus({ ...snapshot, age_ms: 6000 }), "stale")
    assert.equal(collectionStatus({ ...snapshot, failed: true }), "stale")
  }
})

test("distinct volumes with equal usage remain visible", () => {
  const a = { name: "a", mount_point: "/a", free_space: 10, used_space: 0, total_space: 10 }
  const b = { ...a, name: "b", mount_point: "/b" }
  assert.deepEqual(uniqueDisks([b, a, a]), [a, b])
})

test("polling recovers after rejection and processing failure, without overlap", async () => {
  let requests = 0
  let failures = 0
  let active = 0
  let maxActive = 0
  let done
  const received = new Promise(resolve => {
    done = resolve
  })
  const stop = startPolling({
    intervalMs: 1,
    collect: async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise(resolve => setTimeout(resolve, 2))
      active--
      if (++requests === 1) throw new Error("temporary IPC rejection")
      return requests
    },
    receive: value => {
      if (value === 2) throw new Error("temporary processing failure")
      done()
    },
    failed: () => failures++
  })
  try {
    await received
    assert.equal(failures, 2)
    assert.equal(maxActive, 1)
  } finally {
    stop()
  }
})

test("unmount ignores a pending response and cancels future requests", async () => {
  let resolve
  let received = false
  const response = new Promise(done => {
    resolve = done
  })
  const stop = startPolling({
    collect: () => response,
    receive: () => {
      received = true
    },
    failed: () => {},
    intervalMs: 1
  })
  stop()
  resolve(missing)
  await new Promise(done => setTimeout(done, 5))
  assert.equal(received, false)
})
