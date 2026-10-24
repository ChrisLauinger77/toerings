import assert from "node:assert/strict"
import test from "node:test"
import { createHash } from "node:crypto"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import release from "../.github/scripts/release.cjs"

test("release preflight requires an exact stable tag and consistent version sources", () => {
  const version = JSON.parse(readFileSync("package.json", "utf8")).version
  assert.equal(release.validateVersions(`v${version}`), version)
  for (const tag of [version, `v${version}-beta`, "v01.2.3", "v9.9.9"]) {
    assert.throws(() => release.validateVersions(tag))
  }
  const root = mkdtempSync(join(tmpdir(), "toerings-versions-"))
  try {
    mkdirSync(join(root, "src-tauri"))
    const paths = [
      "package.json",
      "package-lock.json",
      "src-tauri/Cargo.toml",
      "src-tauri/Cargo.lock",
      "src-tauri/tauri.conf.json"
    ]
    for (const path of paths) writeFileSync(join(root, path), readFileSync(path))
    const lock = JSON.parse(readFileSync(join(root, "package-lock.json")))
    lock.packages[""].version = "99.0.0"
    writeFileSync(join(root, "package-lock.json"), JSON.stringify(lock))
    assert.throws(() => release.validateVersions(`v${version}`, root), /does not match/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("release retries reuse only a draft for the same tag and commit", async () => {
  const existing = {
    id: 7,
    draft: true,
    tag_name: "v1.2.3",
    body: "<!-- toerings-source:commit -->"
  }
  let created = 0
  const github = {
    paginate: () => Promise.resolve([existing]),
    rest: {
      repos: {
        listReleases() {},
        getCommit() {
          return Promise.resolve({ data: { sha: "commit" } })
        },
        createRelease() {
          created++
          return Promise.resolve({ data: { id: 8 } })
        }
      }
    }
  }
  assert.equal(await release.ensureDraft(github, {}, "v1.2.3", "commit", "body"), 7)
  assert.equal(created, 0)
  assert.throws(() => release.assertDraft({ ...existing, body: "" }, "v1.2.3", "commit"))
  await assert.rejects(release.ensureDraft(github, {}, "v1.2.3", "different", "body"))
  existing.draft = false
  await assert.rejects(release.ensureDraft(github, {}, "v1.2.3", "commit", "body"))
  github.paginate = () => Promise.resolve([])
  assert.equal(await release.ensureDraft(github, {}, "v1.2.3", "commit", "body"), 8)
})

const repo = { owner: "ChrisLauinger77", repo: "toerings" }
const commit = "a".repeat(40)
const sha256 = data => createHash("sha256").update(data).digest("hex")

function withAssets(callback) {
  const dir = mkdtempSync(join(tmpdir(), "toerings-assets-"))
  const cleanup = () => rmSync(dir, { recursive: true, force: true })
  try {
    for (const name of release.releaseAssets("1.2.3")) {
      if (name.endsWith(".sha256")) continue
      const data = `bytes of ${name}`
      writeFileSync(join(dir, name), data)
      if (release.releaseAssets("1.2.3").includes(`${name}.sha256`)) {
        writeFileSync(join(dir, `${name}.sha256`), `${sha256(data)}  ${name}\n`)
      }
    }
    const result = callback(dir)
    if (result instanceof Promise) return result.finally(cleanup)
    cleanup()
    return result
  } catch (error) {
    cleanup()
    throw error
  }
}

test("candidate summary explains the release environment approval", () => {
  const text = release.candidateSummary({ version: "1.2.3", commit, runId: 42, retentionDays: 30 })
  assert.match(text, /^### Candidate ready for verification/)
  assert.match(text, /Review deployments/)
  assert.ok(text.includes(`\`v1.2.3\` on \`${commit}\` with \`Candidate-Run: 42\``))
  assert.ok(!text.includes("git tag"))
  assert.match(text, /30 days/)
  assert.match(text, /Do not rerun/)
})

test("aggregation requires the complete asset set and records its checksums", () => {
  withAssets(dir => {
    release.writeChecksums(dir, "1.2.3")
    const files = release.verifyChecksums(dir, "1.2.3")
    assert.deepEqual(
      files.map(file => file.name),
      [...release.releaseAssets("1.2.3"), "SHA256SUMS"]
    )
    for (const file of files) assert.equal(file.sha256, sha256(readFileSync(file.path)))
    assert.throws(() => release.verifyChecksums(dir, "1.2.4"), /missing/)
  })
  for (const name of release.releaseAssets("1.2.3")) {
    withAssets(dir => {
      rmSync(join(dir, name))
      assert.throws(() => release.writeChecksums(dir, "1.2.3"), /missing/, name)
    })
  }
  withAssets(dir => {
    writeFileSync(join(dir, "ToeRings_1.2.3_extra.zip"), "extra")
    assert.throws(() => release.writeChecksums(dir, "1.2.3"), /unexpected/)
  })
  withAssets(dir => {
    writeFileSync(join(dir, "ToeRings_1.2.3_x64-setup.exe"), "changed")
    assert.throws(() => release.writeChecksums(dir, "1.2.3"), /Checksum file/)
  })
})

test("publication rejects candidates whose bytes or checksums changed", () => {
  const tampered = {
    "modified asset": dir => writeFileSync(join(dir, "ToeRings_1.2.3_amd64.deb"), "changed"),
    "modified checksum": dir => {
      const sums = readFileSync(join(dir, "SHA256SUMS"), "utf8")
      writeFileSync(
        join(dir, "SHA256SUMS"),
        sums.replace(/^[0-9a-f]/, c => (c === "0" ? "1" : "0"))
      )
    },
    "missing checksum entry": dir => {
      const sums = readFileSync(join(dir, "SHA256SUMS"), "utf8").split("\n")
      writeFileSync(join(dir, "SHA256SUMS"), sums.slice(1).join("\n"))
    },
    "duplicate checksum entry": dir => {
      const sums = readFileSync(join(dir, "SHA256SUMS"), "utf8").split("\n")
      writeFileSync(join(dir, "SHA256SUMS"), [sums[0], ...sums.slice(0, -2), ""].join("\n"))
    },
    "missing SHA256SUMS": dir => rmSync(join(dir, "SHA256SUMS")),
    "missing package": dir => rmSync(join(dir, "ToeRings-1.2.3-1.x86_64.rpm")),
    "empty package": dir => writeFileSync(join(dir, "ToeRings_1.2.3_amd64.AppImage"), "")
  }
  for (const [reason, tamper] of Object.entries(tampered)) {
    withAssets(dir => {
      release.writeChecksums(dir, "1.2.3")
      tamper(dir)
      assert.throws(() => release.verifyChecksums(dir, "1.2.3"), undefined, reason)
    })
  }
})

test("publication uploads the exact candidate files before publishing the draft", async () => {
  await withAssets(async dir => {
    release.writeChecksums(dir, "1.2.3")
    const files = release.verifyChecksums(dir, "1.2.3")
    let assets = [{ id: 1, name: "stale.zip", state: "uploaded", size: 1 }]
    const calls = []
    const draft = {
      id: 7,
      draft: true,
      tag_name: "v1.2.3",
      body: `<!-- toerings-source:${commit} -->`
    }
    const github = {
      paginate: (method, params) => method(params),
      rest: {
        repos: {
          getCommit: () => Promise.resolve({ data: { sha: commit } }),
          listReleases: () => [draft],
          getRelease: () => Promise.resolve({ data: draft }),
          listReleaseAssets: () => assets,
          deleteReleaseAsset(params) {
            calls.push(`delete ${params.asset_id}`)
            assets = assets.filter(asset => asset.id !== params.asset_id)
          },
          uploadReleaseAsset({ name, data }) {
            calls.push(`upload ${name}`)
            assets.push({
              id: assets.length + 10,
              name,
              state: "uploaded",
              size: data.length,
              digest: `sha256:${sha256(data)}`
            })
          },
          updateRelease(params) {
            calls.push(`publish draft=${params.draft}`)
          }
        }
      }
    }
    assert.equal(await release.publishRelease(github, repo, "v1.2.3", commit, "body", files), 7)
    assert.deepEqual(calls, [
      "delete 1",
      ...files.map(file => `upload ${file.name}`),
      "publish draft=false"
    ])
    for (const file of files) {
      const asset = assets.find(candidate => candidate.name === file.name)
      assert.equal(asset.digest, `sha256:${sha256(readFileSync(file.path))}`)
    }

    const uploaded = assets
    assert.throws(() => release.assertUploadedAssets(uploaded.slice(1), files), /exact asset set/)
    assert.throws(
      () =>
        release.assertUploadedAssets(
          uploaded.map((asset, index) => (index ? asset : { ...asset, digest: "sha256:0" })),
          files
        ),
      /does not match/
    )
    assert.throws(
      () =>
        release.assertUploadedAssets(
          uploaded.map((asset, index) => (index ? asset : { ...asset, state: "starter" })),
          files
        ),
      /does not match/
    )

    calls.length = 0
    github.rest.repos.getCommit = () => Promise.resolve({ data: { sha: "b".repeat(40) } })
    await assert.rejects(release.publishRelease(github, repo, "v1.2.3", commit, "body", files))
    assert.deepEqual(calls, [])
  })
})
