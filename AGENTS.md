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
  release candidate; an annotated version tag publishes that candidate's exact artifacts
  and requests downstream package-manager updates.

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
  Universal, and Windows x64 artifacts.
- Do not push, tag, publish a release, or open a pull request unless the user requests it.
- A direct request such as `create release 0.0.1` is explicit authorization for the release
  procedure below up to the candidate: version edits, verification, commit, pushing the
  commit, and starting the candidate workflow. Create and push the tag only after the user
  has tested and approved that candidate.
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
   `SHA256SUMS` file as the `release-assets` artifact for 30 days. It never creates tags,
   releases, or package-repository updates. Monitor it to completion and report its URL.
   Its job summary contains the exact tag commands for that commit and run.

10. Stop and ask the user to download and test the `release-assets` artifact. Do not tag
    before the user approves the candidate. After approval, create the annotated tag on the
    candidate commit exactly as printed in the summary and push only that tag:

    ```sh
    git tag -a vX.Y.Z <CANDIDATE_COMMIT> \
      -m "ToeRings X.Y.Z" \
      -m "Candidate-Run: <RUN_ID>"

    git push origin vX.Y.Z
    ```

    Never rerun a candidate run as a substitute for a new one: publication rejects reruns,
    failed or incomplete runs, runs of another workflow, branch, or commit, and expired
    artifacts. A rejected or expired candidate requires a new manual workflow run.

11. The tag push starts the publishing stage of `.github/workflows/release.yml`. It verifies
    the annotated tag, the `Candidate-Run` workflow run, and every `SHA256SUMS` digest,
    then uploads those exact files to a draft GitHub release and publishes it. It does not
    rebuild. After publication, independent jobs request the Scoop and Homebrew updates and
    submit the versioned NSIS installer to WinGet. WinGet publishing requires the
    `WINGET_TOKEN` repository secret and an existing package version in the official WinGet
    community repository.
12. Monitor the publish workflow to completion and report the commit, tag, candidate run,
    workflow URL, release URL, artifact status, and Homebrew cask pull request status. After
    the GitHub release is published, `.github/workflows/release.yml` dispatches an
    `update-cask` event to
    [`ChrisLauinger77/homebrew-cask`](https://github.com/ChrisLauinger77/homebrew-cask).
    The tap automation opens a pull request; the cask is updated only after that pull request
    is merged. Verify that the dispatch succeeds and report the resulting pull request URL
    and status. Do not modify the tap or merge its pull request unless the user explicitly
    requests it. If publishing fails after the tag is pushed, preserve the tag and draft
    release, diagnose the failure, and do not delete or retarget the tag without explicit
    user confirmation.

There is currently no changelog or release-notes file. Do not invent one during a routine
version release unless the user asks for it.
