import { describe, expect, it } from "vitest"
import { sensiveis, situacaoGitleaks, situacaoOsv, situacaoSemgrep, supressoesNaLinha } from "../src/seguranca/achados.js"

// Shapes taken from real runs of osv-scanner 2.7.0, semgrep 1.184.0 and gitleaks 8.30.1.
const osv = (raiz: string, pacotes: Array<{ nome: string; versao: string; ids: string[]; aliases?: string[] }>) =>
  JSON.stringify({
    results: [{
      source: { path: `${raiz}/package-lock.json`, type: "lockfile" },
      packages: pacotes.map((p) => ({
        package: { name: p.nome, version: p.versao, ecosystem: "npm" },
        groups: [{ ids: p.ids, aliases: p.aliases ?? p.ids, max_severity: "9.8" }],
        vulnerabilities: p.ids.map((id) => ({ id, summary: `resumo de ${id}`, aliases: p.aliases ?? [] })),
      })),
    }],
    experimental_config: {},
  })

const ok = (json: string) => ({ exit: "1\n", json })

describe("situacaoOsv", () => {
  it("no diff, só o que o head tem e a base não, com caminho relativo", () => {
    const head = ok(osv("/w/projeto", [
      { nome: "minimist", versao: "1.2.5", ids: ["GHSA-xvch-5gv4-984h"], aliases: ["CVE-2021-44906"] },
      { nome: "lodash", versao: "4.17.15", ids: ["GHSA-p6mc-m468-83gw"] },
    ]))
    const base = ok(osv("/t/base", [{ nome: "lodash", versao: "4.17.11", ids: ["GHSA-p6mc-m468-83gw"] }]))
    const s = situacaoOsv(head, base, { head: "/w/projeto", base: "/t/base" })
    expect(s).toEqual({
      _tag: "Rodou",
      achados: [{
        ferramenta: "osv",
        arquivo: "package-lock.json",
        linha: undefined,
        regra: "GHSA-xvch-5gv4-984h",
        severidade: "9.8",
        mensagem: "minimist@1.2.5: resumo de GHSA-xvch-5gv4-984h",
        link: "https://osv.dev/vulnerability/GHSA-xvch-5gv4-984h",
      }],
    })
  })

  it("um alias em comum com a base conta como o mesmo achado", () => {
    const head = ok(osv("/h", [{ nome: "minimist", versao: "1.2.5", ids: ["GHSA-a"], aliases: ["CVE-1"] }]))
    const base = ok(osv("/b", [{ nome: "minimist", versao: "1.2.0", ids: ["CVE-1"] }]))
    expect(situacaoOsv(head, base, { head: "/h", base: "/b" })).toEqual({ _tag: "Rodou", achados: [] })
  })

  it("sem base (varredura completa), tudo o que o head tem", () => {
    const head = ok(osv("/h", [{ nome: "a", versao: "1", ids: ["X-1"] }, { nome: "b", versao: "2", ids: ["X-2"] }]))
    const s = situacaoOsv(head, undefined, { head: "/h", base: "" })
    expect(s._tag === "Rodou" && s.achados.map((a) => a.regra)).toEqual(["X-1", "X-2"])
  })

  it("exit 0 sem lockfile é zero achados", () => {
    expect(situacaoOsv({ exit: "0", json: '{"results":[]}' }, undefined, { head: "/h", base: "" })).toEqual({
      _tag: "Rodou",
      achados: [],
    })
  })

  it("exit desconhecido, passo que não terminou, JSON quebrado e erro na base", () => {
    const r = { head: "/h", base: "/b" }
    expect(situacaoOsv({ exit: "127", json: "" }, undefined, r)).toEqual({ _tag: "Erro", motivo: "saiu com código 127" })
    expect(situacaoOsv({ exit: undefined, json: undefined }, undefined, r)).toEqual({
      _tag: "Erro",
      motivo: "o passo não terminou",
    })
    expect(situacaoOsv({ exit: "0", json: "{" }, undefined, r)).toEqual({ _tag: "Erro", motivo: "o relatório não é JSON" })
    expect(situacaoOsv(ok('{"results":[]}'), { exit: "2", json: "" }, r)).toEqual({
      _tag: "Erro",
      motivo: "na base: saiu com código 2",
    })
  })
})

