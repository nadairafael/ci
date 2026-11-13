# ci

Portão de PR e CI reutilizáveis para os projetos do Nadai.

O portão roda nas máquinas do GitHub, responde em segundos e escreve o motivo **no próprio PR**: o número, o limite e o que fazer. Ele também grava o commit status `portao` no head do PR, que é o contexto que um ruleset pode exigir.

## Adotar num repo

1. **Settings → Actions → General:** permitir actions e workflows reutilizáveis de outros repositórios ("Allow all actions and reusable workflows", ou incluir `nadairafael/ci` na lista).
2. **Criar `.github/workflows/portao.yml`:**

   ```yaml
   name: Portão
   on:
     pull_request:
       branches: [main]
       types: [opened, synchronize, reopened, labeled, unlabeled, ready_for_review]
     workflow_dispatch:
       inputs:
         pr: { description: Número do PR, type: number, required: true }
   concurrency:
     group: portao-${{ github.ref }}
     cancel-in-progress: ${{ github.event_name != 'workflow_dispatch' }}
   permissions:
     contents: read
   jobs:
     portao:
       permissions:
         contents: read
         pull-requests: write
         issues: write
         statuses: write
       uses: nadairafael/ci/.github/workflows/portao.yml@v1
       with:
         pr: ${{ format('{0}', inputs.pr) }}
   ```

   Depois, criar o `.github/portao.json` com as regras que fazem sentido para o repo (veja abaixo).
3. **Criar a label de aprovação**, se o repo usar a regra de tamanho: `gh label create aprovado-nadai`.

Se o repo exige checks por ruleset, exija o contexto **`portao`** (o commit status), não o check do job (`portao / portao`).

## Regras (`.github/portao.json`)

Nenhuma regra fica ligada sem config. O arquivo é lido do **branch base** do PR. Por isso, mudar o config num PR só vale depois do merge, e o PR não consegue afrouxar o próprio portão. Um PR que mexe no `portao.json` ou no `portao.yml` recebe um aviso de "olho humano" no comentário.

| Campo | O que faz |
|---|---|
| `tamanho.limite` | Máximo de linhas de lógica (adições + remoções) por PR. |
| `tamanho.ignorar` | Globs que não contam, somados ao padrão: docs, markdown, testes, gerados, lockfiles, JSON de dados e binários. `package.json` e `tsconfig*.json` sempre contam. |
| `tamanho.labelAprovado` | A label que libera o limite (padrão `aprovado-nadai`). Ela só vale se quem a aplicou foi o dono do repo. |
| `soDocs` | Globs de documentação: um PR que só mexe nesses arquivos passa. |
| `isento` | `{ headRef, autor }`: o PR com essa branch **e** esse autor passa (ex.: «Versão nova» do changesets). |

Exemplo:

```json
{
  "tamanho": { "limite": 400, "ignorar": ["prototipo/**"], "labelAprovado": "aprovado-nadai" },
  "soDocs": ["docs/**", "**/*.md"],
  "isento": { "headRef": "changeset-release/main", "autor": "github-actions[bot]" }
}
```

## CI Node (`ci-node.yml`)

Roda o CI de um repo Node **num job só**: uma vaga na fila e uma instalação por run. Depois disso, cada script do `package.json` roda como um passo próprio. Um script que não existe é pulado com aviso no summary.

```yaml
jobs:
  ci:
    uses: nadairafael/ci/.github/workflows/ci-node.yml@v1
    with:
      runner: ${{ vars.NAD_CI_RUNNER || '["self-hosted","macOS"]' }}
      scripts: '["typecheck","lint","test"]'
      env: '{"WRANGLER_SEND_METRICS":"false"}'
```

## Desenvolvimento

```sh
npm ci
npm test            # vitest + @effect/vitest
npm run typecheck
npm run build       # gera dist/portao.mjs (commitado)
```

O `dist/portao.mjs` é commitado, e o CI falha se ele estiver desatualizado em relação a `src/`. Para lançar uma versão: `git tag v1.x.y`, depois mover a tag `v1` (`git tag -f v1 && git push -f origin v1`).
