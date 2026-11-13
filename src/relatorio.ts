import type { Resultado } from "./avaliar.js"
import { type Config, LABEL_APROVADO_PADRAO } from "./config.js"
import { MARCADOR } from "./github.js"

const labelDe = (config: Config | undefined) => config?.tamanho?.labelAprovado ?? LABEL_APROVADO_PADRAO
const ehMotivoDeTamanho = (m: string) => /linhas de lógica, acima do limite/.test(m)

const titulo = (r: Resultado, config: Config | undefined): string => {
  if (!r.ok) {
    return r.total !== undefined && r.motivos.some(ehMotivoDeTamanho)
      ? `❌ **Portão:** ${r.total} linhas de lógica (limite ${r.limite}).`
      : "❌ **Portão:** não está pronto para merge."
  }
  switch (r.tipo) {
    case "soDocs":
      return "✅ **Portão ok:** PR só de documentação."
    case "isento":
      return "✅ **Portão ok:** PR «Versão nova», isento."
    case "semRegras":
      return "✅ **Portão ok:** nenhuma regra ligada neste repo."
    case "normal":
      return r.aprovado && (r.total ?? 0) > (r.limite ?? 0)
        ? `✅ **Portão ok** (${r.total}/${r.limite} linhas, liberado pela label «${labelDe(config)}»).`
        : `✅ **Portão ok** (${r.total}/${r.limite} linhas).`
  }
}

// The body of the PR's pinned comment. The first line is always the marker.
export const comentario = (r: Resultado, config: Config | undefined, runUrl: string): string => {
  const linhas = [MARCADOR, titulo(r, config)]
  if (!r.ok) {
    const doTamanho = r.motivos.some(ehMotivoDeTamanho)
    if (doTamanho) {
      const maiores = [...r.contados].sort((a, b) => b.linhas - a.linhas).slice(0, 5)
      linhas.push(`Maiores: ${maiores.map((c) => `\`${c.arquivo}\` ${c.linhas}`).join(" · ")}`)
    }
    for (const m of r.motivos.filter((m) => !ehMotivoDeTamanho(m))) linhas.push(`- ${m}`)
    if (doTamanho) {
      linhas.push(`**Como resolver:** divida o PR, ou peça ao dono do repo a label «${labelDe(config)}».`)
    }
  }
  if (r.sensiveis.length > 0) {
    linhas.push(
      `⚠️ Este PR mexe no portão ou em workflows (${r.sensiveis.join(", ")}): precisa de olho humano. Um workflow do PR pode gravar o status «portao», e regras novas só valem depois do merge.`,
    )
  }
  linhas.push(`[Ver o run](${runUrl})`)
  return linhas.join("\n")
}

// The commit status description: GitHub caps it at 140 characters.
export const descricaoStatus = (r: Resultado): string => {
  const texto = (() => {
    if (r.tipo === "soDocs") return "só documentação"
    if (r.tipo === "isento") return "isento"
    if (r.tipo === "semRegras") return "sem regras"
    if (r.total !== undefined && r.limite !== undefined) {
      return r.ok ? `${r.total}/${r.limite} linhas` : `acima do limite: ${r.total}/${r.limite}`
    }
    return r.motivos[0] ?? (r.ok ? "ok" : "falhou")
  })()
  return texto.length <= 140 ? texto : `${texto.slice(0, 139)}…`
}

// The step summary: the same verdict plus every counted file.
export const summary = (r: Resultado, config: Config | undefined): string => {
  const linhas = [titulo(r, config), ...r.motivos.map((m) => `- ${m}`)]
  if (r.total !== undefined) {
    linhas.push("", `Linhas de lógica: ${r.total} (limite ${r.limite}).`)
    for (const c of r.contados) linhas.push(`- ${c.arquivo}: ${c.linhas}`)
  }
  return linhas.join("\n")
}
