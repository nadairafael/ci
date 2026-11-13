import { expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { ErroApi, GitHub } from "../src/github.js"
import { type Ambiente, programa } from "../src/seguranca/programa.js"

const SEMGREP_UM = JSON.stringify({
  results: [{ check_id: "r1", path: "a.js", start: { line: 4 }, extra: { message: "m", severity: "ERROR" } }],
})

const montar = (arquivos: Record<string, string>, f: { statusFalha?: boolean; statusHttp?: number } = {}) => {
  const status: Array<{ sha: string; estado: string; descricao: string }> = []
  const comentarios: Array<{ corpo: string; soEditar: boolean | undefined }> = []
  const nao = () => Effect.die("não usado")
  const layer = Layer.succeed(GitHub, GitHub.of({
    lerPr: nao,
    lerArquivos: nao,
    lerConfig: nao,
    labelAplicadaPor: nao,
    gravarComentario: (_n, corpo, soEditar) => Effect.sync(() => void comentarios.push({ corpo, soEditar })),
    gravarStatus: (sha, estado, descricao) =>
      f.statusFalha
        ? Effect.fail(new ErroApi({ mensagem: `POST /statuses respondeu ${f.statusHttp ?? 500}`, status: f.statusHttp ?? 500 }))
        : Effect.sync(() => void status.push({ sha, estado, descricao })),
  }))
  const log: Array<string> = []
  const summaries: Array<string> = []
  const amb = (over: Partial<Ambiente> = {}): Ambiente => ({
    escopo: "diff",
    bloquear: false,
    estados: { osv: "nao", semgrep: "sim", gitleaks: "sim" },
    headSha: "headsha",
    prNumero: 7,
    fork: false,
    raizes: { head: "/h", base: "/b" },
    runUrl: "https://run",
    ler: (nome) => arquivos[nome],
    log: (s) => void log.push(s),
    anexarSummary: (s) => void summaries.push(s),
    ...over,
  })
  return { layer, status, comentarios, log, summaries, amb }
}

const LIMPO = { "semgrep.exit": "0", "semgrep.json": '{"results":[]}', "gitleaks.exit": "0", "gitleaks.json": "[]" }

it.effect("só aviso: achado novo grava success com a contagem, sem comentário", () => {
  const m = montar({ ...LIMPO, "semgrep.json": SEMGREP_UM })
  return Effect.gen(function* () {
    const r = yield* programa(m.amb())
    expect(r.ok).toBe(true)
    expect(m.status).toEqual([{ sha: "headsha", estado: "success", descricao: "1 achado novo (só aviso)" }])
    expect(m.comentarios).toEqual([])
    expect(m.log).toContain("::warning file=a.js,line=4,title=Semgrep%3A r1::m")
    expect(m.summaries[0]).toContain("⚠️ **Segurança:** 1 achado novo (só aviso).")
  }).pipe(Effect.provide(m.layer))
})

it.effect("bloquear com achado: failure, comentário que cria, ok false", () => {
  const m = montar({ ...LIMPO, "semgrep.json": SEMGREP_UM })
  return Effect.gen(function* () {
    const r = yield* programa(m.amb({ bloquear: true }))
    expect(r.ok).toBe(false)
    expect(m.status).toEqual([{ sha: "headsha", estado: "failure", descricao: "1 achado novo" }])
    expect(m.comentarios).toHaveLength(1)
    expect(m.comentarios[0]!.soEditar).toBe(false)
    expect(m.comentarios[0]!.corpo).toContain("❌ **Segurança:** 1 achado novo.")
    expect(m.log).toContain("::error file=a.js,line=4,title=Semgrep%3A r1::m")
  }).pipe(Effect.provide(m.layer))
})

it.effect("bloquear limpo: success e o comentário só é editado se já existir", () => {
  const m = montar(LIMPO)
  return Effect.gen(function* () {
    const r = yield* programa(m.amb({ bloquear: true }))
    expect(r.ok).toBe(true)
    expect(m.status).toEqual([{ sha: "headsha", estado: "success", descricao: "nenhum achado novo" }])
    expect(m.comentarios[0]!.soEditar).toBe(true)
  }).pipe(Effect.provide(m.layer))
})

it.effect("passo sem exit vira 'não rodou'; rascunho pula o Semgrep", () => {
  const m = montar({ "gitleaks.json": "[]" })
  return Effect.gen(function* () {
    const r = yield* programa(m.amb({ estados: { osv: "nao", semgrep: "rascunho", gitleaks: "sim" } }))
    expect(r.ok).toBe(true)
    expect(m.status[0]!.descricao).toBe("nenhum achado novo; não rodou: gitleaks; Semgrep pulado no rascunho (só aviso)")
    expect(m.log).toContain("::warning title=Segurança::gitleaks não rodou: o passo não terminou")
  }).pipe(Effect.provide(m.layer))
})

it.effect("varredura completa: sem status e sem comentário, mesmo bloqueando", () => {
  const m = montar({ ...LIMPO, "semgrep.json": SEMGREP_UM })
  return Effect.gen(function* () {
    const r = yield* programa(m.amb({ escopo: "completo", bloquear: true, headSha: undefined, prNumero: undefined }))
    expect(r.ok).toBe(false)
    expect(m.status).toEqual([])
    expect(m.comentarios).toEqual([])
    expect(m.summaries[0]).toContain("❌ **Segurança:** 1 achado.")
  }).pipe(Effect.provide(m.layer))
})

it.effect("arquivos de supressão alterados no PR entram no summary", () => {
  const m = montar({ ...LIMPO, "alterados.txt": "src/a.ts\n.gitleaksignore\n" })
  return Effect.gen(function* () {
    yield* programa(m.amb())
    expect(m.summaries[0]).toContain("⚠️ Este PR mexe na supressão de achados (.gitleaksignore)")
  }).pipe(Effect.provide(m.layer))
})

it.effect("falha ao gravar o status vira warning e não muda o veredito", () => {
  const m = montar(LIMPO, { statusFalha: true })
  return Effect.gen(function* () {
    const r = yield* programa(m.amb())
    expect(r.ok).toBe(true)
    expect(m.log).toContain("::warning title=Segurança::não consegui gravar o status «seguranca»: POST /statuses respondeu 500")
  }).pipe(Effect.provide(m.layer))
})

it.effect("403 no status fora de fork: falta statuses: write, o job falha mesmo só avisando", () => {
  const m = montar(LIMPO, { statusFalha: true, statusHttp: 403 })
  return Effect.gen(function* () {
    const r = yield* programa(m.amb())
    expect(r.ok).toBe(false)
    expect(m.log).toContain(
      "::error title=Segurança::não consegui gravar o status «seguranca» (403): dê ao job do caller a permissão statuses: write. POST /statuses respondeu 403",
    )
  }).pipe(Effect.provide(m.layer))
})

it.effect("403 no status num fork continua só aviso: o token de fork não escreve", () => {
  const m = montar(LIMPO, { statusFalha: true, statusHttp: 403 })
  return Effect.gen(function* () {
    const r = yield* programa(m.amb({ fork: true }))
    expect(r.ok).toBe(true)
    expect(m.log).toContain("::warning title=Segurança::não consegui gravar o status «seguranca»: POST /statuses respondeu 403")
  }).pipe(Effect.provide(m.layer))
})

it.effect("supressão na linha adicionada pelo PR: aviso no summary e anotação na linha, sem reprovar", () => {
  const m = montar({ ...LIMPO, "supressoes-na-linha.txt": "src/a.js\t12\tnosemgrep\n.env.exemplo\t3\tgitleaks:allow\n" })
  return Effect.gen(function* () {
    const r = yield* programa(m.amb({ bloquear: true }))
    expect(r.ok).toBe(true)
    expect(m.summaries[0]).toContain(
      "⚠️ Este PR adiciona supressão na linha (`src/a.js:12` nosemgrep, `.env.exemplo:3` gitleaks:allow): precisa de olho humano. Ela já vale neste PR.",
    )
    expect(m.log).toContain(
      "::warning file=src/a.js,line=12,title=Segurança%3A supressão na linha::Este PR adiciona «nosemgrep» nesta linha: confira se a supressão é justa.",
    )
  }).pipe(Effect.provide(m.layer))
})
