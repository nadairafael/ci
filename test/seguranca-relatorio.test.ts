import { describe, expect, it } from "vitest"
import type { Achado, Situacao } from "../src/seguranca/achados.js"
import {
  anotacoes,
  aprovado,
  comentario,
  descricaoStatus,
  MARCADOR_SEGURANCA,
  type Resultado,
  summary,
} from "../src/seguranca/relatorio.js"

const SEMGREP: Achado = {
  ferramenta: "semgrep",
  arquivo: "src/b.js",
  linha: 2,
  regra: "js.eval-detected",
  severidade: "WARNING",
  mensagem: "Detected the use of eval().",
  link: "https://sg.run/7ope",
}
const OSV: Achado = {
  ferramenta: "osv",
  arquivo: "package-lock.json",
  linha: undefined,
  regra: "GHSA-xvch-5gv4-984h",
  severidade: "9.8",
  mensagem: "minimist@1.2.5: Prototype Pollution",
  link: "https://osv.dev/vulnerability/GHSA-xvch-5gv4-984h",
}
const rodou = (...achados: Achado[]): Situacao => ({ _tag: "Rodou", achados })

const res = (over: Partial<Resultado> = {}): Resultado => ({
  escopo: "diff",
  bloquear: false,
  situacoes: { osv: rodou(), semgrep: rodou(), gitleaks: rodou() },
  sensiveis: [],
  ...over,
})

describe("descricaoStatus", () => {
  it("sem achados", () => {
    expect(descricaoStatus(res())).toBe("nenhum achado novo")
  })

  it("só aviso com achados", () => {
    expect(descricaoStatus(res({ situacoes: { osv: rodou(OSV), semgrep: rodou(SEMGREP), gitleaks: rodou() } }))).toBe(
      "2 achados novos (só aviso)",
    )
  })

  it("bloqueando com 1 achado", () => {
    expect(descricaoStatus(res({ bloquear: true, situacoes: { osv: rodou(OSV), semgrep: rodou(), gitleaks: rodou() } })))
      .toBe("1 achado novo")
  })

  it("ferramenta que não rodou e Semgrep pulado no rascunho", () => {
    expect(descricaoStatus(res({
      situacoes: { osv: { _tag: "Erro", motivo: "saiu com código 2" }, semgrep: { _tag: "Rascunho" }, gitleaks: rodou() },
    }))).toBe("nenhum achado novo; não rodou: OSV-Scanner; Semgrep pulado no rascunho (só aviso)")
  })

  it("rascunho limpo não é aviso", () => {
    expect(descricaoStatus(res({ situacoes: { osv: rodou(), semgrep: { _tag: "Rascunho" }, gitleaks: rodou() } }))).toBe(
      "nenhum achado novo; Semgrep pulado no rascunho",
    )
  })
})

describe("aprovado", () => {
  it("sem bloquear, sempre aprova", () => {
    expect(aprovado(res({ situacoes: { osv: rodou(OSV), semgrep: { _tag: "Erro", motivo: "x" }, gitleaks: rodou() } })))
      .toBe(true)
  })

  it("bloqueando, achado ou ferramenta com erro reprova; rascunho e fora não", () => {
    expect(aprovado(res({ bloquear: true, situacoes: { osv: rodou(OSV), semgrep: rodou(), gitleaks: rodou() } }))).toBe(false)
    expect(aprovado(res({ bloquear: true, situacoes: { osv: { _tag: "Erro", motivo: "x" }, semgrep: rodou(), gitleaks: rodou() } })))
      .toBe(false)
    expect(aprovado(res({ bloquear: true, situacoes: { osv: { _tag: "Fora" }, semgrep: { _tag: "Rascunho" }, gitleaks: rodou() } })))
      .toBe(true)
  })
})

