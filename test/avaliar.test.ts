import { describe, expect, it } from "vitest"
import { avaliar, type Entrada } from "../src/avaliar.js"
import type { Config } from "../src/config.js"

const arquivo = (filename: string, additions: number, deletions = 0) => ({ filename, additions, deletions })

const CONFIG: Config = {
  tamanho: { limite: 400, labelAprovado: "aprovado-nadai" },
  soDocs: ["docs/**", "**/*.md"],
  isento: { headRef: "changeset-release/main", autor: "github-actions[bot]" },
}

const entrada = (over: Partial<Entrada> = {}): Entrada => {
  const arquivos = over.arquivos ?? [arquivo("src/a.ts", 10)]
  return {
    config: CONFIG,
    labels: [],
    labelAplicadaPeloDono: false,
    autor: "nadairafael",
    headRef: "feat/x",
    headSha: "a",
    changedFiles: arquivos.length,
    ...over,
    arquivos,
  }
}

describe("avaliar", () => {
  it("passa com 400 linhas e limite 400", () => {
    const r = avaliar(entrada({ arquivos: [arquivo("src/a.ts", 300, 100)] }))
    expect(r.ok).toBe(true)
    expect(r.total).toBe(400)
    expect(r.limite).toBe(400)
  })

  it("reprova com 401", () => {
    const r = avaliar(entrada({ arquivos: [arquivo("src/a.ts", 401)] }))
    expect(r.ok).toBe(false)
    expect(r.motivos[0]).toMatch(/401 linhas de lógica, acima do limite de 400/)
    expect(r.contados).toEqual([{ arquivo: "src/a.ts", linhas: 401 }])
  })

  it("JSON de protótipo e woff2 não contam", () => {
    const r = avaliar(entrada({
      arquivos: [arquivo("prototipo/dados/a.json", 600), arquivo("x.woff2", 0), arquivo("src/a.ts", 10)],
    }))
    expect(r.total).toBe(10)
    expect(r.contados.map((c) => c.arquivo)).toEqual(["src/a.ts"])
  })

  it("package.json e tsconfig contam", () => {
    const r = avaliar(entrada({ arquivos: [arquivo("package.json", 5), arquivo("apps/x/tsconfig.base.json", 2)] }))
    expect(r.total).toBe(7)
  })

  it("testes, gerados e lockfiles não contam", () => {
    const r = avaliar(entrada({
      arquivos: [arquivo("src/a.test.ts", 900), arquivo("package-lock.json", 5000), arquivo("src/generated/x.ts", 900)],
    }))
    expect(r.ok).toBe(true)
    expect(r.total).toBe(0)
  })

  it("o ignorar do repo soma ao padrão", () => {
    const config: Config = { ...CONFIG, tamanho: { limite: 400, ignorar: ["prototipo/**"] } }
    const r = avaliar(entrada({ config, arquivos: [arquivo("prototipo/app/app.js", 632), arquivo("src/a.ts", 3)] }))
    expect(r.total).toBe(3)
  })

  it("deleção conta, rename puro não", () => {
    const r = avaliar(entrada({ arquivos: [arquivo("a.ts", 0, 50), arquivo("b.ts", 0, 0)] }))
    expect(r.total).toBe(50)
  })

  it("label do dono libera o tamanho", () => {
    const r = avaliar(entrada({
      labels: ["aprovado-nadai"], labelAplicadaPeloDono: true, arquivos: [arquivo("src/a.ts", 900)],
    }))
    expect(r.ok).toBe(true)
    expect(r.aprovado).toBe(true)
  })

  it("label de outra pessoa não libera", () => {
    const r = avaliar(entrada({
      labels: ["aprovado-nadai"], labelAplicadaPeloDono: false, arquivos: [arquivo("src/a.ts", 900)],
    }))
    expect(r.ok).toBe(false)
    expect(r.aprovado).toBe(false)
    expect(r.motivos.join("\n")).toContain("não foi aplicada pelo dono do repo")
  })

  it("lista incompleta reprova", () => {
    const r = avaliar(entrada({ changedFiles: 5, arquivos: [arquivo("a.ts", 1), arquivo("b.ts", 1), arquivo("c.ts", 1)] }))
    expect(r.ok).toBe(false)
    expect(r.motivos[0]).toContain("3 de 5 arquivos")
  })

  it("mais de 3000 arquivos reprova dizendo o limite da API", () => {
    const r = avaliar(entrada({ changedFiles: 3001, arquivos: [arquivo("a.ts", 1)] }))
    expect(r.ok).toBe(false)
    expect(r.motivos).toEqual([
      "O PR tem 3001 arquivos, e a API do GitHub lista no máximo 3000: o portão não confere uma lista incompleta. Divida o PR.",
    ])
  })

  it("sha do disparo diferente reprova", () => {
    const r = avaliar(entrada({ shaDoRun: "b", headSha: "a" }))
    expect(r.ok).toBe(false)
    expect(r.motivos[0]).toContain("O PR mudou depois do disparo")
  })

  it("isento só com branch e autor", () => {
    expect(avaliar(entrada({ headRef: "changeset-release/main", autor: "github-actions[bot]", arquivos: [arquivo("a.ts", 9000)] })).tipo).toBe("isento")
    const soBranch = avaliar(entrada({ headRef: "changeset-release/main", arquivos: [arquivo("a.ts", 9000)] }))
    expect(soBranch.tipo).toBe("normal")
    expect(soBranch.ok).toBe(false)
  })

  it("soDocs passa", () => {
    const r = avaliar(entrada({ arquivos: [arquivo("docs/a.html", 5000), arquivo("README.md", 10)] }))
    expect(r.ok).toBe(true)
    expect(r.tipo).toBe("soDocs")
  })

  it("config ausente = semRegras, ok", () => {
    const r = avaliar(entrada({ config: undefined, arquivos: [arquivo("src/a.ts", 9000)] }))
    expect(r.ok).toBe(true)
    expect(r.tipo).toBe("semRegras")
  })

  it("config sem tamanho não confere tamanho", () => {
    const r = avaliar(entrada({ config: { soDocs: ["docs/**"] }, arquivos: [arquivo("src/a.ts", 9000)] }))
    expect(r.ok).toBe(true)
    expect(r.tipo).toBe("semRegras")
  })

  it("primeiro PR de adoção: passa e marca o arquivo sensível", () => {
    const r = avaliar(entrada({ config: undefined, arquivos: [arquivo(".github/portao.json", 8), arquivo(".github/workflows/portao.yml", 20)] }))
    expect(r.ok).toBe(true)
    expect(r.sensiveis).toEqual([".github/portao.json", ".github/workflows/portao.yml"])
  })
})

describe("workflows", () => {
  it("qualquer workflow do PR é sensível: ele pode gravar o status «portao»", () => {
    const r = avaliar(entrada({ arquivos: [arquivo(".github/workflows/outro.yml", 5), arquivo(".github/dependabot.yml", 3)] }))
    expect(r.sensiveis).toEqual([".github/workflows/outro.yml"])
  })
})

describe("renomeios", () => {
  it("código movido para docs/ não é PR só de documentação", () => {
    const r = avaliar(entrada({ arquivos: [{ filename: "docs/x.md", previous_filename: "src/x.ts", additions: 0, deletions: 0 }] }))
    expect(r.tipo).toBe("normal")
  })

  it("renomear o portao.json para longe é sensível", () => {
    const r = avaliar(entrada({ arquivos: [{ filename: "x.json", previous_filename: ".github/portao.json", additions: 0, deletions: 0 }] }))
    expect(r.sensiveis).toEqual([".github/portao.json"])
  })
})
