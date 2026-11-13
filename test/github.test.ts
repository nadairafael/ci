import { expect, it } from "@effect/vitest"
import { Effect, Layer, Option } from "effect"
import { GitHub, githubLive, MARCADOR } from "../src/github.js"
import { httpFalso } from "./fake-http.js"

const API = "https://api.github.test"
const acesso = { api: API, repo: "o/r", token: "t" }
const comRotas = (rotas: Parameters<typeof httpFalso>[1]) => {
  const fake = httpFalso(API, rotas)
  return { ...fake, layer: githubLive(acesso).pipe(Layer.provide(fake.layer)) }
}
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64")

it.effect("lerConfig com 404 é none quando o repo é legível", () => {
  const { layer } = comRotas({
    "GET /repos/o/r/contents/.github/portao.json?ref=base1": { status: 404, json: {} },
    "GET /repos/o/r": { status: 200, json: { full_name: "o/r" } },
  })
  return Effect.gen(function* () {
    const gh = yield* GitHub
    expect(Option.isNone(yield* gh.lerConfig("base1"))).toBe(true)
  }).pipe(Effect.provide(layer))
})

it.effect("lerConfig decodifica o conteúdo base64", () => {
  const { layer } = comRotas({
    "GET /repos/o/r/contents/.github/portao.json?ref=base1": { status: 200, json: { content: b64('{"tamanho":{"limite":400}}') } },
  })
  return Effect.gen(function* () {
    const gh = yield* GitHub
    const config = yield* gh.lerConfig("base1")
    expect(Option.getOrThrow(config).tamanho?.limite).toBe(400)
  }).pipe(Effect.provide(layer))
})

it.effect("lerConfig com JSON quebrado falha com ConfigInvalida", () => {
  const { layer } = comRotas({
    "GET /repos/o/r/contents/.github/portao.json?ref=base1": { status: 200, json: { content: b64("{ quebrado") } },
  })
  return Effect.gen(function* () {
    const gh = yield* GitHub
    const erro = yield* Effect.flip(gh.lerConfig("base1"))
    expect(erro._tag).toBe("ConfigInvalida")
    expect(erro.mensagem).toBe(".github/portao.json no base não é JSON válido")
  }).pipe(Effect.provide(layer))
})

it.effect("labelAplicadaPor pega o último labeled", () => {
  const { layer } = comRotas({
    "GET /repos/o/r/issues/1/events?per_page=100&page=1": {
      status: 200,
      json: [
        { event: "labeled", label: { name: "aprovado-nadai" }, actor: { login: "nadairafael" } },
        { event: "unlabeled", label: { name: "aprovado-nadai" }, actor: { login: "nadairafael" } },
        { event: "labeled", label: { name: "outra" }, actor: { login: "x" } },
        { event: "labeled", label: { name: "aprovado-nadai" }, actor: { login: "bot" } },
        { event: "assigned", actor: { login: "y" } },
      ],
    },
  })
  return Effect.gen(function* () {
    const gh = yield* GitHub
    expect(yield* gh.labelAplicadaPor(1, "aprovado-nadai")).toEqual(Option.some("bot"))
  }).pipe(Effect.provide(layer))
})

it.effect("gravarComentario edita quando o marcador existe", () => {
  const { layer, chamadas } = comRotas({
    "GET /repos/o/r/issues/1/comments?per_page=100&page=1": {
      status: 200, json: [{ id: 7, body: "oi" }, { id: 9, body: `${MARCADOR}\nantigo` }],
    },
    "PATCH /repos/o/r/issues/comments/9": { status: 200, json: {} },
  })
  return Effect.gen(function* () {
    const gh = yield* GitHub
    yield* gh.gravarComentario(1, `${MARCADOR}\nnovo`)
    expect(chamadas.map((c) => c.metodo)).toEqual(["GET", "PATCH"])
    expect(chamadas[1]!.corpo).toEqual({ body: `${MARCADOR}\nnovo` })
  }).pipe(Effect.provide(layer))
})

it.effect("gravarComentario cria quando não existe", () => {
  const { layer, chamadas } = comRotas({
    "GET /repos/o/r/issues/1/comments?per_page=100&page=1": { status: 200, json: [{ id: 7, body: "oi" }] },
    "POST /repos/o/r/issues/1/comments": { status: 201, json: {} },
  })
  return Effect.gen(function* () {
    const gh = yield* GitHub
    yield* gh.gravarComentario(1, "x")
    expect(chamadas.map((c) => `${c.metodo} ${c.url}`)).toEqual([
      "GET /repos/o/r/issues/1/comments?per_page=100&page=1",
      "POST /repos/o/r/issues/1/comments",
    ])
  }).pipe(Effect.provide(layer))
})