describe("summary", () => {
  it("fixa o texto inteiro com achados, ferramenta fora e aviso de supressão", () => {
    const s = summary(res({
      situacoes: { osv: rodou(OSV), semgrep: rodou(SEMGREP), gitleaks: { _tag: "Fora" } },
      sensiveis: [".semgrepignore"],
    }))
    expect(s).toBe([
      "⚠️ **Segurança:** 2 achados novos (só aviso).",
      "",
      "Escopo: **diff**, só o que o PR introduziu em relação à base.",
      "",
      "| Ferramenta | Situação | Achados |",
      "|---|---|---|",
      "| OSV-Scanner | rodou | 1 |",
      "| Semgrep | rodou | 1 |",
      "| gitleaks | fora (input `ferramentas`) | — |",
      "",
      "### OSV-Scanner",
      "",
      "| Arquivo | Linha | Regra | Severidade | O quê |",
      "|---|---|---|---|---|",
      "| `package-lock.json` | — | [GHSA-xvch-5gv4-984h](https://osv.dev/vulnerability/GHSA-xvch-5gv4-984h) | 9.8 | minimist@1.2.5: Prototype Pollution |",
      "",
      "### Semgrep",
      "",
      "| Arquivo | Linha | Regra | Severidade | O quê |",
      "|---|---|---|---|---|",
      "| `src/b.js` | 2 | [js.eval-detected](https://sg.run/7ope) | WARNING | Detected the use of eval(). |",
      "",
      "⚠️ Este PR mexe na supressão de achados (.semgrepignore): precisa de olho humano. Supressões novas só valem depois do merge.",
    ].join("\n"))
  })

  it("varredura completa limpa", () => {
    expect(summary(res({ escopo: "completo" }))).toBe([
      "✅ **Segurança:** nenhum achado.",
      "",
      "Escopo: **completo**, o repo inteiro.",
      "",
      "| Ferramenta | Situação | Achados |",
      "|---|---|---|",
      "| OSV-Scanner | rodou | 0 |",
      "| Semgrep | rodou | 0 |",
      "| gitleaks | rodou | 0 |",
    ].join("\n"))
  })

  it("escapa a barra vertical nas células", () => {
    const s = summary(res({ situacoes: { osv: rodou(), semgrep: rodou({ ...SEMGREP, mensagem: "a | b" }), gitleaks: rodou() } }))
    expect(s).toContain("| a \\| b |")
  })
})

describe("anotacoes", () => {
  it("warning com arquivo e linha; sem linha no lockfile; erro de ferramenta", () => {
    expect(anotacoes(res({
      situacoes: { osv: rodou(OSV), semgrep: rodou(SEMGREP), gitleaks: { _tag: "Erro", motivo: "saiu com código 2" } },
    }))).toEqual([
      "::warning file=package-lock.json,title=OSV-Scanner%3A GHSA-xvch-5gv4-984h::minimist@1.2.5: Prototype Pollution",
      "::warning file=src/b.js,line=2,title=Semgrep%3A js.eval-detected::Detected the use of eval().",
      "::warning title=Segurança::gitleaks não rodou: saiu com código 2",
    ])
  })

  it("error ao bloquear, com escape de % e quebra de linha", () => {
    expect(anotacoes(res({
      bloquear: true,
      situacoes: { osv: rodou(), semgrep: rodou({ ...SEMGREP, arquivo: "a,b.js", mensagem: "100%\nfim" }), gitleaks: rodou() },
    }))).toEqual(["::error file=a%2Cb.js,line=2,title=Semgrep%3A js.eval-detected::100%25%0Afim"])
  })
})

describe("comentario", () => {
  it("reprovado: marcador, título, achados, como resolver e o run", () => {
    expect(comentario(res({ bloquear: true, situacoes: { osv: rodou(OSV), semgrep: rodou(SEMGREP), gitleaks: rodou() } }), "https://run"))
      .toBe([
        MARCADOR_SEGURANCA,
        "❌ **Segurança:** 2 achados novos.",
        "- OSV-Scanner `GHSA-xvch-5gv4-984h` em `package-lock.json`: minimist@1.2.5: Prototype Pollution",
        "- Semgrep `js.eval-detected` em `src/b.js:2`: Detected the use of eval().",
        "**Como resolver:** corrija o achado, ou suprima com o mecanismo da ferramenta (`osv-scanner.toml`, `// nosemgrep: <regra>`, `.gitleaksignore`). A supressão só vale depois do merge.",
        "[Ver o run](https://run)",
      ].join("\n"))
  })

  it("aprovado: só o título e o run", () => {
    expect(comentario(res({ bloquear: true }), "https://run")).toBe(
      [MARCADOR_SEGURANCA, "✅ **Segurança:** nenhum achado novo.", "[Ver o run](https://run)"].join("\n"),
    )
  })

  it("lista no máximo 20 achados e cita a ferramenta que não rodou", () => {
    const muitos = Array.from({ length: 22 }, (_, i) => ({ ...SEMGREP, linha: i + 1 }))
    const c = comentario(res({
      bloquear: true,
      situacoes: { osv: { _tag: "Erro", motivo: "o passo não terminou" }, semgrep: rodou(...muitos), gitleaks: rodou() },
    }), "https://run")
    expect(c.split("\n").filter((l) => l.startsWith("- Semgrep"))).toHaveLength(20)
    expect(c).toContain("- e mais 2 no summary do run.")
    expect(c).toContain("- OSV-Scanner não rodou: o passo não terminou.")
    expect(c.split("\n")[1]).toBe("❌ **Segurança:** 22 achados novos; não rodou: OSV-Scanner.")
  })
})
