/* eslint @typescript-eslint/no-require-imports: "off" -- Loaded with require by GitHub Script. */
const { createHash } = require("node:crypto")
const { readFileSync, readdirSync, statSync, writeFileSync } = require("node:fs")
const { join } = require("node:path")

const RELEASE_WORKFLOW = ".github/workflows/publish.yml"
const CANDIDATE_ARTIFACT = "release-assets"
const CHECKSUMS = "SHA256SUMS"

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

// The exact bundle set published for every release. Windows assets keep their
// historical per-file .sha256 companions; SHA256SUMS covers all of them.
function releaseAssets(version) {
  return [
    `ToeRings_${version}_amd64.deb`,
    `ToeRings-${version}-1.x86_64.rpm`,
    `ToeRings_${version}_amd64.AppImage`,
    `ToeRings_${version}_aarch64.app.zip`,
    `ToeRings_${version}_universal.app.zip`,
    `ToeRings_${version}_x64-setup.exe`,
    `ToeRings_${version}_x64-setup.exe.sha256`,
    `ToeRings_${version}_windows_x86_64_portable.zip`,
    `ToeRings_${version}_windows_x86_64_portable.zip.sha256`
  ]
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function assertExactFiles(dir, expected) {
  const names = readdirSync(dir).sort()
  const missing = expected.filter(name => !names.includes(name))
  const unexpected = names.filter(name => !expected.includes(name))
  if (missing.length || unexpected.length) {
    throw new Error(
      `Release files differ from the expected set; missing: ${JSON.stringify(missing)}, ` +
        `unexpected: ${JSON.stringify(unexpected)}`
    )
  }
  for (const name of expected) {
    if (!statSync(join(dir, name)).isFile() || statSync(join(dir, name)).size === 0) {
      throw new Error(`Release file is empty or not a regular file: ${name}`)
    }
  }
}

function assertCompanionChecksums(dir, assets) {
  for (const name of assets.filter(asset => asset.endsWith(".sha256"))) {
    const target = name.slice(0, -".sha256".length)
    const expected = `${sha256(join(dir, target))}  ${target}\n`
    if (readFileSync(join(dir, name), "utf8") !== expected) {
      throw new Error(`Checksum file does not match its asset: ${name}`)
    }
  }
}

// Candidate stage: require the complete bundle set, then record its digests once.
function writeChecksums(dir, version) {
  const assets = releaseAssets(version)
  assertExactFiles(dir, assets)
  assertCompanionChecksums(dir, assets)
  const lines = assets.map(name => `${sha256(join(dir, name))}  ${name}\n`)
  writeFileSync(join(dir, CHECKSUMS), lines.join(""))
}

// Publish stage: verify the downloaded candidate against its recorded digests.
// Never regenerate SHA256SUMS here; any difference rejects the candidate.
function verifyChecksums(dir, version) {
  const assets = releaseAssets(version)
  const names = [...assets, CHECKSUMS]
  assertExactFiles(dir, names)
  const recorded = readFileSync(join(dir, CHECKSUMS), "utf8").split("\n")
  if (recorded.pop() !== "" || recorded.length !== assets.length) {
    throw new Error(`${CHECKSUMS} must list exactly the ${assets.length} release assets`)
  }
  const digests = new Map()
  for (const line of recorded) {
    const match = line.match(/^([0-9a-f]{64}) {2}(\S+)$/)
    if (!match || !assets.includes(match[2]) || digests.has(match[2])) {
      throw new Error(`Invalid ${CHECKSUMS} entry: ${line}`)
    }
    digests.set(match[2], match[1])
  }
  for (const name of assets) {
    if (sha256(join(dir, name)) !== digests.get(name)) {
      throw new Error(`Release asset does not match its recorded checksum: ${name}`)
    }
  }
  assertCompanionChecksums(dir, assets)
  return names.map(name => ({
    name,
    path: join(dir, name),
    size: statSync(join(dir, name)).size,
    sha256: name === CHECKSUMS ? sha256(join(dir, name)) : digests.get(name)
  }))
}

function candidateRunId(message) {
  const lines = (message ?? "").split("\n").filter(line => line.startsWith("Candidate-Run:"))
  if (lines.length !== 1 || !/^Candidate-Run: [1-9]\d{0,15}$/.test(lines[0].trimEnd())) {
    throw new Error("Release tag must contain exactly one line: Candidate-Run: <workflow run ID>")
  }
  return Number(lines[0].slice("Candidate-Run: ".length))
}

function verifyCandidateRun(run, { repository, workflowId, commit, branch, runId }) {
  const expected = {
    id: runId,
    workflow_id: workflowId,
    path: RELEASE_WORKFLOW,
    event: "workflow_dispatch",
    status: "completed",
    conclusion: "success",
    // A rerun can replace artifacts under the same run ID, so only a fresh
    // first-attempt candidate identifies the bytes the maintainer tested.
    run_attempt: 1,
    head_sha: commit,
    head_branch: branch
  }
  for (const [key, value] of Object.entries(expected)) {
    if (run[key] !== value) {
      throw new Error(
        `Candidate run requires ${key}=${JSON.stringify(value)}; found ${JSON.stringify(run[key])}`
      )
    }
  }
  if (run.repository?.full_name !== repository || run.head_repository?.full_name !== repository) {
    throw new Error("Candidate run must originate in this repository")
  }
}

function selectCandidateArtifact(artifacts, runId, commit) {
  const matches = artifacts.filter(artifact => artifact.name === CANDIDATE_ARTIFACT)
  if (matches.length !== 1) {
    throw new Error(`Candidate run must contain exactly one ${CANDIDATE_ARTIFACT} artifact`)
  }
  const [artifact] = matches
  if (artifact.expired) {
    throw new Error(
      `Candidate ${CANDIDATE_ARTIFACT} artifact has expired; start a new manual candidate run`
    )
  }
  if (
    !(artifact.size_in_bytes > 0) ||
    artifact.workflow_run?.id !== runId ||
    artifact.workflow_run?.head_sha !== commit
  ) {
    throw new Error(`Candidate ${CANDIDATE_ARTIFACT} artifact is empty or belongs to another run`)
  }
  return artifact.id
}

// Resolves the annotated tag through the API so the message and target do not
// depend on how the checkout fetched tags.
async function resolveCandidate(github, repo, tag, branch) {
  const repository = `${repo.owner}/${repo.repo}`
  const { data: ref } = await github.rest.git.getRef({ ...repo, ref: `tags/${tag}` })
  if (ref.object.type !== "tag") {
    throw new Error("Release requires an annotated tag with a Candidate-Run line")
  }
  const { data: tagObject } = await github.rest.git.getTag({ ...repo, tag_sha: ref.object.sha })
  if (tagObject.tag !== tag || tagObject.object.type !== "commit") {
    throw new Error("Release tag must be an annotated tag that points directly to a commit")
  }
  const commit = tagObject.object.sha
  const runId = candidateRunId(tagObject.message)
  const { data: workflow } = await github.rest.actions.getWorkflow({
    ...repo,
    workflow_id: RELEASE_WORKFLOW.split("/").at(-1)
  })
  const { data: run } = await github.rest.actions.getWorkflowRun({ ...repo, run_id: runId })
  verifyCandidateRun(run, { repository, workflowId: workflow.id, commit, branch, runId })
  const artifacts = await github.paginate(github.rest.actions.listWorkflowRunArtifacts, {
    ...repo,
    run_id: runId,
    per_page: 100
  })
  return { commit, runId, artifactId: selectCandidateArtifact(artifacts, runId, commit) }
}

function assertUploadedAssets(assets, files) {
  const names = assets.map(asset => asset.name).sort()
  if (JSON.stringify(names) !== JSON.stringify(files.map(file => file.name).sort())) {
    throw new Error(`Draft release does not contain the exact asset set: ${JSON.stringify(names)}`)
  }
  for (const file of files) {
    const asset = assets.find(candidate => candidate.name === file.name)
    if (
      asset.state !== "uploaded" ||
      asset.size !== file.size ||
      (asset.digest && asset.digest !== `sha256:${file.sha256}`)
    ) {
      throw new Error(`Uploaded release asset does not match the candidate: ${file.name}`)
    }
  }
}

// Uploads the verified candidate files unchanged and publishes only after the
// draft holds exactly those bytes. Retries replace assets of our own draft.
async function publishRelease(github, repo, tag, commit, body, files) {
  const releaseId = await ensureDraft(github, repo, tag, commit, body)
  const listAssets = () =>
    github.paginate(github.rest.repos.listReleaseAssets, {
      ...repo,
      release_id: releaseId,
      per_page: 100
    })
  for (const asset of await listAssets()) {
    await github.rest.repos.deleteReleaseAsset({ ...repo, asset_id: asset.id })
  }
  for (const file of files) {
    await github.rest.repos.uploadReleaseAsset({
      ...repo,
      release_id: releaseId,
      name: file.name,
      data: readFileSync(file.path),
      headers: { "content-type": "application/octet-stream", "content-length": file.size }
    })
  }
  const { data } = await github.rest.repos.getRelease({ ...repo, release_id: releaseId })
  assertDraft(data, tag, commit)
  await assertTag(github, repo, tag, commit)
  assertUploadedAssets(await listAssets(), files)
  await github.rest.repos.updateRelease({
    ...repo,
    release_id: releaseId,
    draft: false,
    prerelease: false
  })
  return releaseId
}

function candidateSummary({ version, commit, runId, retentionDays }) {
  const tag = `v${version}`
  return [
    "### Candidate ready for verification",
    "",
    `Version \`${version}\` from commit \`${commit}\`, candidate run \`${runId}\`.`,
    "",
    `After this run succeeds, download and test its complete \`${CANDIDATE_ARTIFACT}\` artifact.`,
    "",
    "When satisfied, run these commands in your local checkout:",
    "",
    "```bash",
    `git tag -a ${tag} ${commit} \\`,
    `  -m "ToeRings ${version}" \\`,
    `  -m "Candidate-Run: ${runId}"`,
    "",
    `git push origin ${tag}`,
    "```",
    "",
    "The tag push publishes the bytes of this candidate without rebuilding them.",
    "",
    `- The \`${CANDIDATE_ARTIFACT}\` artifact is retained for ${retentionDays} days ` +
      "(subject to repository limits). Publish before it expires.",
    "- A new candidate requires a new manual run of this workflow. Do not rerun this run as a " +
      "substitute; reruns are rejected at publication.",
    "- Test and approve the artifacts before creating the tag.",
    ""
  ].join("\n")
}

module.exports = {
  CHECKSUMS,
  validateVersions,
  assertDraft,
  assertTag,
  ensureDraft,
  releaseAssets,
  writeChecksums,
  verifyChecksums,
  candidateRunId,
  verifyCandidateRun,
  selectCandidateArtifact,
  resolveCandidate,
  assertUploadedAssets,
  publishRelease,
  candidateSummary
}
