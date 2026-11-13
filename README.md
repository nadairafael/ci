# ci

Portão de PR, CI e checagem de segurança reutilizáveis para os projetos do Nadai.

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

## Segurança (`seguranca.yml`)

Roda três ferramentas de código aberto nas máquinas do GitHub (`ubuntu-latest`), sem code scanning:

- **OSV-Scanner:** dependências com vulnerabilidade conhecida, pelos lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `poetry.lock`, `uv.lock`, `Pipfile.lock`, `requirements*.txt`);
- **Semgrep CE:** padrões inseguros no código, com as regras do registry (padrão `p/default`), baixadas a cada run;
- **gitleaks:** segredos nos commits do PR, com `--redact` (o valor de um segredo nunca aparece).

Num PR, só conta o que o diff introduziu: o que já existia na base não aparece. O resultado vai para o summary do run, para anotações nos arquivos e para o commit status **`seguranca`** no head do PR. Por padrão, **só avisa**: o status fica `success` com "N achados novos (só aviso)". Com `bloquear: true`, um achado novo (ou uma ferramenta que não rodou) dá `failure` e um comentário fixo no PR dizendo o quê.

**Num PR em rascunho, o Semgrep não roda** (é a etapa mais cara); o OSV e o gitleaks rodam sempre. Quando o PR sai do rascunho (`ready_for_review`), o run completo acontece.

Criar `.github/workflows/seguranca.yml` no projeto:

```yaml
name: Segurança
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
  # Opcional: varredura completa semanal e manual (só summary e anotações, sem status).
  schedule:
    - cron: '0 9 * * 1'
  workflow_dispatch:
concurrency:
  group: seguranca-${{ github.ref }}
  cancel-in-progress: true
permissions:
  contents: read
jobs:
  seguranca:
    permissions:
      contents: read
      statuses: write
      # pull-requests: write   # só com bloquear: true, para o comentário
    uses: nadairafael/ci/.github/workflows/seguranca.yml@v1
    # with:
    #   bloquear: true
    #   ferramentas: '["semgrep","gitleaks"]'
```

Para exigir a segurança num ruleset, use `bloquear: true` e exija o contexto **`seguranca`** (o commit status).

| Input | Padrão | O que faz |
|---|---|---|
| `ferramentas` | `'["osv","semgrep","gitleaks"]'` | Quais rodar. Um projeto sem lockfile pode tirar o `osv`. |
| `bloquear` | `false` | `false`: os achados só avisam. `true`: achado novo reprova (status `failure`, comentário e código de saída diferente de zero). |
| `escopo` | `''` | `''` decide pelo evento: `diff` num `pull_request`, `completo` nos outros (`schedule`, `workflow_dispatch`, `push`). `diff` ou `completo` força. |
| `semgrep-config` | `p/default` | Os rulesets do Semgrep (registry ou caminho no repo, ex. `.semgrep/`), separados por espaço. Num PR, um caminho do repo vale como está na base. |
| `ci-ref` | `v1` | A ref deste repo de onde vem o `dist/seguranca.mjs`. |
| `timeout` | `10` | Minutos do job. |

### Falsos positivos

Cada ferramenta usa o próprio mecanismo, no repo do projeto. Num PR, esses arquivos valem **a partir do branch base**: um PR não consegue silenciar os próprios achados, e um PR que mexe neles recebe um aviso de "olho humano" no summary.

| Ferramenta | Como suprimir |
|---|---|
| OSV-Scanner | `osv-scanner.toml` na raiz: `[[IgnoredVulns]]` com `id`, `reason` e `ignoreUntil` (ponha sempre uma data de validade). |
| Semgrep | `// nosemgrep: <regra>` na linha, ou `.semgrepignore` para caminhos (fixtures, gerados). |
| gitleaks | `.gitleaksignore` com o fingerprint do achado (está no summary), ou `gitleaks:allow` na linha; regras próprias em `.gitleaks.toml`. |

Os comentários na linha (`nosemgrep`, `gitleaks:allow`) fazem parte do diff e ficam à vista na revisão.

### Custo em minutos

Um job em `ubuntu-latest`, fora da fila do runner self-hosted. Estimativa por run de PR num repo pequeno a médio: **~1,5–3,5 min** (cobrado como 2–4 min, porque o GitHub arredonda por job), quase todo no Semgrep. Em repo público é grátis; em repo privado sai da cota do plano (2000 min/mês no Free). Para gastar menos: o `concurrency` com `cancel-in-progress` do exemplo, o Semgrep fora dos rascunhos, e tirar do `ferramentas` o que não se aplica.

As versões das ferramentas são fixas no `seguranca.yml` (os binários conferidos por SHA-256) e sobem por PR aqui.

## Desenvolvimento

```sh
npm ci
npm test            # vitest + @effect/vitest
npm run typecheck
npm run build       # gera dist/portao.mjs e dist/seguranca.mjs (commitados)
```

O `dist/` é commitado, e o CI falha se ele estiver desatualizado em relação a `src/`. Para lançar uma versão: `git tag v1.x.y`, depois mover a tag `v1` (`git tag -f v1 && git push -f origin v1`).
