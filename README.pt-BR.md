# Sabi

Agendamento adaptativo de inferência para agentes de IA.

O Sabi fica entre um harness de código e seus provedores de modelo. O harness mantém o loop de agente normal; o Sabi decide qual modelo, qual esforço de raciocínio e qual provedor atende cada rodada de inferência — continuamente, ao longo de toda a trajetória, não só no primeiro prompt.

[English](README.md) · **Português (BR)**

## Dois adaptadores, um núcleo

| | Classe A — mod em processo | Classe B — proxy local |
|---|---|---|
| Roda como | mod do Command Code (um hook no loop do harness) | endpoint compatível com OpenAI em `127.0.0.1:8787` |
| Pode escolher | modelo **e** esforço de raciocínio, do catálogo do Command Code | só o nome do modelo, dos seus próprios upstreams |
| Precisa de chave | não — roteia a assinatura que você já tem | sim — suas credenciais de upstream (OpenRouter, Ollama, …) |
| Sinal de falha | o `isError` do próprio harness (verdade de fato) | inferido do texto da saída da ferramenta |
| Use para | Command Code | qualquer harness que só aceite uma `baseURL` |

Os dois compartilham `packages/core`: estado da trajetória, política, juiz (Jev) e log de decisões. As decisões de roteamento abaixo são idênticas entre as classes — muda só o vocabulário de modelos (`harness.tiers` é um conjunto de ids do catálogo do Command Code; `models` é um conjunto de ids de upstream).

## Política

Cada rodada é classificada a partir do estado da trajetória — posição da rodada, chamadas de ferramenta e seus resultados, evidência de falha, tamanho do contexto — e roteada:

| Rodada | Regra | Nível (tier) |
|---|---|---|
| resultado de ferramenta com falha | `failure` | strong |
| nova instrução / primeira rodada | `first-turn` | mid |
| rodada de testes / build / lint | `verification` | mid |
| rodada de edição | `implementation` | mid |
| leitura / busca / burocracia | `exploration` | cheap |
| qualquer outra | `unclassified` | cheap |

O proxy registra cada rodada roteada em `.sabi/decisions.jsonl` (metadados, uso e custo estimado — nunca o conteúdo do prompt) e resume com `npm run report`. O mod registra uma decisão por rodada na própria sessão.

## Instalar — mod do Command Code (recomendado)