describe("situacaoSemgrep", () => {
  it("lê regra, local, severidade e o link curto da regra", () => {
    const json = JSON.stringify({
      version: "1.184.0",
      results: [{
        check_id: "javascript.browser.security.eval-detected.eval-detected",
        path: "src/b.js",
        start: { line: 2, col: 18, offset: 53 },
        end: { line: 2, col: 35, offset: 70 },
        extra: {
          message: "Detected the use of eval().\nMore text.",
          severity: "WARNING",
          metadata: { source: "https://semgrep.dev/r/x", shortlink: "https://sg.run/7ope" },
          lines: "requires login",
        },
      }],
      errors: [],
      paths: { scanned: ["src/b.js"] },
    })
    expect(situacaoSemgrep({ exit: "0", json })).toEqual({
      _tag: "Rodou",
      achados: [{
        ferramenta: "semgrep",
        arquivo: "src/b.js",
        linha: 2,
        regra: "javascript.browser.security.eval-detected.eval-detected",
        severidade: "WARNING",
        mensagem: "Detected the use of eval().",
        link: "https://sg.run/7ope",
      }],
    })
  })

  it("qualquer exit diferente de 0 é erro", () => {
    expect(situacaoSemgrep({ exit: "2", json: "{}" })).toEqual({ _tag: "Erro", motivo: "saiu com código 2" })
  })

  it("relatório sem results é formato inesperado", () => {
    expect(situacaoSemgrep({ exit: "0", json: "{}" })).toEqual({
      _tag: "Erro",
      motivo: "o relatório tem um formato inesperado",
    })
  })
})

describe("situacaoGitleaks", () => {
  it("nunca usa Secret nem Match, só a regra, o local, o commit e o fingerprint", () => {
    const json = JSON.stringify([{
      RuleID: "github-pat",
      Description: "Uncovered a GitHub Personal Access Token.",
      StartLine: 3,
      EndLine: 3,
      Match: "REDACTED",
      Secret: "REDACTED",
      File: "b.js",
      Commit: "7546582c225af54b58b9f9de0d68e87d8c39eedf",
      Fingerprint: "7546582c225af54b58b9f9de0d68e87d8c39eedf:b.js:github-pat:3",
    }])
    const s = situacaoGitleaks({ exit: "0", json })
    expect(s).toEqual({
      _tag: "Rodou",
      achados: [{
        ferramenta: "gitleaks",
        arquivo: "b.js",
        linha: 3,
        regra: "github-pat",
        severidade: "segredo",
        mensagem:
          "Uncovered a GitHub Personal Access Token.; commit 7546582; fingerprint 7546582c225af54b58b9f9de0d68e87d8c39eedf:b.js:github-pat:3",
        link: undefined,
      }],
    })
    expect(JSON.stringify(s)).not.toContain("REDACTED")
  })

  it("relatório vazio é zero achados; exit 1 é erro", () => {
    expect(situacaoGitleaks({ exit: "0", json: "[]" })).toEqual({ _tag: "Rodou", achados: [] })
    expect(situacaoGitleaks({ exit: "1", json: "[]" })).toEqual({ _tag: "Erro", motivo: "saiu com código 1" })
  })
})

describe("sensiveis", () => {
  it("pega os arquivos de supressão em qualquer pasta e o caller", () => {
    expect(sensiveis([
      "src/a.ts",
      "osv-scanner.toml",
      "app/osv-scanner.toml",
      ".semgrepignore",
      ".gitleaksignore",
      ".gitleaks.toml",
      ".github/workflows/seguranca.yml",
      "docs/gitleaks.md",
    ])).toEqual([
      "osv-scanner.toml",
      "app/osv-scanner.toml",
      ".semgrepignore",
      ".gitleaksignore",
      ".gitleaks.toml",
      ".github/workflows/seguranca.yml",
    ])
  })
})

describe("supressoesNaLinha", () => {
  it("lê arquivo, linha e marcador e ignora linhas quebradas", () => {
    expect(supressoesNaLinha("a.js\t4\tnosemgrep\n\nb.py\tx\tnosem\nc.txt\t0\tgitleaks:allow\nd.go\t9\tgitleaks:allow")).toEqual([
      { arquivo: "a.js", linha: 4, marcador: "nosemgrep" },
      { arquivo: "d.go", linha: 9, marcador: "gitleaks:allow" },
    ])
  })
})
