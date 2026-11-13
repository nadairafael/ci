import { Effect } from "effect"
import { escaparDado } from "../comando.js"
import { GitHub } from "../github.js"
import {
  type Ferramenta,
  sensiveis,
  type Situacao,
  supressoesNaLinha,
  situacaoGitleaks,
  situacaoOsv,
  situacaoSemgrep,
} from "./achados.js"
import { anotacoes, aprovado, comentario, descricaoStatus, type Resultado, summary } from "./relatorio.js"

// What the workflow decided for each tool: run it, leave it out, or skip it on a draft PR.
export type Estado = "sim" | "nao" | "rascunho"

// Everything the program reads from the runner, so tests can hand it in.
export interface Ambiente {
  readonly escopo: "diff" | "completo"
  readonly bloquear: boolean
  readonly estados: Readonly<Record<Ferramenta, Estado>>
  // The PR's head and number; undefined on a full scan.
  readonly headSha: string | undefined
  readonly prNumero: number | undefined
  // A PR from a fork: its token is read-only, so a 403 on the status is expected there.
  readonly fork: boolean
  // Where the head and the base were checked out, to make OSV's absolute paths relative.
  readonly raizes: { readonly head: string; readonly base: string }
  readonly runUrl: string
  // Reads a file the tool steps wrote to the output folder; undefined when it does not exist.
  readonly ler: (nome: string) => string | undefined
  readonly log: (linha: string) => void
  readonly anexarSummary: (texto: string) => void
}

const situacao = (amb: Ambiente, f: Ferramenta): Situacao => {
  const estado = amb.estados[f]
  if (estado === "nao") return { _tag: "Fora" }
  if (estado === "rascunho") return { _tag: "Rascunho" }
  const saida = (nome: string) => ({ exit: amb.ler(`${nome}.exit`), json: amb.ler(`${nome}.json`) })
  switch (f) {
    case "osv":
      return situacaoOsv(saida("osv-head"), amb.escopo === "diff" ? saida("osv-base") : undefined, amb.raizes)
    case "semgrep":
      return situacaoSemgrep(saida("semgrep"))
    case "gitleaks":
      return situacaoGitleaks(saida("gitleaks"))
  }
}

export const resultado = (amb: Ambiente): Resultado => ({
  escopo: amb.escopo,
  bloquear: amb.bloquear,
  situacoes: { osv: situacao(amb, "osv"), semgrep: situacao(amb, "semgrep"), gitleaks: situacao(amb, "gitleaks") },
  sensiveis: amb.escopo === "diff"
    ? sensiveis((amb.ler("alterados.txt") ?? "").split("\n").map((l) => l.trim()).filter((l) => l !== ""))
    : [],
  naLinha: amb.escopo === "diff" ? supressoesNaLinha(amb.ler("supressoes-na-linha.txt") ?? "") : [],
})

// Annotations, summary, the «seguranca» status on the PR head and, with `bloquear`, the comment.
// A failed write is a warning: the verdict stands. The exception is a 403 on the status outside a
// fork: the caller is missing `statuses: write`, and that fails the job even when it only warns.
export const programa = (amb: Ambiente): Effect.Effect<{ readonly ok: boolean }, never, GitHub> =>
  Effect.gen(function* () {
    const gh = yield* GitHub
    const r = resultado(amb)
    const ok = aprovado(r)
    const avisar = (o: string) => (e: { readonly mensagem: string }) =>
      Effect.sync(() => amb.log(`::warning title=Segurança::${escaparDado(`não consegui ${o}: ${e.mensagem}`)}`))

    for (const linha of anotacoes(r)) amb.log(linha)
    const texto = summary(r)
    amb.log(texto)
    amb.anexarSummary(`${texto}\n`)

    let semPermissao = false
    if (amb.escopo === "diff" && amb.headSha) {
      yield* gh.gravarStatus(amb.headSha, ok ? "success" : "failure", descricaoStatus(r), amb.runUrl).pipe(
        Effect.catch((e) => {
          if (e.status !== 403 || amb.fork) return avisar("gravar o status «seguranca»")(e)
          semPermissao = true
          return Effect.sync(() =>
            amb.log(
              `::error title=Segurança::${
                escaparDado(`não consegui gravar o status «seguranca» (403): dê ao job do caller a permissão statuses: write. ${e.mensagem}`)
              }`,
            )
          )
        }),
      )
    }
    if (amb.bloquear && amb.escopo === "diff" && amb.prNumero !== undefined) {
      yield* gh.gravarComentario(amb.prNumero, comentario(r, amb.runUrl), ok).pipe(Effect.catch(avisar("comentar no PR")))
    }
    return { ok: ok && !semPermissao }
  })
