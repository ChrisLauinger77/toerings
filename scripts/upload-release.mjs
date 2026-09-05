import { execFileSync } from "node:child_process"
import release from "../.github/scripts/release.cjs"

const tag = process.env.GITHUB_REF_NAME
release.validateVersions(tag)
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
const metadata = JSON.parse(
  execFileSync("gh", ["release", "view", tag, "--json", "isDraft,tagName,body"], {
    encoding: "utf8"
  })
)
release.assertDraft(
  {
    draft: metadata.isDraft,
    tag_name: metadata.tagName,
    body: metadata.body
  },
  tag,
  commit
)
const tagCommit = execFileSync(
  "gh",
  ["api", `repos/{owner}/{repo}/commits/${tag}`, "--jq", ".sha"],
  { encoding: "utf8" }
).trim()
if (tagCommit !== commit) throw new Error("Release tag no longer points to the checked-out commit")
const paths = process.argv.slice(2)
if (!paths.length) throw new Error("No release assets supplied")
execFileSync("gh", ["release", "upload", tag, ...paths, "--clobber"], { stdio: "inherit" })
