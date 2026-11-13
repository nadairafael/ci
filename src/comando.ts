// Workflow command escaping: https://github.com/actions/toolkit/blob/main/packages/core/src/command.ts
// Without it a newline ends the annotation and the rest of the message is lost.
export const escaparDado = (s: string): string => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")
export const escaparPropriedade = (s: string): string => escaparDado(s).replace(/:/g, "%3A").replace(/,/g, "%2C")
