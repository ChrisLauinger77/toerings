# Repository Guide

## Project overview

ToeRings is a desktop system monitor built with Tauri 2. The frontend uses Svelte 5,
TypeScript, and Vite. The Rust backend gathers system information and exposes it to the
frontend through a Tauri command.

- `src/`: Svelte application, widgets, styles, actions, and stores.
- `src/lib/stores.ts`: persisted color and font preferences.
- `src-tauri/src/`: Rust application and system-data collectors.
- `src-tauri/tauri.conf.json`: Tauri 2 application and bundle configuration.
- `.github/workflows/ci.yml`: pull-request and manually dispatched builds for Linux,
  macOS, and Windows.
- `.github/workflows/release.yml`: two-stage release. A manual run builds and verifies a
  release candidate, then waits for approval of the `release` environment; approval creates
  the annotated version tag, publishes that run's exact artifacts, and requests downstream
  package-manager updates.

Keep framework and frontend upgrades separate from Tauri maintenance. Do not mix Svelte,
Vite, or TypeScript modernization into Tauri migration or release changes.

## Development conventions

- Use English for code comments and documentation.
- Use double quotes in JavaScript, TypeScript, Svelte, JSON, and new YAML strings.
- Follow the existing Prettier configuration: no semicolons, no trailing commas, and a
  100-character print width.
- Keep changes focused and preserve unrelated user changes in a dirty worktree.
- Use `npm ci` for reproducible dependency installation.
- Use `npm run build` for the frontend production build.
- Use `npm run tauri build` for the platform's configured local bundles.
- Linux AppImages must be passed through `scripts/repack-appimage.sh` before distribution;
  this prevents bundled Wayland and GLib infrastructure libraries from conflicting with
  newer host graphics stacks.
- Prebuilt Linux artifacts target Ubuntu 24.04 and may require glibc 2.39 or newer. Keep the
  Linux runners in both build workflows and the Ubuntu image in
  `scripts/validate-linux-bundles.sh` aligned. Changing this baseline changes the minimum
  supported Linux version and must also be documented in the README.
- Run `npm run check` when changing frontend code. The repository may contain existing
  diagnostics; distinguish new errors from the established baseline.
- Linux and macOS CI use stable Rust. Linux builds against WebKitGTK 4.1, the runtime used
  by Tauri 2.
- macOS bundles use the ad-hoc signing identity `"-"`. Strict signature verification must
  pass in CI, but the builds are not notarized and require the first-launch Gatekeeper
  steps documented in the README.

## Git and GitHub workflow

- Do feature work on a `codex/` branch unless the user specifies another branch.
- Pull requests run `.github/workflows/ci.yml` for Linux x86_64, macOS arm64, macOS
  Universal, and Windows x64 builds. CI does not upload artifacts; distributable files come
  only from `.github/workflows/release.yml`.
- Do not push, tag, publish a release, or open a pull request on your own initiative. Only do
  so when the user's prompt explicitly instructs you to.
- A direct request such as `create release 0.0.1` is explicit authorization for the release
  procedure below up to the candidate: version edits, verification, commit, pushing the
  commit, and starting the candidate workflow. Only the user approves the `release`
  environment deployment; never approve, reject, or bypass it yourself.
- Never create, move, overwrite, or delete a release tag speculatively.

## Release procedure

Interpret `create release X.Y.Z` as a request for a normal stable SemVer release. Use the
canonical tag `vX.Y.Z`; for example, `create release 0.0.1` creates `v0.0.1`.

1. Validate that the requested version is exactly `X.Y.Z` and has no leading `v` unless
   the user explicitly supplied a tag.
2. Check the worktree, current branch, remotes, and local and remote tags. Release from the
   default branch unless the user explicitly names another source branch. Do not hide or
   include unrelated changes. Stop if the worktree is dirty in a way that makes the
   release commit ambiguous.
3. Fetch current remote state and confirm that `vX.Y.Z` does not already exist locally or
   on `origin`. Never reuse an existing version or move an existing tag without explicit
   confirmation.
