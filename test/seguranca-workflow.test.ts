import { describe, expect, it } from "@effect/vitest"
import { readFileSync } from "node:fs"

// The run scripts of the three tool steps, read as text. Actions runs `run:` with `bash -e`, so a
// script that records the tool's exit code must turn -e off itself: otherwise a tool that exits
// non-zero because it found something kills the step before `echo $?`, and the later tools skip.
const workflow = readFileSync(new URL("../.github/workflows/seguranca.yml", import.meta.url), "utf8")

const runDoPasso = (nome: string): string => {
  const inicio = workflow.indexOf(`      - name: ${nome}\n`)
  expect(inicio).toBeGreaterThan(-1)
  const fim = workflow.indexOf("\n      - name: ", inicio + 1)
  const passo = workflow.slice(inicio, fim === -1 ? undefined : fim)
  const run = passo.indexOf("        run: |\n")
  expect(run).toBeGreaterThan(-1)
  return passo.slice(run)
}

describe("seguranca.yml", () => {
  for (const nome of ["OSV-Scanner", "gitleaks", "Semgrep"]) {
    it(`o passo ${nome} desliga o -e antes de rodar a ferramenta`, () => {
      const linhas = runDoPasso(nome).split("\n")
      expect(linhas[1]?.trim()).toBe("set +e -uo pipefail")
      expect(runDoPasso(nome)).toMatch(/echo \$\? > "\$out\/[a-z-]+\.exit"/)
    })
  }

  it("o Semgrep instala com hash, do requirements deste repo", () => {
    const passo = runDoPasso("Instalar Semgrep")
    expect(passo).toContain("--require-hashes")
    expect(passo).toContain("-r .seguranca-ci/dist/semgrep-requirements.txt")
    const req = readFileSync(new URL("../dist/semgrep-requirements.txt", import.meta.url), "utf8")
    expect(req).toMatch(/^semgrep==\d+\.\d+\.\d+ \\$/m)
  })
})
