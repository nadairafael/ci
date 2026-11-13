import { describe, expect, it } from "vitest"
import type { Resultado } from "../src/avaliar.js"
import type { Config } from "../src/config.js"
import { MARCADOR } from "../src/github.js"
import { comentario, descricaoStatus, summary } from "../src/relatorio.js"

const CONFIG: Config = { tamanho: { limite: 400, labelAprovado: "aprovado-nadai" } }
const RUN = "https://github.com/o/r/actions/runs/1"
const base: Resultado = { ok: true, motivos: [], contados: [], aprovado: false, tipo: "normal", sensiveis: [] }
const linhas = (s: string) => s.split("\n")

describe("comentario", () => {
  it("reprovado por tamanho", () => {
    const r: Resultado = {
      ...base, ok: false, total: 812, limite: 400,
      motivos: ["O PR soma 812 linhas de lógica, acima do limite de 400."],
      contados: [
        { arquivo: "a.ts", linhas: 10 }, { arquivo: "b.ts", linhas: 632 }, { arquivo: "c.ts", linhas: 120 },
        { arquivo: "d.ts", linhas: 20 }, { arquivo: "e.ts", linhas: 15 }, { arquivo: "f.ts", linhas: 15 },
      ],
    }
    const l = linhas(comentario(r, CONFIG, RUN))
    expect(l[0]).toBe(MARCADOR)
    expect(l[1]).toBe("❌ **Portão:** 812 linhas de lógica (limite 400).")
    expect(l[2]).toBe("Maiores: `b.ts` 632 · `c.ts` 120 · `d.ts` 20 · `e.ts` 15 · `f.ts` 15")
    expect(l).toContain("**Como resolver:** divida o PR, ou peça ao dono do repo a label «aprovado-nadai».")
    expect(l.at(-1)).toBe(`[Ver o run](${RUN})`)
  })

  it("reprovado por tamanho com label de terceiro lista o motivo extra", () => {
    const r: Resultado = {
      ...base, ok: false, total: 900, limite: 400, contados: [{ arquivo: "a.ts", linhas: 900 }],
      motivos: ["O PR soma 900 linhas de lógica, acima do limite de 400.", "A label «aprovado-nadai» não foi aplicada pelo dono do repo, então não libera o limite."],
    }
    expect(comentario(r, CONFIG, RUN)).toContain("- A label «aprovado-nadai» não foi aplicada pelo dono do repo")
  })

  it("reprovado por outro motivo", () => {
    const r: Resultado = { ...base, ok: false, motivos: ["O portão não conseguiu ler o PR: GET /x respondeu 500"] }
    const l = linhas(comentario(r, CONFIG, RUN))
    expect(l[1]).toBe("❌ **Portão:** não está pronto para merge.")
    expect(l[2]).toBe("- O portão não conseguiu ler o PR: GET /x respondeu 500")
  })

  it("variantes que passam", () => {
    expect(linhas(comentario({ ...base, total: 212, limite: 400 }, CONFIG, RUN))[1]).toBe("✅ **Portão ok** (212/400 linhas).")
    expect(linhas(comentario({ ...base, tipo: "soDocs" }, CONFIG, RUN))[1]).toBe("✅ **Portão ok:** PR só de documentação.")
    expect(linhas(comentario({ ...base, tipo: "isento" }, CONFIG, RUN))[1]).toBe("✅ **Portão ok:** PR «Versão nova», isento.")
    expect(linhas(comentario({ ...base, tipo: "semRegras" }, undefined, RUN))[1]).toBe("✅ **Portão ok:** nenhuma regra ligada neste repo.")
  })

  it("aprovado pela label diz isso", () => {
    const c = comentario({ ...base, total: 900, limite: 400, aprovado: true }, CONFIG, RUN)
    expect(linhas(c)[1]).toBe("✅ **Portão ok** (900/400 linhas, liberado pela label «aprovado-nadai»).")
  })

  it("arquivo sensível acrescenta o aviso", () => {
    const c = comentario({ ...base, tipo: "semRegras", sensiveis: [".github/portao.json", ".github/workflows/portao.yml"] }, undefined, RUN)
    expect(c).toContain("⚠️ Este PR mexe no portão (.github/portao.json, .github/workflows/portao.yml): precisa de olho humano. Regras novas só valem depois do merge.")
  })
})

describe("descricaoStatus", () => {
  it("cada variante", () => {
    expect(descricaoStatus({ ...base, total: 212, limite: 400 })).toBe("212/400 linhas")
    expect(descricaoStatus({ ...base, ok: false, total: 900, limite: 400, motivos: ["x"] })).toBe("acima do limite: 900/400")
    expect(descricaoStatus({ ...base, tipo: "soDocs" })).toBe("só documentação")
    expect(descricaoStatus({ ...base, tipo: "isento" })).toBe("isento")
    expect(descricaoStatus({ ...base, tipo: "semRegras" })).toBe("sem regras")
  })

  it("motivo longo é cortado em 140", () => {
    const d = descricaoStatus({ ...base, ok: false, motivos: ["x".repeat(300)] })
    expect(d.length).toBeLessThanOrEqual(140)
  })
})

describe("summary", () => {
  it("lista todos os arquivos contados", () => {
    const r: Resultado = { ...base, total: 3, limite: 400, contados: [{ arquivo: "a.ts", linhas: 1 }, { arquivo: "b.ts", linhas: 2 }] }
    const s = summary(r, CONFIG)
    expect(s).toContain("- a.ts: 1")
    expect(s).toContain("- b.ts: 2")
    expect(s).not.toContain(MARCADOR)
  })
})
