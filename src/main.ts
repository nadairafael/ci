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
}).pipe(Layer.provide(FetchHttpClient.layer))

const { ok } = await Effect.runPromise(
  programa({
    evento: env.GITHUB_EVENT_NAME ?? "",
    payload: lerEvento(),
    sha: env.GITHUB_SHA ?? "",
    dono: env.GITHUB_REPOSITORY_OWNER ?? "",
    runUrl: `${env.GITHUB_SERVER_URL ?? "https://github.com"}/${env.GITHUB_REPOSITORY ?? ""}/actions/runs/${env.GITHUB_RUN_ID ?? ""}`,
    prNumero: env.PR_NUMERO || undefined,
    log: (linha) => console.log(linha),
    anexarSummary: (texto) => {
      if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, texto)
    },
  }).pipe(Effect.provide(layer)),
)
process.exitCode = ok ? 0 : 1
