import { Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"

export interface Chamada {
  readonly metodo: string
  readonly url: string
  readonly corpo: unknown
  readonly autorizacao: string | undefined
}

type Resposta = { readonly status: number; readonly json?: unknown }

// A fake HttpClient that answers by "METHOD path?query" (path relative to the API root) and records
// every request. An unknown route answers 599 so a test sees which call it did not expect.
export const httpFalso = (api: string, rotas: Record<string, Resposta | ((corpo: unknown) => Resposta)>) => {
  const chamadas: Array<Chamada> = []
  const layer = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request, url) =>
      Effect.sync(() => {
        const caminho = url.href.slice(api.length)
        const bruto = request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : undefined
        const corpo = bruto === undefined ? undefined : JSON.parse(bruto)
        chamadas.push({ metodo: request.method, url: caminho, corpo, autorizacao: request.headers["authorization"] })
        const rota = rotas[`${request.method} ${caminho}`]
        const r = typeof rota === "function" ? rota(corpo) : (rota ?? { status: 599 })
        const body = r.json === undefined ? null : JSON.stringify(r.json)
        return HttpClientResponse.fromWeb(request, new Response(body, { status: r.status }))
      })),
  )
  return { layer, chamadas }
}
