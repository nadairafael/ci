import { Data, Effect, Schema } from "effect"

// The shape of .github/portao.json. Every rule is off until the repo's config turns it on.
export const Config = Schema.Struct({
  tamanho: Schema.optionalKey(
    Schema.Struct({
      limite: Schema.Int.check(Schema.isGreaterThan(0)),
      ignorar: Schema.optionalKey(Schema.Array(Schema.String)),
      labelAprovado: Schema.optionalKey(Schema.String),
    }),
  ),
  soDocs: Schema.optionalKey(Schema.Array(Schema.String)),
  isento: Schema.optionalKey(Schema.Struct({ headRef: Schema.String, autor: Schema.String })),
})
export type Config = typeof Config.Type

export class ConfigInvalida extends Data.TaggedError("ConfigInvalida")<{ readonly mensagem: string }> {}

export const decodeConfig = (u: unknown): Effect.Effect<Config, ConfigInvalida> =>
  Schema.decodeUnknownEffect(Config, { onExcessProperty: "error" })(u).pipe(
    Effect.mapError((erro) => new ConfigInvalida({ mensagem: `.github/portao.json inválido: ${erro.message}` })),
  )

export const LABEL_APROVADO_PADRAO = "aprovado-nadai"

// Files that never count as logic. Data files are JSON, except the manifests below, which count.
export const IGNORAR_PADRAO: ReadonlyArray<string> = [
  "docs/**",
  "**/*.md",
  "**/*.test.*",
  "**/*.spec.*",
  "**/test/**",
  "**/testes/**",
  "**/__tests__/**",
  "**/e2e/**",
  "**/generated/**",
  "**/migrations/meta/**",
  "**/package-lock.json",
  "**/*.lock",
  "**/*.json",
  "**/*.{woff,woff2,ttf,otf,png,jpg,jpeg,gif,webp,ico,pdf,mp4,mp3,db,sqlite}",
]

// Checked before IGNORAR_PADRAO: these JSON files are code-like and count.
export const SEMPRE_CONTA: ReadonlyArray<string> = ["**/package.json", "**/tsconfig*.json"]

// A PR that touches these needs a human's eye: the config changes the gate, and any workflow can
// write the «portao» status (in a personal account nothing stops a workflow added by the PR).
export const ARQUIVOS_SENSIVEIS: ReadonlyArray<string> = [".github/portao.json", ".github/workflows/**"]
