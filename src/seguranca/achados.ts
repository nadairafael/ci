// Pure: turns each tool's exit code and JSON output into findings. No services, no I/O.
import { Option, Schema } from "effect"

export type Ferramenta = "osv" | "semgrep" | "gitleaks"
export const FERRAMENTAS: ReadonlyArray<Ferramenta> = ["osv", "semgrep", "gitleaks"]

export interface Achado {
  readonly ferramenta: Ferramenta
  readonly arquivo: string
  readonly linha: number | undefined
  readonly regra: string
  readonly severidade: string
  readonly mensagem: string
  readonly link: string | undefined
}

// What happened to one tool in this run.
export type Situacao =
  | { readonly _tag: "Rodou"; readonly achados: ReadonlyArray<Achado> }
  | { readonly _tag: "Fora" } // not in the `ferramentas` input
  | { readonly _tag: "Rascunho" } // semgrep on a draft PR
  | { readonly _tag: "Erro"; readonly motivo: string }

// The raw output of one run of a tool: its exit code and its JSON report, as read from disk.
export interface Saida {
  readonly exit: string | undefined
  readonly json: string | undefined
}

const erro = (motivo: string): Situacao => ({ _tag: "Erro", motivo })

// Checks the exit code against the codes the tool uses for "ran fine", then decodes the report.
const decodificar = <S extends Schema.Constraint & { readonly DecodingServices: never }>(
  schema: S,
  saida: Saida,
  aceitos: ReadonlyArray<number>,
): { readonly _tag: "Ok"; readonly valor: S["Type"] } | { readonly _tag: "Erro"; readonly motivo: string } => {
  const exit = saida.exit?.trim()
  if (exit === undefined || exit === "") return { _tag: "Erro", motivo: "o passo não terminou" }
  if (!aceitos.includes(Number(exit))) return { _tag: "Erro", motivo: `saiu com código ${exit}` }
  let bruto: unknown
  try {
    bruto = JSON.parse(saida.json ?? "")
  } catch {
    return { _tag: "Erro", motivo: "o relatório não é JSON" }
  }
  return Option.match(Schema.decodeUnknownOption(schema)(bruto), {
    onNone: () => ({ _tag: "Erro", motivo: "o relatório tem um formato inesperado" }),
    onSome: (valor) => ({ _tag: "Ok", valor }),
  })
}

const primeiraLinha = (texto: string, max = 200): string => {
  const l = texto.trim().split("\n")[0] ?? ""
  return l.length <= max ? l : `${l.slice(0, max - 1)}…`
}

// ---------- OSV-Scanner ----------

const OsvSaida = Schema.Struct({
  results: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Struct({
    source: Schema.Struct({ path: Schema.String }),
    packages: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Struct({
      package: Schema.Struct({
        name: Schema.String,
        version: Schema.optionalKey(Schema.String),
        ecosystem: Schema.String,
      }),
      groups: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Struct({
        ids: Schema.Array(Schema.String),
        aliases: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))),
        max_severity: Schema.optionalKey(Schema.String),
      })))),
      vulnerabilities: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Struct({
        id: Schema.String,
        summary: Schema.optionalKey(Schema.String),
      })))),
    })))),
  })))),
})

interface Vulneravel {
  readonly arquivo: string
  readonly pacote: string // "<ecosystem>/<name>"
  readonly ids: ReadonlyArray<string> // the group's ids plus aliases
  readonly achado: Achado
}

const relativo = (caminho: string, raiz: string): string => {
  const prefixo = raiz.endsWith("/") ? raiz : `${raiz}/`
  return raiz !== "" && caminho.startsWith(prefixo) ? caminho.slice(prefixo.length) : caminho
}

// One finding per (lockfile, package, vulnerability group): a group joins the ids that are aliases.
const vulneraveis = (saida: typeof OsvSaida.Type, raiz: string): ReadonlyArray<Vulneravel> =>
  (saida.results ?? []).flatMap((r) =>
    (r.packages ?? []).flatMap((p) =>
      (p.groups ?? []).map((g) => {
        const id = g.ids[0] ?? "?"
        const resumo = (p.vulnerabilities ?? []).find((v) => g.ids.includes(v.id))?.summary
        const versao = p.package.version ? `@${p.package.version}` : ""
        const arquivo = relativo(r.source.path, raiz)
        return {
          arquivo,
          pacote: `${p.package.ecosystem}/${p.package.name}`,
          ids: [...g.ids, ...(g.aliases ?? [])],
          achado: {
            ferramenta: "osv",
            arquivo,
            linha: undefined,
            regra: id,
            severidade: g.max_severity && g.max_severity !== "" ? g.max_severity : "—",
            mensagem: primeiraLinha(`${p.package.name}${versao}${resumo ? `: ${resumo}` : ""}`),
            link: `https://osv.dev/vulnerability/${id}`,
          },
        }
      })
    )
  )

// osv-scanner exits 1 when it finds vulnerabilities; 0 when it finds none.
const OSV_OK = [0, 1]

