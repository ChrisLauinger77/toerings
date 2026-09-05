import assert from "node:assert/strict"
import test from "node:test"
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

test("publication requires every platform bundle and Windows checksum", () => {
  const names = [
    "ToeRings_1.2.3_amd64.deb",
    "ToeRings-1.2.3-1.x86_64.rpm",
    "ToeRings_1.2.3_amd64.AppImage",
    "ToeRings_1.2.3_aarch64.app.zip",
    "ToeRings_1.2.3_universal.app.zip",
    "ToeRings_1.2.3_x64-setup.exe",
    "ToeRings_1.2.3_x64-setup.exe.sha256",
    "ToeRings_1.2.3_windows_x86_64_portable.zip",
    "ToeRings_1.2.3_windows_x86_64_portable.zip.sha256"
  ]
  const assets = names.map(name => ({ name, state: "uploaded", size: 100 }))
  release.assertAssets(assets, "1.2.3")
  assert.throws(() =>
    release.assertAssets(
      assets.map(asset => ({ ...asset, name: asset.name.replace("1.2.3", "11.2.3") })),
      "1.2.3"
    )
  )
  for (let i = 0; i < assets.length; i++) {
    assert.throws(() =>
      release.assertAssets(
        assets.filter((_, index) => index !== i),
        "1.2.3"
      )
    )
    assert.throws(() =>
      release.assertAssets(
        assets.map((asset, index) => (index === i ? { ...asset, size: 0 } : asset)),
        "1.2.3"
      )
    )
  }
})
