// Bundles the gate into one file with no runtime dependencies, so the reusable workflow
// runs it without npm install. dist/ is committed; CI fails when it is stale.
import { build } from "esbuild"

await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: "dist/portao.mjs",
  legalComments: "none",
  banner: { js: "// Gerado por esbuild.mjs a partir de src/. Não edite à mão." },
})