// In diff mode only what the head has and the base does not: same lockfile, same package, and no
// id or alias in common. Without a base (full scan) everything in the head.
export const situacaoOsv = (
  head: Saida,
  base: Saida | undefined,
  raizes: { readonly head: string; readonly base: string },
): Situacao => {
  const h = decodificar(OsvSaida, head, OSV_OK)
  if (h._tag === "Erro") return erro(h.motivo)
  const doHead = vulneraveis(h.valor, raizes.head)
  if (base === undefined) return { _tag: "Rodou", achados: doHead.map((v) => v.achado) }
  const b = decodificar(OsvSaida, base, OSV_OK)
  if (b._tag === "Erro") return erro(`na base: ${b.motivo}`)
  const naBase = new Set(
    vulneraveis(b.valor, raizes.base).flatMap((v) => v.ids.map((id) => `${v.arquivo}|${v.pacote}|${id}`)),
  )
  return {
    _tag: "Rodou",
    achados: doHead.filter((v) => !v.ids.some((id) => naBase.has(`${v.arquivo}|${v.pacote}|${id}`))).map((v) =>
      v.achado
    ),
  }
}

// ---------- Semgrep ----------

const SemgrepSaida = Schema.Struct({
  results: Schema.Array(Schema.Struct({
    check_id: Schema.String,
    path: Schema.String,
    start: Schema.Struct({ line: Schema.Number }),
    extra: Schema.Struct({
      message: Schema.optionalKey(Schema.String),
      severity: Schema.optionalKey(Schema.String),
      metadata: Schema.optionalKey(Schema.Unknown),
    }),
  })),
})

const linkDaRegra = (metadata: unknown): string | undefined => {
  const m = metadata as { source?: unknown; shortlink?: unknown } | null | undefined
  const link = typeof m?.shortlink === "string" ? m.shortlink : typeof m?.source === "string" ? m.source : undefined
  return link?.startsWith("https://") ? link : undefined
}

// With --baseline-commit semgrep already reports only what is new; without it, everything.
// Without --error it exits 0 whether or not it finds something.
export const situacaoSemgrep = (saida: Saida): Situacao => {
  const s = decodificar(SemgrepSaida, saida, [0])
  if (s._tag === "Erro") return erro(s.motivo)
  return {
    _tag: "Rodou",
    achados: s.valor.results.map((r) => ({
      ferramenta: "semgrep",
      arquivo: r.path,
      linha: r.start.line,
      regra: r.check_id,
      severidade: r.extra.severity ?? "—",
      mensagem: primeiraLinha(r.extra.message ?? r.check_id),
      link: linkDaRegra(r.extra.metadata),
    })),
  }
}

// ---------- gitleaks ----------

// Only the fields that say where and which rule. The report's Secret and Match are never read, even
// though --redact already blanks them.
const GitleaksSaida = Schema.Array(Schema.Struct({
  RuleID: Schema.String,
  Description: Schema.optionalKey(Schema.String),
  File: Schema.String,
  StartLine: Schema.Number,
  Commit: Schema.optionalKey(Schema.String),
  Fingerprint: Schema.optionalKey(Schema.String),
}))

// Run with --exit-code 0, so any other code is an error. The commit range already limits it to the PR.
export const situacaoGitleaks = (saida: Saida): Situacao => {
  const s = decodificar(GitleaksSaida, saida, [0])
  if (s._tag === "Erro") return erro(s.motivo)
  return {
    _tag: "Rodou",
    achados: s.valor.map((g) => ({
      ferramenta: "gitleaks",
      arquivo: g.File,
      linha: g.StartLine,
      regra: g.RuleID,
      severidade: "segredo",
      mensagem: primeiraLinha(
        [
          g.Description ?? "possível segredo",
          g.Commit ? `commit ${g.Commit.slice(0, 7)}` : undefined,
          g.Fingerprint ? `fingerprint ${g.Fingerprint}` : undefined,
        ].filter((x) => x !== undefined).join("; "),
        400,
      ),
      link: undefined,
    })),
  }
}

// ---------- Suppression files ----------

// The files through which a project silences a finding, plus the caller. A PR that touches any of
// them gets the human-eye warning; they only take effect from the base branch.
const SUPRESSAO = new Set(["osv-scanner.toml", ".semgrepignore", ".gitleaksignore", ".gitleaks.toml"])

export const sensiveis = (alterados: ReadonlyArray<string>): ReadonlyArray<string> =>
  alterados.filter((a) => SUPRESSAO.has(a.split("/").at(-1) ?? "") || a === ".github/workflows/seguranca.yml")

// ---------- Inline suppressions added by the PR ----------

// A line the PR added with `nosemgrep` / `nosem` or `gitleaks:allow`. It silences a finding in this
// same PR, so it gets the human-eye warning.
export interface NaLinha {
  readonly arquivo: string
  readonly linha: number
  readonly marcador: string
}

// Reads the "path<TAB>line<TAB>marker" lines the workflow's diff step writes.
export const supressoesNaLinha = (texto: string): ReadonlyArray<NaLinha> =>
  texto.split("\n").flatMap((l) => {
    const [arquivo, linha, marcador] = l.split("\t")
    return arquivo && marcador && /^[1-9]\d*$/.test(linha ?? "") ? [{ arquivo, linha: Number(linha), marcador }] : []
  })