4. Update every application version source to exactly `X.Y.Z`:

   - `package.json`
   - the top-level version and root-package version in `package-lock.json`
   - `src-tauri/Cargo.toml` under `[package]`
   - the `toerings` package entry in `src-tauri/Cargo.lock`
   - `src-tauri/tauri.conf.json` under the root `version` field

   Prefer `npm version X.Y.Z --no-git-tag-version` for the npm files. Update the Tauri and
   Cargo manifests deliberately, then let an appropriate Cargo check or build refresh the
   lockfile. Do not change dependency versions merely because they contain the old number.

5. Verify version consistency with a focused search or script. All five sources above must
   report `X.Y.Z` before committing.
6. Run the release checks:

   - `npm ci` when dependencies are not already installed from the lockfile
   - `npm run build`
   - `npm run check`, comparing failures with the known baseline
   - `cargo test --locked --manifest-path src-tauri/Cargo.toml`

   Do not run `npm run tauri build` as part of the local release procedure. The publish
   workflow builds and validates the configured Linux, macOS, and Windows bundles. Do not
   tag a commit if a new relevant build, type-check, or Rust test failure remains unresolved.

7. Review the complete diff. A routine version-only release should contain only the five
   version files listed above. Include other release changes only when the user explicitly
   requested them or they are already the intended, reviewed release contents.
8. Commit the release as `Release X.Y.Z` and push it to the default branch.
9. Start a candidate build from the default branch:

   ```sh
   gh workflow run release.yml --ref main
   ```

   The candidate run validates the version sources, runs the frontend and Rust checks,
   builds and validates the Linux DEB, RPM, and AppImage, macOS arm64 and Universal app
   archives, and the Windows x64 NSIS installer and portable ZIP, then uploads them with a
   `SHA256SUMS` file as the `release-assets` artifact for 30 days. It then pauses at the
   `approve-and-tag` job, which requires approval of the `release` environment. Monitor it
   until it is waiting for approval and report its URL.

10. Stop and ask the user to download and test the `release-assets` artifact and, when
    satisfied, approve the `release` environment in the run's **Review deployments** dialog.
    Approval makes `approve-and-tag` create the annotated tag as `github-actions[bot]`:

    ```sh
    git tag -a vX.Y.Z <CANDIDATE_COMMIT> \
      -m "ToeRings X.Y.Z" \
      -m "Candidate-Run: <RUN_ID>"
    ```

    It pushes only that tag and fails if the tag already exists locally or on `origin`.
    Do not create or push release tags manually; a manually pushed tag does not publish
    anything. Never rerun a candidate run as a substitute for a new one: tagging rejects
    reruns. A rejected or expired candidate requires a new manual workflow run.

11. After tagging, the same run continues with the publishing stage. It downloads that run's
    `release-assets` artifact, verifies every `SHA256SUMS` digest, then uploads those exact
    files to a draft GitHub release and publishes it. It does not rebuild. After
    publication, independent jobs request the Scoop and Homebrew updates and submit the
    versioned NSIS installer to WinGet. WinGet publishing requires the `WINGET_TOKEN`
    repository secret and an existing package version in the official WinGet community
    repository.
12. Monitor the run to completion and report the commit, tag, candidate run,
    workflow URL, release URL, artifact status, and Homebrew cask pull request status. After
    the GitHub release is published, `.github/workflows/release.yml` dispatches an
    `update-cask` event to
    [`ChrisLauinger77/homebrew-cask`](https://github.com/ChrisLauinger77/homebrew-cask).
    The tap automation opens a pull request; the cask is updated only after that pull request
    is merged. Verify that the dispatch succeeds and report the resulting pull request URL
    and status. Do not modify the tap or merge its pull request unless the user explicitly
    requests it. If publishing fails after the tag is created, preserve the tag and draft
    release, diagnose the failure, and do not delete or retarget the tag without explicit
    user confirmation.

There is currently no changelog or release-notes file. Do not invent one during a routine
version release unless the user asks for it.
