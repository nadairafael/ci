// Pure: the copy the security workflow writes (summary, annotations, status, comment). pt-BR, and
// pinned by the tests: it is part of the contract.
import { escaparDado, escaparPropriedade } from "../comando.js"
import { type Achado, type Ferramenta, FERRAMENTAS, type Situacao } from "./achados.js"

// Hidden marker of the security comment, distinct from the gate's.
export const MARCADOR_SEGURANCA = "<!-- seguranca:nadairafael/ci -->"

export interface Resultado {
  readonly escopo: "diff" | "completo"
  readonly bloquear: boolean
  readonly situacoes: Readonly<Record<Ferramenta, Situacao>>
  readonly sensiveis: ReadonlyArray<string>
}

const NOME: Record<Ferramenta, string> = { osv: "OSV-Scanner", semgrep: "Semgrep", gitleaks: "gitleaks" }

export const achadosDe = (r: Resultado): ReadonlyArray<Achado> =>
  FERRAMENTAS.flatMap((f) => {
    const s = r.situacoes[f]
    return s._tag === "Rodou" ? s.achados : []
  })

const comErro = (r: Resultado): ReadonlyArray<Ferramenta> => FERRAMENTAS.filter((f) => r.situacoes[f]._tag === "Erro")

// Blocks only with `bloquear`: then a new finding, or a tool that did not run, fails the run.
export const aprovado = (r: Resultado): boolean => !r.bloquear || (achadosDe(r).length === 0 && comErro(r).length === 0)

const contagem = (r: Resultado): string => {
  const n = achadosDe(r).length
  const novo = r.escopo === "diff"
  if (n === 0) return novo ? "nenhum achado novo" : "nenhum achado"
  if (n === 1) return novo ? "1 achado novo" : "1 achado"
  return novo ? `${n} achados novos` : `${n} achados`
}

// The verdict in one line: shared by the summary title, the status and the comment.
const frase = (r: Resultado): string => {
  const partes = [contagem(r)]
  const erros = comErro(r)
  if (erros.length > 0) partes.push(`não rodou: ${erros.map((f) => NOME[f]).join(", ")}`)
  if (r.situacoes.semgrep._tag === "Rascunho") partes.push("Semgrep pulado no rascunho")
  const avisa = !r.bloquear && (achadosDe(r).length > 0 || erros.length > 0)
  return `${partes.join("; ")}${avisa ? " (só aviso)" : ""}`
}

const titulo = (r: Resultado): string => {
  const limpo = achadosDe(r).length === 0 && comErro(r).length === 0
  const emoji = limpo ? "✅" : aprovado(r) ? "⚠️" : "❌"
  return `${emoji} **Segurança:** ${frase(r)}.`
}

// The commit status description: GitHub caps it at 140 characters.
export const descricaoStatus = (r: Resultado): string => {
  const texto = frase(r)
  return texto.length <= 140 ? texto : `${texto.slice(0, 139)}…`
}

const celula = (texto: string): string => texto.replace(/\|/g, "\\|").replace(/\r?\n/g, " ")

const situacaoTexto = (s: Situacao): string => {
  switch (s._tag) {
    case "Rodou":
      return "rodou"
    case "Fora":
      return "fora (input `ferramentas`)"
    case "Rascunho":
      return "pulado: PR em rascunho"
    case "Erro":
      return `não rodou: ${s.motivo}`
  }
}

const AVISO_SENSIVEIS = (arquivos: ReadonlyArray<string>) =>
  `⚠️ Este PR mexe na supressão de achados (${arquivos.join(", ")}): precisa de olho humano. Supressões novas só valem depois do merge.`

// The step summary: the verdict, one row per tool, then one table per tool with findings.
export const summary = (r: Resultado): string => {
  const linhas = [
    titulo(r),
    "",
    r.escopo === "diff"
      ? "Escopo: **diff**, só o que o PR introduziu em relação à base."
      : "Escopo: **completo**, o repo inteiro.",
    "",
    "| Ferramenta | Situação | Achados |",
    "|---|---|---|",
    ...FERRAMENTAS.map((f) => {
      const s = r.situacoes[f]
      return `| ${NOME[f]} | ${celula(situacaoTexto(s))} | ${s._tag === "Rodou" ? s.achados.length : "—"} |`
    }),
  ]
  for (const f of FERRAMENTAS) {
    const s = r.situacoes[f]
    if (s._tag !== "Rodou" || s.achados.length === 0) continue
    linhas.push("", `### ${NOME[f]}`, "", "| Arquivo | Linha | Regra | Severidade | O quê |", "|---|---|---|---|---|")
    for (const a of s.achados) {
      const regra = a.link ? `[${celula(a.regra)}](${a.link})` : `\`${celula(a.regra)}\``
      linhas.push(
        `| \`${celula(a.arquivo)}\` | ${a.linha ?? "—"} | ${regra} | ${celula(a.severidade)} | ${celula(a.mensagem)} |`,
      )
    }
  }
  if (r.sensiveis.length > 0) linhas.push("", AVISO_SENSIVEIS(r.sensiveis))
  return linhas.join("\n")
}

// One annotation per finding (on the file and line, shown in the PR's "Files changed"), and one per
// tool that did not run. `::error` with `bloquear`, `::warning` otherwise. Never a secret's value.
export const anotacoes = (r: Resultado): ReadonlyArray<string> => {
  const nivel = r.bloquear ? "error" : "warning"
  const deAchados = achadosDe(r).map((a) => {
    const props = [
      `file=${escaparPropriedade(a.arquivo)}`,
      ...(a.linha !== undefined ? [`line=${a.linha}`] : []),
      `title=${escaparPropriedade(`${NOME[a.ferramenta]}: ${a.regra}`)}`,
    ]
    return `::${nivel} ${props.join(",")}::${escaparDado(a.mensagem)}`
  })
  const deErros = FERRAMENTAS.flatMap((f) => {
    const s = r.situacoes[f]
    return s._tag === "Erro" ? [`::${nivel} title=Segurança::${escaparDado(`${NOME[f]} não rodou: ${s.motivo}`)}`] : []
  })
  return [...deAchados, ...deErros]
}

const MAX_NO_COMENTARIO = 20

// The pinned comment, written only with `bloquear`: on a failing run it says why (golden rule 1);
// on a passing run it only replaces an earlier failing one.
export const comentario = (r: Resultado, runUrl: string): string => {
  const linhas = [MARCADOR_SEGURANCA, titulo(r)]
  if (!aprovado(r)) {
    const achados = achadosDe(r)
    for (const a of achados.slice(0, MAX_NO_COMENTARIO)) {
      linhas.push(`- ${NOME[a.ferramenta]} \`${a.regra}\` em \`${a.arquivo}${a.linha ? `:${a.linha}` : ""}\`: ${a.mensagem}`)
    }
    if (achados.length > MAX_NO_COMENTARIO) linhas.push(`- e mais ${achados.length - MAX_NO_COMENTARIO} no summary do run.`)
    for (const f of comErro(r)) {
      const s = r.situacoes[f]
      if (s._tag === "Erro") linhas.push(`- ${NOME[f]} não rodou: ${s.motivo}.`)
    }
    linhas.push(
      "**Como resolver:** corrija o achado, ou suprima com o mecanismo da ferramenta (`osv-scanner.toml`, `// nosemgrep: <regra>`, `.gitleaksignore`). A supressão só vale depois do merge.",
    )
  }
  if (r.sensiveis.length > 0) linhas.push(AVISO_SENSIVEIS(r.sensiveis))
  linhas.push(`[Ver o run](${runUrl})`)
  return linhas.join("\n")
}