it.effect("lerArquivos pagina", () => {
  const pagina = (n: number) => Array.from({ length: n }, (_, i) => ({ filename: `f${i}.ts`, additions: 1, deletions: 0 }))
  const { layer } = comRotas({
    "GET /repos/o/r/pulls/1/files?per_page=100&page=1": { status: 200, json: pagina(100) },
    "GET /repos/o/r/pulls/1/files?per_page=100&page=2": { status: 200, json: pagina(3) },
  })
  return Effect.gen(function* () {
    const gh = yield* GitHub
    expect((yield* gh.lerArquivos(1)).length).toBe(103)
  }).pipe(Effect.provide(layer))
})

it.effect("gravarStatus usa o contexto portao", () => {
  const { layer, chamadas } = comRotas({ "POST /repos/o/r/statuses/abc": { status: 201, json: {} } })
  return Effect.gen(function* () {
    const gh = yield* GitHub
    yield* gh.gravarStatus("abc", "failure", "acima do limite: 900/400", "https://run")
    expect(chamadas[0]!.corpo).toEqual({
      state: "failure", context: "portao", description: "acima do limite: 900/400", target_url: "https://run",
    })
  }).pipe(Effect.provide(layer))
})

it.effect("resposta 500 vira ErroApi com a mensagem exata", () => {
  const { layer } = comRotas({ "GET /repos/o/r/pulls/1": { status: 500, json: {} } })
  return Effect.gen(function* () {
    const gh = yield* GitHub
    const erro = yield* Effect.flip(gh.lerPr(1))
    expect(erro._tag).toBe("ErroApi")
    expect(erro.mensagem).toBe("GET /repos/o/r/pulls/1 respondeu 500")
  }).pipe(Effect.provide(layer))
})

it.effect("lerConfig com 404 e repo ilegível falha em vez de passar sem regras", () => {
  const { layer } = comRotas({
    "GET /repos/o/r/contents/.github/portao.json?ref=base1": { status: 404, json: {} },
    "GET /repos/o/r": { status: 404, json: {} },
  })
  return Effect.gen(function* () {
    const gh = yield* GitHub
    const erro = yield* Effect.flip(gh.lerConfig("base1"))
    expect(erro._tag).toBe("ErroApi")
    expect(erro.mensagem).toContain("contents: read")
  }).pipe(Effect.provide(layer))
})

it.effect("lerArquivos guarda o previous_filename dos renomeios", () => {
  const { layer } = comRotas({
    "GET /repos/o/r/pulls/1/files?per_page=100&page=1": {
      status: 200, json: [{ filename: "docs/x.md", previous_filename: "src/x.ts", additions: 0, deletions: 0 }],
    },
  })
  return Effect.gen(function* () {
    const gh = yield* GitHub
    expect((yield* gh.lerArquivos(1))[0]!.previous_filename).toBe("src/x.ts")
  }).pipe(Effect.provide(layer))
})

it.effect("contexto e marcador próprios: status «seguranca» e o comentário do outro marcador", () => {
  const fake = httpFalso(API, {
    "POST /repos/o/r/statuses/abc": { status: 201, json: {} },
    "GET /repos/o/r/issues/1/comments?per_page=100&page=1": {
      status: 200, json: [{ id: 9, body: `${MARCADOR}\nportão` }, { id: 11, body: "<!-- outro -->\nantigo" }],
    },
    "PATCH /repos/o/r/issues/comments/11": { status: 200, json: {} },
  })
  const layer = githubLive({ ...acesso, contexto: "seguranca", marcador: "<!-- outro -->" }).pipe(Layer.provide(fake.layer))
  return Effect.gen(function* () {
    const gh = yield* GitHub
    yield* gh.gravarStatus("abc", "success", "nenhum achado novo", "https://run")
    yield* gh.gravarComentario(1, "<!-- outro -->\nnovo")
    expect((fake.chamadas[0]!.corpo as { context: string }).context).toBe("seguranca")
    expect(fake.chamadas.map((c) => `${c.metodo} ${c.url}`).at(-1)).toBe("PATCH /repos/o/r/issues/comments/11")
  }).pipe(Effect.provide(layer))
})

it.effect("gravarComentario com soEditar não cria quando não existe", () => {
  const { layer, chamadas } = comRotas({
    "GET /repos/o/r/issues/1/comments?per_page=100&page=1": { status: 200, json: [{ id: 7, body: "oi" }] },
  })
  return Effect.gen(function* () {
    const gh = yield* GitHub
    yield* gh.gravarComentario(1, "x", true)
    expect(chamadas.map((c) => c.metodo)).toEqual(["GET"])
  }).pipe(Effect.provide(layer))
})
