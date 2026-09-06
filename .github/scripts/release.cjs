/* eslint @typescript-eslint/no-require-imports: "off" -- Loaded with require by GitHub Script. */
const { readFileSync } = require("node:fs")
const { join } = require("node:path")

function validateVersions(tag, root = process.cwd()) {
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)) {
    throw new Error("Release tag must be a stable version: vX.Y.Z")
  }
  const version = tag.slice(1)
  const read = path => readFileSync(join(root, path), "utf8")
  const manifest = JSON.parse(read("package.json"))
  const lock = JSON.parse(read("package-lock.json"))
  const cargoPackage = read("src-tauri/Cargo.toml")
    .split(/^\[package\]\s*$/m)[1]
    ?.split(/^\[/m)[0]
  const cargoLock = read("src-tauri/Cargo.lock")
    .split(/^\[\[package\]\]\s*$/m)
    .filter(section => /^name = "toerings"$/m.test(section))
  const versions = [
    manifest.version,
    lock.version,
    lock.packages?.[""]?.version,
    cargoPackage?.match(/^version = "([^"]+)"$/m)?.[1],
    cargoLock.length === 1 ? cargoLock[0].match(/^version = "([^"]+)"$/m)?.[1] : undefined,
    JSON.parse(read("src-tauri/tauri.conf.json")).version
  ]
  if (versions.some(value => value !== version)) {
    throw new Error(
      `Tag ${tag} does not match every application version: ${JSON.stringify(versions)}`
    )
  }
  return version
}

function assertDraft(release, tag, commit) {
  // target_commitish is not provenance: GitHub ignores it for an existing tag.
  // https://docs.github.com/en/rest/releases/releases#create-a-release
  if (
    !release.draft ||
    release.tag_name !== tag ||
    !release.body?.includes(`<!-- toerings-source:${commit} -->`)
  ) {
    throw new Error("Refusing to modify a release that is not a draft for this tag and commit")
  }
}

async function ensureDraft(github, repo, tag, commit, body) {
  await assertTag(github, repo, tag, commit)
  const releases = await github.paginate(github.rest.repos.listReleases, { ...repo, per_page: 100 })
  const existing = releases.find(release => release.tag_name === tag)
  if (existing) {
    assertDraft(existing, tag, commit)
    return existing.id
  }
  const { data } = await github.rest.repos.createRelease({
    ...repo,
    tag_name: tag,
    target_commitish: commit,
    name: `ToeRings ${tag}`,
    body: `${body}\n\n<!-- toerings-source:${commit} -->`,
    draft: true,
    prerelease: false,
    generate_release_notes: true
  })
  return data.id
}

async function assertTag(github, repo, tag, commit) {
  const { data } = await github.rest.repos.getCommit({ ...repo, ref: tag })
  if (data.sha !== commit) throw new Error("Release tag no longer points to the checked-out commit")
}

function assertAssets(assets, version) {
  const names = assets
    .filter(asset => asset.state === "uploaded" && asset.size > 0)
    .map(asset => asset.name)
  for (const suffix of [".deb", ".rpm", ".AppImage"]) {
    if (
      names.filter(
        name =>
          (name.startsWith(`ToeRings_${version}_`) || name.startsWith(`ToeRings-${version}-`)) &&
          name.endsWith(suffix)
      ).length !== 1
    ) {
      throw new Error(`Missing or ambiguous Linux release asset: ${suffix}`)
    }
  }
  for (const suffix of [
    "aarch64.app.zip",
    "universal.app.zip",
    "x64-setup.exe",
    "windows_x86_64_portable.zip"
  ]) {
    const name = `ToeRings_${version}_${suffix}`
    if (!names.includes(name)) throw new Error(`Missing release asset: ${name}`)
    if (
      (suffix.endsWith(".exe") || suffix.endsWith("portable.zip")) &&
      !names.includes(`${name}.sha256`)
    ) {
      throw new Error(`Missing release checksum: ${name}.sha256`)
    }
  }
}

module.exports = { validateVersions, assertDraft, assertTag, ensureDraft, assertAssets }