Requisitos: Node 22.6+, Command Code, acesso git a este repositório privado, e um plano que cubra os modelos em `harness.tiers` (veja [Cobertura de plano](#cobertura-de-plano)).

```bash
git clone https://github.com/vizuh/sabi && cd sabi
npm install                                                    # .npmrc força devDeps nesta máquina
cmd mods add ./packages/adapters/command-code                  # registra o mod (escopo de projeto)
cmd mods list                                                  # → sabi · project · from local:/…/packages/adapters/command-code
```

O mod carrega na sua próxima sessão nesse projeto (a primeira sessão também pede para confiar no workspace, o que mods de projeto exigem). A partir daí o Sabi planeja cada rodada seguinte; a rodada 1 sempre roda no modelo da sessão, porque `prepareNextTurn` só dispara da segunda rodada em diante.

Para verificar que está roteando, peça uma leitura de arquivo e observe o modelo mudar entre as rodadas:

```bash
cmd -p "Read package.json and reply with only the value of its name field." \
  --mod ./packages/adapters/command-code/mod/sabi.ts -t --output-format json
```

A rodada 1 roda no modelo da sessão; a rodada 2 (leitura → `exploration` → cheap) roda no nível cheap. Execuções headless `-p` não carregam mods de escopo de projeto — por isso a verificação passa `--mod` explicitamente.

## Instalar — proxy local (BYOK / outros harnesses)

```bash
npm install
export OPENROUTER_API_KEY=...    # credenciais do upstream
export TYPESAFE_API_KEY=...      # juiz Jev (opcional; use judge.enabled false para pular)
npm start                        # http://127.0.0.1:8787/v1

npm run connect:command-code     # grava/atualiza o provider "sabi" em ~/.commandcode/providers.json
cmd --list-models | grep sabi    # confirme que os quatro modelos aparecem
```

Depois escolha `sabi/sabi-code` em `/model` (ou `--model sabi/sabi-code`). Aliases fixos para comparação: `sabi-cheap`, `sabi-mid`, `sabi-strong`. `sabi-local` aponta para o Ollama e não é exposto por padrão — a janela de 32k é pequena demais para prompts de harness.

O Sabi é um processo em primeiro plano, não um serviço: se não estiver rodando, toda requisição `sabi/*` falha dentro do harness com `ECONNREFUSED 127.0.0.1:8787`. Nesta máquina as duas chaves vêm do arquivo de segredos do workspace:

```bash
export OPENROUTER_API_KEY="$(grep -E '^OPENROUTER_API_KEY=' ../../../secrets/.env | cut -d= -f2-)"
export TYPESAFE_API_KEY="$(grep -E '^typesafe=' ../../../secrets/.env | cut -d= -f2-)"
```

## Onde o Sabi encontra a configuração

`sabi.config.json` é procurado nesta ordem, o primeiro que existir vence:

1. `$SABI_CONFIG` — caminho explícito (quando definido, é o único lido)
2. `<cwd>/sabi.config.json` — local do projeto
3. `~/.config/sabi/sabi.config.json` — por usuário (respeita `XDG_CONFIG_HOME`)
4. o `sabi.config.json` mais próximo acima do pacote instalado — é assim que um clone acha a configuração que veio com ele

As decisões vão para `<cwd>/.sabi/decisions.jsonl`; sobrescreva com `$SABI_LOG`.

## Cobertura de plano

`cmd --list-models` imprime o **catálogo inteiro, independente do seu plano** — um modelo listado não é um modelo utilizável. Rotear para um que você não pode usar derruba a rodada:

```
Error: 403 MODEL_NOT_IN_PLAN: Claude Sonnet 5 available in Pro and above plans or extra on demand usage
```

Então todo id em `harness.tiers` precisa estar coberto pelo seu plano. Os padrões que acompanham o repositório são os ids mais fortes disponíveis **do plano Go para cima**, verificados ao vivo em 2026-09-18:

| Nível | Padrão (Go e acima) | Pro e acima | Max |
|---|---|---|---|
| cheap | `deepseek/deepseek-v4-flash` | mesmo | mesmo |
| mid | `gpt-5.6-luna` | `claude-sonnet-5` | `claude-sonnet-5` |
| strong | `zai-org/glm-5.3` | `claude-sonnet-5` | `claude-opus-5` |

Outras opções Go-e-acima para `strong`: `moonshotai/kimi-k3`, `qwen/qwen3.8-max`, `deepseek/deepseek-v4-pro`. Edite `harness.tiers` para casar com seu plano; `minPlan` é documentação, não imposição.

## Configurar

`sabi.config.json` contém:

- `upstreams` — URLs base e chaves (chaves como referências `$ENV_VAR`, ou `false` para endpoints sem chave, como o Ollama)
- `models` — os níveis da classe B: ids de modelo do upstream, janelas de contexto, preços
- `aliases` — o que o harness enxerga (`sabi-code` = `auto`, mais os baselines fixos)
- `policy` — regra → nível; `off` desabilita uma regra
- `judge` — endpoint, modelo, limites, TTL de cache, orçamento de estado
- `harness.tiers` — os níveis da classe A: ids do catálogo do Command Code, esforço, `minPlan`

Ids de modelo, janelas de contexto e preços foram verificados na API da OpenRouter em 2026-09-18; o preço do Jev ($0.042/Mtok de entrada, saída grátis) na documentação da TypeSafe no mesmo dia; os ids e esforços do catálogo do Command Code em `cmd --list-models` e na referência que acompanha o CLI. Tudo isso muda — reconfira antes de confiar na conta de custo.

## Julgamentos do Jev

Antes de uma rodada ser atendida, o Jev (modelo System One da TypeSafe) é consultado **só onde as heurísticas são cegas**:

- rodadas `failure` — "isto é um problema real ou um resultado esperado?" Uma probabilidade baixa de problema real veta a escalada (por exemplo: um comando que o usuário pediu explicitamente que falhasse).
- rodadas `unclassified` — "quão exigente é o próximo passo?" (`trivial` / `standard` / `demanding` → cheap / mid / strong) quando a confiança passa do limite.

Uma única requisição em lote para a TypeSafe cobre as duas perguntas, com estado limitado (≤6k caracteres: última instrução, último trecho de ferramenta, metadados da rodada — nunca a conversa inteira). Os julgamentos são cacheados, custam cerca de $0.00003 cada, e são **fail-open**: qualquer erro ou timeout volta à política determinística. Desligue com `judge.enabled: false`.

## Verificar

```bash
npm test        # estado, política, juiz, cliente TypeSafe, descoberta de config, e2e do proxy (59 testes)
npm run typecheck
npm run report  # decisões, tokens, custo, economia vs. contrafactual all-strong, estatísticas do juiz
```

## Estrutura

```
packages/core                    estado da trajetória, política, aplicação do juiz, roteador, descoberta de config, log de decisões
packages/server                  proxy compatível com OpenAI (passthrough + tap de SSE), cliente TypeSafe, /v1/models, report
packages/adapters/command-code   o mod em processo (mod/sabi.ts) + o escritor do provider BYOK (src/connect.ts)
```

`npm run mod` carrega o mod a partir de um checkout. O proxy adiciona `stream_options.include_usage` para upstreams que suportam, reescreve o campo `model` da resposta de volta para o alias sintético, captura o uso no stream SSE e nunca registra o conteúdo do prompt. As chamadas ao Jev acontecem antes do encaminhamento e ficam registradas na decisão (`judge.status`, probabilidades, direção do override, latência, custo em tokens).

Planejado: `evals`, adaptadores `prime-agent` e `opencode`, perfis de modelo aprendidos, consciência de cota.

## Trabalhos relacionados

[docs/research/github-landscape.md](docs/research/github-landscape.md) — levantamento verificado (2026-09-18) dos projetos mais próximos e da lacuna que o Sabi ataca.

## Nome

Nome do produto: **Sabi**. Os handles `sabi`, `uasabi` e `sabido` no GitHub já estavam tomados, então o repositório vive no namespace Vizuh: https://github.com/vizuh/sabi (privado). Sem relação com o Sabido, o outro produto de aprendizagem da Vizuh.

## Documentação

- [docs/install.pt-BR.md](docs/install.pt-BR.md) — instalação passo a passo na máquina de outra pessoa
- [docs/context.md](docs/context.md) — contexto, restrições, riscos (em inglês)
- [docs/decisions.md](docs/decisions.md) — decisões correntes (em inglês)
- [docs/handoff.md](docs/handoff.md) — estado atual e próximos passos (em inglês)
- [log.md](log.md) — histórico de mudanças (em inglês)
