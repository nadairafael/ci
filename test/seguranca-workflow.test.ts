import { describe, expect, it } from "@effect/vitest"
import { readFileSync } from "node:fs"

// The run scripts of the three tool steps, read as text. Actions runs `run:` with `bash -e`, so a
// script that records the tool's exit code must turn -e off itself: otherwise a tool that exits
// non-zero because it found something kills the step before `echo $?`, and the later tools skip.
const workflow = readFileSync(new URL("../.github/workflows/seguranca.yml", import.meta.url), "utf8")

const runDoPasso = (nome: string): string | undefined => {
  const inicio = workflow.indexOf(`      - name: ${nome}\n`)
  if (inicio === -1) return undefined
  const fim = workflow.indexOf("\n      - name: ", inicio + 1)
  const passo = workflow.slice(inicio, fim === -1 ? undefined : fim)
  const run = passo.indexOf("        run: |\n")
  return run === -1 ? undefined : passo.slice(run)
}

describe("seguranca.yml", () => {
  it("cada passo de ferramenta desliga o -e antes de rodar e grava o exit", () => {
    const violacoes = ["OSV-Scanner", "gitleaks", "Semgrep"].flatMap((nome) => {
      const run = runDoPasso(nome)
      if (run === undefined) return [`${nome}: passo com run não encontrado`]
      return [
        ...(run.split("\n")[1]?.trim() === "set +e -uo pipefail" ? [] : [`${nome}: não começa com «set +e -uo pipefail»`]),
        ...(/echo \$\? > "\$out\/[a-z-]+\.exit"/.test(run) ? [] : [`${nome}: não grava o exit em $out/<nome>.exit`]),
      ]
    })
    expect(violacoes).toEqual([])
  })

  it("o Semgrep instala com hash, do requirements deste repo", () => {
    const passo = runDoPasso("Instalar Semgrep") ?? ""
    expect(passo).toContain("--require-hashes")
    expect(passo).toContain("-r .seguranca-ci/dist/semgrep-requirements.txt")
    const req = readFileSync(new URL("../dist/semgrep-requirements.txt", import.meta.url), "utf8")
    expect(req).toMatch(/^semgrep==\d+\.\d+\.\d+ \\$/m)
  })
})
