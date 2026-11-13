import { ARQUIVOS_SENSIVEIS, type Config, IGNORAR_PADRAO, LABEL_APROVADO_PADRAO, SEMPRE_CONTA } from "./config.js"
import { casaAlgum } from "./glob.js"

// The most files the "list pull request files" endpoint returns (github.ts stops there).
export const MAX_ARQUIVOS_API = 3000

export interface Arquivo {
  readonly filename: string
  // Set on renames: a rename touches both paths, so moving code into docs/ is not a docs-only PR.
  readonly previous_filename?: string | undefined
  readonly additions: number
  readonly deletions: number
}

export interface Entrada {
  readonly config: Config | undefined
  readonly labels: ReadonlyArray<string>
  readonly labelAplicadaPeloDono: boolean
  readonly autor: string
  readonly headRef: string
  readonly headSha: string
  // Given only on workflow_dispatch: a run started for an older head never passes a newer one.
  readonly shaDoRun?: string | undefined
  readonly changedFiles: number
  readonly arquivos: ReadonlyArray<Arquivo>
}

export interface Resultado {
  readonly ok: boolean
  readonly motivos: ReadonlyArray<string>
  readonly contados: ReadonlyArray<{ readonly arquivo: string; readonly linhas: number }>
  readonly total?: number
  readonly limite?: number
  readonly aprovado: boolean
  readonly tipo: "normal" | "isento" | "soDocs" | "semRegras"
  readonly sensiveis: ReadonlyArray<string>
}

const caminhos = (a: Arquivo): ReadonlyArray<string> =>
  a.previous_filename === undefined ? [a.filename] : [a.filename, a.previous_filename]

const falha = (motivo: string): Resultado => ({
  ok: false, motivos: [motivo], contados: [], aprovado: false, tipo: "normal", sensiveis: [],
})

export const avaliar = (e: Entrada): Resultado => {
  if (e.shaDoRun !== undefined && e.headSha !== e.shaDoRun) {
    return falha(`O PR mudou depois do disparo: o head é ${e.headSha}, e este run é do commit ${e.shaDoRun}.`)
  }
  if (e.changedFiles > MAX_ARQUIVOS_API) {
    return falha(
      `O PR tem ${e.changedFiles} arquivos, e a API do GitHub lista no máximo ${MAX_ARQUIVOS_API}: o portão não confere uma lista incompleta. Divida o PR.`,
    )
  }
  if (e.arquivos.length < e.changedFiles) {
    return falha(
      `A lista de arquivos lida tem ${e.arquivos.length} de ${e.changedFiles} arquivos do PR: o portão não confere uma lista incompleta.`,
    )
  }

  const ehSensivel = casaAlgum(ARQUIVOS_SENSIVEIS)
  const sensiveis = [...new Set(e.arquivos.flatMap(caminhos).filter(ehSensivel))]
  const base = { contados: [], aprovado: false, sensiveis } as const
  const config = e.config

  if (config?.isento && e.headRef === config.isento.headRef && e.autor === config.isento.autor) {
    return { ...base, ok: true, motivos: [], tipo: "isento" }
  }
  if (config?.soDocs) {
    const ehDoc = casaAlgum(config.soDocs)
    if (e.arquivos.length > 0 && e.arquivos.every((a) => caminhos(a).every(ehDoc))) {
      return { ...base, ok: true, motivos: [], tipo: "soDocs" }
    }
  }
  const tamanho = config?.tamanho
  if (!tamanho) return { ...base, ok: true, motivos: [], tipo: "semRegras" }

  const conta = casaAlgum(SEMPRE_CONTA)
  const ignora = casaAlgum([...IGNORAR_PADRAO, ...(tamanho.ignorar ?? [])])
  const contados = e.arquivos
    .filter((a) => conta(a.filename) || !ignora(a.filename))
    .map((a) => ({ arquivo: a.filename, linhas: a.additions + a.deletions }))
  const total = contados.reduce((soma, c) => soma + c.linhas, 0)
  const label = tamanho.labelAprovado ?? LABEL_APROVADO_PADRAO
  const temLabel = e.labels.includes(label)
  const aprovado = temLabel && e.labelAplicadaPeloDono

  const motivos: Array<string> = []
  if (total > tamanho.limite && !aprovado) {
    motivos.push(`O PR soma ${total} linhas de lógica, acima do limite de ${tamanho.limite}.`)
    if (temLabel) {
      motivos.push(`A label «${label}» não foi aplicada pelo dono do repo, então não libera o limite.`)
    }
  }
  return { ok: motivos.length === 0, motivos, contados, total, limite: tamanho.limite, aprovado, tipo: "normal", sensiveis }
}
