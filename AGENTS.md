# Repository Guide

## Project overview

ToeRings is a desktop system monitor built with Tauri 1. The frontend uses Svelte 3,
TypeScript, and Vite. The Rust backend gathers system information and exposes it to the
frontend through a Tauri command.

- `src/`: Svelte application, widgets, styles, actions, and stores.
- `src/lib/stores.ts`: persisted color and font preferences.
- `src-tauri/src/`: Rust application and system-data collectors.
- `src-tauri/tauri.conf.json`: Tauri 1 application and bundle configuration.
- `.github/workflows/build.yml`: pull-request and manually dispatched builds.
- `.github/workflows/publish.yml`: tag-triggered release builds and publishing.

Keep this application on Tauri 1 unless a task explicitly requests a separate Tauri 2
migration. Do not mix migration work into maintenance or release changes.

## Development conventions

- Use English for code comments and documentation.
- Use double quotes in JavaScript, TypeScript, Svelte, JSON, and new YAML strings.
- Follow the existing Prettier configuration: no semicolons, no trailing commas, and a
  100-character print width.
- Keep changes focused and preserve unrelated user changes in a dirty worktree.
- Use `npm ci` for reproducible dependency installation.
- Use `npm run build` for the frontend production build.
- Use `npm run tauri build -- --bundles app` for a local Tauri 1 application bundle.
- Run `npm run check` when changing frontend code. The repository may contain existing
  diagnostics; distinguish new errors from the established baseline.
- Linux CI uses Rust 1.66.1 because the Tauri 1 dependency set does not compile reliably
  with newer Rust releases. macOS CI uses stable Rust for Apple Silicon and Universal
  builds.

## Git and GitHub workflow

- Do feature work on a `codex/` branch unless the user specifies another branch.
- Pull requests run `.github/workflows/build.yml` for Linux x86_64, macOS arm64, and macOS
  Universal artifacts.
- Do not push, tag, publish a release, or open a pull request unless the user requests it.
- A direct request such as `create release 0.0.1` is explicit authorization for the full
  release procedure below: version edits, verification, commit, tag creation, and pushing
  the commit and tag.
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
   - `src-tauri/tauri.conf.json` under `package.version`

   Prefer `npm version X.Y.Z --no-git-tag-version` for the npm files. Update the Tauri and
   Cargo manifests deliberately, then let an appropriate Cargo check or build refresh the
   lockfile. Do not change dependency versions merely because they contain the old number.

5. Verify version consistency with a focused search or script. All five sources above must
   report `X.Y.Z` before committing.
6. Run the release checks:

   - `npm ci` when dependencies are not already installed from the lockfile
   - `npm run build`
   - `npm run check`, comparing failures with the known baseline
   - `npm run tauri build -- --bundles app`

   Do not tag a commit if a new relevant build or type-check failure remains unresolved.

7. Review the complete diff. A routine version-only release should contain only the five
   version files listed above. Include other release changes only when the user explicitly
   requested them or they are already the intended, reviewed release contents.
8. Commit the release as `Release X.Y.Z`.
9. Create an annotated tag on that commit:

   ```sh
   git tag -a vX.Y.Z -m "ToeRings vX.Y.Z"
   ```

10. Push the release commit first, then push the exact tag to `origin`. The tag push starts
    `.github/workflows/publish.yml`, which creates a draft GitHub release, attaches Linux,
    macOS arm64, and macOS Universal bundles, and publishes the release only after all
    build jobs succeed.
11. Monitor the publish workflow to completion and report the commit, tag, workflow URL,
    release URL, and artifact status. If publishing fails after the tag is pushed, preserve
    the tag and draft release, diagnose the failure, and do not delete or retarget the tag
    without explicit user confirmation.

There is currently no changelog or release-notes file. Do not invent one during a routine
version release unless the user asks for it.
