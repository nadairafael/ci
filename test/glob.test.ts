import { describe, expect, it } from "vitest"
import { casaAlgum, globParaRegex } from "../src/glob.js"

describe("glob", () => {
  it("os globs casam pastas em qualquer nível e só ali", () => {
    expect(globParaRegex("**/*.md").test("README.md")).toBe(true)
    expect(globParaRegex("**/*.md").test("apps/mobile/README.md")).toBe(true)
    expect(globParaRegex("docs/**").test("docs/a/b.html")).toBe(true)
    expect(globParaRegex("docs/**").test("apps/docs.ts")).toBe(false)
    expect(globParaRegex("**/test/**").test("apps/api/test/a.ts")).toBe(true)
    expect(globParaRegex("**/test/**").test("apps/api/contest/a.ts")).toBe(false)
    expect(globParaRegex("**/*.test.*").test("apps/mobile/src/teste.ts")).toBe(false)
  })

  it("chaves viram alternativas", () => {
    expect(globParaRegex("**/*.{png,jpg}").test("a/b.png")).toBe(true)
    expect(globParaRegex("**/*.{png,jpg}").test("b.jpg")).toBe(true)
    expect(globParaRegex("**/*.{png,jpg}").test("b.jpeg")).toBe(false)
  })

  it("casaAlgum testa contra qualquer glob da lista", () => {
    const casa = casaAlgum(["docs/**", "**/*.md"])
    expect(casa("docs/x.ts")).toBe(true)
    expect(casa("src/a.md")).toBe(true)
    expect(casa("src/a.ts")).toBe(false)
  })
})
