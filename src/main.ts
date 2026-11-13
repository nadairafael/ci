// Entry point of dist/portao.mjs, run by .github/workflows/portao.yml.
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { appendFileSync, readFileSync } from "node:fs"
import { githubLive } from "./github.js"
import { programa } from "./programa.js"

const env = process.env
const lerEvento = (): unknown => {
  try {
    return JSON.parse(readFileSync(env.GITHUB_EVENT_PATH ?? "", "utf8"))
  } catch {
    return {}
  }
}

const layer = githubLive({
  api: env.GITHUB_API_URL ?? "https://api.github.com",
  repo: env.GITHUB_REPOSITORY ?? "",
  token: env.GITHUB_TOKEN ?? "",
  tokenStatus: env.STATUS_TOKEN || undefined,
}).pipe(Layer.provide(FetchHttpClient.layer))

const { ok } = await Effect.runPromise(
  programa({
    evento: env.GITHUB_EVENT_NAME ?? "",
    payload: lerEvento(),
    sha: env.GITHUB_SHA ?? "",
    dono: env.GITHUB_REPOSITORY_OWNER ?? "",
    runUrl: `${env.GITHUB_SERVER_URL ?? "https://github.com"}/${env.GITHUB_REPOSITORY ?? ""}/actions/runs/${env.GITHUB_RUN_ID ?? ""}`,
    prNumero: env.PR_NUMERO || undefined,
    prSha: env.PR_SHA || undefined,
    appSemToken: env.APP_PEDIDO === "true" && !env.STATUS_TOKEN
      ? `O caller pediu o App do portão (app-client-id), mas o token dele não saiu: confira se o secret PORTAO_APP_KEY está no environment «${env.AMBIENTE ?? ""}» e se o App está instalado neste repo.`
      : undefined,
    log: (linha) => console.log(linha),
    anexarSummary: (texto) => {
      if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, texto)
    },
  }).pipe(Effect.provide(layer)),
)
process.exitCode = ok ? 0 : 1
