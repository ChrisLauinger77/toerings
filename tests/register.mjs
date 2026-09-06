import { registerHooks } from "node:module"
import { readFileSync } from "node:fs"
import ts from "typescript"
import { compile } from "svelte/compiler"

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (specifier.startsWith(".") && !specifier.split("/").at(-1).includes(".")) {
        return nextResolve(`${specifier}.ts`, context)
      }
      throw error
    }
  },
  load(url, context, nextLoad) {
    const path = new URL(url).pathname
    if (path.endsWith(".ts") || path.endsWith(".svelte")) {
      const source = readFileSync(new URL(url), "utf8")
      const code = path.endsWith(".svelte")
        ? compile(source, { filename: new URL(url).pathname, generate: "server" }).js.code
        : ts.transpileModule(source, {
            compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
          }).outputText
      return { format: "module", source: code, shortCircuit: true }
    }
    return nextLoad(url, context)
  }
})
