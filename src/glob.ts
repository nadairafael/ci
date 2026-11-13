// `**/` is zero or more folders, `**` anything, `*` and `?` stay inside one folder,
// `{a,b}` is an alternative (no nesting). Outside a closed `{...}`, `{`, `}` and `,` are literal.
export const globParaRegex = (glob: string): RegExp => {
  let re = ""
  let emChaves = false
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
    else if (c === "{" && !emChaves && glob.indexOf("}", i + 1) !== -1) {
      re += "(?:"
      emChaves = true
    } else if (c === "}" && emChaves) {
      re += ")"
      emChaves = false
    } else if (c === "," && emChaves) re += "|"
    else re += c.replace(/[.+^$(){}|[\]\\]/g, "\\$&")
  }
  // Every regex metacharacter is escaped above, and the only quantifier applied to a group is the
  // `?` of the fixed `(?:.*/)?`, which cannot repeat, so there are no nested repeats. The globs come from
  // `.github/portao.json` on the PR's base branch, which only the repository's owner controls.
  return new RegExp(`^${re}$`) // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
}

export const casaAlgum = (globs: ReadonlyArray<string>): ((caminho: string) => boolean) => {
  const regexes = globs.map(globParaRegex)
  return (caminho) => regexes.some((re) => re.test(caminho))
}
