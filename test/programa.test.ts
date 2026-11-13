import { expect, it } from "@effect/vitest"
import { Effect, Layer, Option } from "effect"
import type { Arquivo } from "../src/avaliar.js"
import { type Config, ConfigInvalida } from "../src/config.js"
import { ErroApi, GitHub, type PrDaApi } from "../src/github.js"
import { type Ambiente, programa } from "../src/programa.js"

const PR: PrDaApi = {
  number: 7, body: "", labels: [], user: { login: "nadairafael" },
  head: { ref: "feat/x", sha: "headsha" }, base: { sha: "basesha" }, changed_files: 1,
}

interface Falso {
  config?: Option.Option<Config>
  arquivos?: Effect.Effect<ReadonlyArray<Arquivo>, ErroApi>
  comentarioFalha?: boolean
  configErro?: boolean
  configMensagem?: string
  pr?: PrDaApi
}

const montar = (f: Falso = {}) => {
  const status: Array<{ sha: string; estado: string; descricao: string }> = []
  const comentarios: Array<string> = []
  const layer = Layer.succeed(GitHub, GitHub.of({
    lerPr: () => Effect.succeed(f.pr ?? PR),
    lerArquivos: () => f.arquivos ?? Effect.succeed([{ filename: "src/a.ts", additions: 10, deletions: 0 }]),
    lerConfig: () =>
      f.configErro
        ? Effect.fail(new ConfigInvalida({ mensagem: f.configMensagem ?? ".github/portao.json no base não é JSON válido" }))
        : Effect.succeed(f.config ?? Option.some<Config>({ tamanho: { limite: 400 } })),
    labelAplicadaPor: () => Effect.succeed(Option.none()),
    gravarComentario: (_n, corpo) =>
      f.comentarioFalha
        ? Effect.fail(new ErroApi({ mensagem: "POST /x respondeu 403" }))
        : Effect.sync(() => void comentarios.push(corpo)),
    gravarStatus: (sha, estado, descricao) => Effect.sync(() => void status.push({ sha, estado, descricao })),
  }))
  const log: Array<string> = []
  const amb = (over: Partial<Ambiente> = {}): Ambiente => ({
    evento: "pull_request",
    payload: { pull_request: PR },
    sha: "mergesha",
    dono: "nadairafael",
    runUrl: "https://run",
    prNumero: undefined,
    log: (s) => void log.push(s),
    anexarSummary: () => {},
    ...over,
  })
  return { layer, status, comentarios, log, amb }
}

it.effect("pull_request aprovado grava status success no head.sha, não no GITHUB_SHA", () => {
  const m = montar()
  return Effect.gen(function* () {
    const r = yield* programa(m.amb())
    expect(r.ok).toBe(true)
    expect(m.status).toEqual([{ sha: "headsha", estado: "success", descricao: "10/400 linhas" }])
    expect(m.comentarios[0]).toContain("✅ **Portão ok** (10/400 linhas).")
  }).pipe(Effect.provide(m.layer))
})

it.effect("erro 500 em lerArquivos grava failure e comenta que não conseguiu ler o PR", () => {
  const m = montar({ arquivos: Effect.fail(new ErroApi({ mensagem: "GET /repos/o/r/pulls/7/files?per_page=100&page=1 respondeu 500" })) })
  return Effect.gen(function* () {
    const r = yield* programa(m.amb())
    expect(r.ok).toBe(false)
    expect(m.status[0]!.estado).toBe("failure")
    expect(m.comentarios[0]).toContain("O portão não conseguiu ler o PR: GET /repos/o/r/pulls/7/files?per_page=100&page=1 respondeu 500")
    expect(m.log.some((l) => l.startsWith("::error title=Portão::"))).toBe(true)
  }).pipe(Effect.provide(m.layer))
})

it.effect("dispatch com PR_NUMERO inválido falha com o motivo exato", () => {
  const m = montar()
  return Effect.gen(function* () {
    const r = yield* programa(m.amb({ evento: "workflow_dispatch", payload: {}, prNumero: "abc" }))
    expect(r.ok).toBe(false)
    expect(m.log.join("\n")).toContain("o número do PR do disparo não é válido: «abc»")
    expect(m.status).toEqual([{ sha: "mergesha", estado: "failure", descricao: "o número do PR do disparo não é válido: «abc»" }])
  }).pipe(Effect.provide(m.layer))
})

it.effect("dispatch compara o head com o commit do run", () => {
  const m = montar()
  return Effect.gen(function* () {
    const r = yield* programa(m.amb({ evento: "workflow_dispatch", payload: {}, prNumero: "7", sha: "outro" }))
    expect(r.ok).toBe(false)
    expect(m.log.join("\n")).toContain("O PR mudou depois do disparo")
    // The failure goes on the commit the run was for, and the comment of the new head is left alone.
    expect(m.status.map((s) => [s.sha, s.estado])).toEqual([["outro", "failure"]])
    expect(m.comentarios).toEqual([])
  }).pipe(Effect.provide(m.layer))
})

it.effect("falha ao comentar não muda ok e vira warning", () => {
  const m = montar({ comentarioFalha: true })
  return Effect.gen(function* () {
    const r = yield* programa(m.amb())
    expect(r.ok).toBe(true)
    expect(m.log.some((l) => l.startsWith("::warning"))).toBe(true)
    expect(m.status[0]!.estado).toBe("success")
  }).pipe(Effect.provide(m.layer))
})

it.effect("config inválida no base reprova com a mensagem da config", () => {
  const m = montar({ configErro: true })
  return Effect.gen(function* () {
    const r = yield* programa(m.amb())
    expect(r.ok).toBe(false)
    expect(m.comentarios[0]).toContain("- .github/portao.json no base não é JSON válido")
  }).pipe(Effect.provide(m.layer))
})

it.effect("dispatch no head atual grava no head e comenta", () => {
  const m = montar()
  return Effect.gen(function* () {
    const r = yield* programa(m.amb({ evento: "workflow_dispatch", payload: {}, prNumero: "7", sha: "headsha" }))
    expect(r.ok).toBe(true)
    expect(m.status.map((s) => s.sha)).toEqual(["headsha"])
    expect(m.comentarios.length).toBe(1)
  }).pipe(Effect.provide(m.layer))
})

it.effect("um motivo com várias linhas sai numa anotação só, com as quebras escapadas", () => {
  const m = montar({ configErro: true, configMensagem: ".github/portao.json inválido: Expected number\n  at [\"tamanho\"][\"limite\"]" })
  return Effect.gen(function* () {
    yield* programa(m.amb())
    const erros = m.log.filter((l) => l.startsWith("::error"))
    expect(erros).toEqual([
      '::error title=Portão::.github/portao.json inválido: Expected number%0A  at ["tamanho"]["limite"]',
    ])
  }).pipe(Effect.provide(m.layer))
})
