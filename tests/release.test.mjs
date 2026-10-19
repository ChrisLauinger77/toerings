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

function candidateRun(overrides = {}) {
  return {
    id: 42,
    workflow_id: 7,
    path: ".github/workflows/publish.yml",
    event: "workflow_dispatch",
    status: "completed",
    conclusion: "success",
    run_attempt: 1,
    head_sha: commit,
    head_branch: "main",
    repository: { full_name: "ChrisLauinger77/toerings" },
    head_repository: { full_name: "ChrisLauinger77/toerings" },
    ...overrides
  }
}

function candidateArtifact(overrides = {}) {
  return {
    id: 99,
    name: "release-assets",
    expired: false,
    size_in_bytes: 1000,
    workflow_run: { id: 42, head_sha: commit },
    ...overrides
  }
}

function candidateApi({ refType = "tag", message, run = candidateRun(), artifacts } = {}) {
  return {
    paginate: (method, params) => method(params),
    rest: {
      git: {
        getRef: () => Promise.resolve({ data: { object: { type: refType, sha: "tag-object" } } }),
        getTag: () =>
          Promise.resolve({
            data: {
              tag: "v1.2.3",
              message: message ?? "ToeRings 1.2.3\n\nCandidate-Run: 42\n",
              object: { type: "commit", sha: commit }
            }
          })
      },
      actions: {
        getWorkflow: () => Promise.resolve({ data: { id: 7 } }),
        getWorkflowRun: () => Promise.resolve({ data: run }),
        listWorkflowRunArtifacts: () => artifacts ?? [candidateArtifact()]
      }
    }
  }
}

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

test("candidate run ID comes from exactly one Candidate-Run tag line", () => {
  assert.equal(release.candidateRunId("ToeRings 1.2.3\n\nCandidate-Run: 123456\n"), 123456)
  for (const message of [
    "ToeRings 1.2.3",
    "Candidate-Run: 0",
    "Candidate-Run: abc",
    "Candidate-Run: -5",
    "Candidate-Run: 12 34",
    "Candidate-Run: 1\nCandidate-Run: 2",
    undefined
  ]) {
    assert.throws(() => release.candidateRunId(message), /Candidate-Run/)
  }
})

test("candidate summary contains the exact tag commands", () => {
  const text = release.candidateSummary({ version: "1.2.3", commit, runId: 42, retentionDays: 30 })
  assert.match(text, /^### Candidate ready for verification/)
  assert.ok(
    text.includes(
      `git tag -a v1.2.3 ${commit} \\\n  -m "ToeRings 1.2.3" \\\n  -m "Candidate-Run: 42"`
    )
  )
  assert.ok(text.includes("git push origin v1.2.3"))
  assert.match(text, /30 days/)
  assert.match(text, /Do not rerun/)
})

test("candidate resolution accepts only a successful first manual run of this workflow", async () => {
  assert.deepEqual(await release.resolveCandidate(candidateApi(), repo, "v1.2.3", "main"), {
    commit,
    runId: 42,
    artifactId: 99
  })
  const rejected = {
    "wrong repository": { repository: { full_name: "someone/toerings" } },
    "wrong head repository": { head_repository: { full_name: "someone/toerings" } },
    "wrong workflow": { workflow_id: 8 },
    "wrong workflow path": { path: ".github/workflows/ci.yml" },
    "wrong event": { event: "push" },
    "wrong source commit": { head_sha: "b".repeat(40) },
    "wrong branch": { head_branch: "feature" },
    "failed run": { conclusion: "failure" },
    "incomplete run": { status: "in_progress", conclusion: null },
    rerun: { run_attempt: 2 },
    "another run ID": { id: 43 }
  }
  for (const [reason, overrides] of Object.entries(rejected)) {
    await assert.rejects(
      release.resolveCandidate(
        candidateApi({ run: candidateRun(overrides) }),
        repo,
        "v1.2.3",
        "main"
      ),
      /Candidate run/,
      reason
    )
  }
  await assert.rejects(
    release.resolveCandidate(candidateApi({ refType: "commit" }), repo, "v1.2.3", "main"),
    /annotated tag/
  )
  await assert.rejects(
    release.resolveCandidate(candidateApi({ message: "ToeRings 1.2.3" }), repo, "v1.2.3", "main"),
    /Candidate-Run/
  )
})

test("candidate artifact must be the single unexpired release-assets of that run", async () => {
  const resolve = artifacts =>
    release.resolveCandidate(candidateApi({ artifacts }), repo, "v1.2.3", "main")
  await assert.rejects(resolve([]), /exactly one/)
  await assert.rejects(
    resolve([candidateArtifact({ name: "packages-linux-x86_64" })]),
    /exactly one/
  )
  await assert.rejects(
    resolve([candidateArtifact(), candidateArtifact({ id: 100 })]),
    /exactly one/
  )
  await assert.rejects(resolve([candidateArtifact({ expired: true })]), /expired.*new manual/)
  await assert.rejects(resolve([candidateArtifact({ size_in_bytes: 0 })]), /empty/)
  await assert.rejects(
    resolve([candidateArtifact({ workflow_run: { id: 41, head_sha: commit } })]),
    /another run/
  )
  await assert.rejects(
    resolve([candidateArtifact({ workflow_run: { id: 42, head_sha: "b".repeat(40) } })]),
    /another run/
  )
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
