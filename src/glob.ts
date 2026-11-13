// `**/` is zero or more folders, `**` anything, `*` and `?` stay inside one folder,
// `{a,b}` is an alternative (no nesting).
export const globParaRegex = (glob: string): RegExp => {
  let re = ""
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!
    if (c === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        re += "(?:.*/)?"
        i += 2
      } else {
        re += ".*"
        i += 1
      }
    } else if (c === "*") re += "[^/]*"
    else if (c === "?") re += "[^/]"
    else if (c === "{") re += "(?:"
    else if (c === "}") re += ")"
    else if (c === ",") re += "|"
    else re += c.replace(/[.+^$()|[\]\\]/g, "\\$&")
  }
  return new RegExp(`^${re}$`)
}

export const casaAlgum = (globs: ReadonlyArray<string>): ((caminho: string) => boolean) => {
  const regexes = globs.map(globParaRegex)
  return (caminho) => regexes.some((re) => re.test(caminho))
}
