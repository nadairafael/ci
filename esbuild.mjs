// Bundles each entry into one file with no runtime dependencies, so the reusable workflows run it
// without npm install. dist/ is committed; CI fails when it is stale.
import { build } from "esbuild"

const entradas = [
  ["src/main.ts", "dist/portao.mjs"],
  ["src/seguranca/main.ts", "dist/seguranca.mjs"],
]

for (const [entrada, saida] of entradas) {
  await build({
    entryPoints: [entrada],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    outfile: saida,
    legalComments: "none",
    banner: { js: "// Gerado por esbuild.mjs a partir de src/. Não edite à mão." },
  })
}
