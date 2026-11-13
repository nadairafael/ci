// Entry point of dist/seguranca.mjs, run by the last step of .github/workflows/seguranca.yml after
// the tool steps wrote their reports and exit codes to $SAIDA.
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { appendFileSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { githubLive } from "../github.js"
import { MARCADOR_SEGURANCA } from "./relatorio.js"
import { type Estado, programa } from "./programa.js"

const env = process.env
const estado = (v: string | undefined): Estado => (v === "sim" || v === "rascunho" ? v : "nao")
const saida = env.SAIDA ?? ""

const layer = githubLive({
  api: env.GITHUB_API_URL ?? "https://api.github.com",
  repo: env.GITHUB_REPOSITORY ?? "",
  token: env.GITHUB_TOKEN ?? "",
  contexto: "seguranca",
  marcador: MARCADOR_SEGURANCA,
}).pipe(Layer.provide(FetchHttpClient.layer))

const { ok } = await Effect.runPromise(
  programa({
    escopo: env.ESCOPO === "diff" ? "diff" : "completo",
    bloquear: env.BLOQUEAR === "true",
    estados: { osv: estado(env.OSV), semgrep: estado(env.SEMGREP), gitleaks: estado(env.GITLEAKS) },
    headSha: env.HEAD_SHA || undefined,
    fork: env.FORK === "true",
    prNumero: /^[1-9]\d*$/.test(env.PR_NUMERO ?? "") ? Number(env.PR_NUMERO) : undefined,
    raizes: { head: env.RAIZ_HEAD ?? "", base: env.RAIZ_BASE ?? "" },
    runUrl: `${env.GITHUB_SERVER_URL ?? "https://github.com"}/${env.GITHUB_REPOSITORY ?? ""}/actions/runs/${env.GITHUB_RUN_ID ?? ""}`,
    ler: (nome) => {
      try {
        return readFileSync(join(saida, nome), "utf8")
      } catch {
        return undefined
      }
    },
    log: (linha) => console.log(linha),
    anexarSummary: (texto) => {
      if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, texto)
    },
  }).pipe(Effect.provide(layer)),
)
process.exitCode = ok ? 0 : 1
