import { Data, Effect, Option, Schema } from "effect"
import { avaliar, type Resultado } from "./avaliar.js"
import { escaparDado } from "./comando.js"
import { type Config, LABEL_APROVADO_PADRAO } from "./config.js"
import { GitHub, PrDaApi } from "./github.js"
import { comentario, descricaoStatus, summary } from "./relatorio.js"

// Everything the program reads from the runner, so tests can hand it in.
export interface Ambiente {
  readonly evento: string
  readonly payload: unknown
  // GITHUB_SHA: the merge commit on pull_request, the branch head on workflow_dispatch.
  readonly sha: string
  readonly dono: string
  readonly runUrl: string
  readonly prNumero: string | undefined
  // workflow_dispatch only: the PR head the dispatch is for. Lets a caller dispatch on its default
  // branch (where the App's environment lives) and still never pass a head that moved.
  readonly prSha: string | undefined
  // The caller asked for the App (app-client-id) and no App token came out: the gate fails and says why.
  readonly appSemToken?: string | undefined
  readonly log: (linha: string) => void
  readonly anexarSummary: (texto: string) => void
}

// The commit a dispatched run is for: the `sha` input when given, otherwise the run's own commit.
const shaDoRun = (amb: Ambiente): string => amb.prSha ?? amb.sha

class Motivo extends Data.TaggedError("Motivo")<{ readonly mensagem: string }> {}

const falhaSemPr = (mensagem: string): Resultado => ({
  ok: false, motivos: [mensagem], contados: [], aprovado: false, tipo: "normal", sensiveis: [],
})

const lerPrDoEvento = (amb: Ambiente) =>
  Effect.gen(function* () {
    const gh = yield* GitHub
    if (amb.evento === "workflow_dispatch") {
      if (!/^[1-9]\d*$/.test(amb.prNumero ?? "")) {
        return yield* new Motivo({ mensagem: `o número do PR do disparo não é válido: «${amb.prNumero ?? ""}»` })
      }
      return yield* gh.lerPr(Number(amb.prNumero))
    }
    const pr = (amb.payload as { pull_request?: unknown } | null)?.pull_request
    return yield* Schema.decodeUnknownEffect(PrDaApi)(pr).pipe(
      Effect.mapError(() => new Motivo({ mensagem: "o evento não traz um pull_request legível" })),
    )
  })

export const programa = (amb: Ambiente): Effect.Effect<{ readonly ok: boolean }, never, GitHub> =>
  Effect.gen(function* () {
    const gh = yield* GitHub

    const lido = yield* lerPrDoEvento(amb).pipe(Effect.result)
    if (lido._tag === "Failure") {
      const r = falhaSemPr(lido.failure._tag === "Motivo" ? lido.failure.mensagem : `O portão não conseguiu ler o PR: ${lido.failure.mensagem}`)
      return yield* publicar(amb, r, undefined, undefined, amb.evento === "workflow_dispatch" ? shaDoRun(amb) : amb.sha)
    }
    const pr = lido.success
    // A dispatched run for a head that has since moved judges an old commit: its failure goes on that
    // commit, and it leaves the comment alone, so it never overwrites the verdict on the new head.
    const obsoleto = amb.evento === "workflow_dispatch" && pr.head.sha !== shaDoRun(amb)
    const numero = obsoleto ? undefined : pr.number
    const alvo = obsoleto ? shaDoRun(amb) : pr.head.sha
    if (amb.appSemToken !== undefined) {
      return yield* publicar(amb, falhaSemPr(amb.appSemToken), undefined, numero, alvo)
    }

    const avaliado = yield* Effect.gen(function* () {
      const [config, arquivos] = yield* Effect.all([gh.lerConfig(pr.base.sha), gh.lerArquivos(pr.number)], {
        concurrency: "unbounded",
      })
      const configDoBase: Config | undefined = Option.getOrUndefined(config)
      const label = configDoBase?.tamanho?.labelAprovado ?? LABEL_APROVADO_PADRAO
      const labels = pr.labels.map((l) => l.name)
      const aplicadaPor = labels.includes(label) ? yield* gh.labelAplicadaPor(pr.number, label) : Option.none<string>()
      const r = avaliar({
        config: configDoBase,
        labels,
        labelAplicadaPeloDono: Option.getOrUndefined(aplicadaPor) === amb.dono,
        autor: pr.user.login,
        headRef: pr.head.ref,
        headSha: pr.head.sha,
        shaDoRun: amb.evento === "workflow_dispatch" ? shaDoRun(amb) : undefined,
        changedFiles: pr.changed_files,
        arquivos,
      })
      return { r, config: configDoBase }
    }).pipe(
      Effect.catch((erro) =>
        Effect.succeed({
          r: falhaSemPr(erro._tag === "ConfigInvalida" ? erro.mensagem : `O portão não conseguiu ler o PR: ${erro.mensagem}`),
          config: undefined,
        })
      ),
    )
    return yield* publicar(amb, avaliado.r, avaliado.config, numero, alvo)
  })

// Comment, commit status, annotations and summary. A failed write is a warning: the verdict stands.
const publicar = (amb: Ambiente, r: Resultado, config: Config | undefined, numero: number | undefined, sha: string) =>
  Effect.gen(function* () {
    const gh = yield* GitHub
    const avisar = (o: string) => (e: { readonly mensagem: string }) =>
      Effect.sync(() => amb.log(`::warning title=Portão::${escaparDado(`não consegui ${o}: ${e.mensagem}`)}`))
    if (numero !== undefined) {
      yield* gh.gravarComentario(numero, comentario(r, config, amb.runUrl)).pipe(Effect.catch(avisar("comentar no PR")))
    }
    if (sha) {
      yield* gh.gravarStatus(sha, r.ok ? "success" : "failure", descricaoStatus(r), amb.runUrl).pipe(
        Effect.catch(avisar("gravar o status «portao»")),
      )
    }
    for (const m of r.motivos) amb.log(`::error title=Portão::${escaparDado(m)}`)
    const texto = summary(r, config)
    amb.log(texto)
    amb.anexarSummary(`${texto}\n`)
    return { ok: r.ok }
  })
