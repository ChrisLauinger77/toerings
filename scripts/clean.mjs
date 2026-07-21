import { rmSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const buildDirectories = ["dist", "dist-ssr", "src-tauri/target", "src-tauri/gen"]

for (const directory of buildDirectories) {
  rmSync(resolve(projectRoot, directory), { force: true, recursive: true })
  console.log(`Removed ${directory}`)
}
