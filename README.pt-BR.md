# Sabi

Agendamento adaptativo de inferência para agentes de IA.

O Sabi fica entre um harness de código e seus provedores de modelo. O harness mantém o loop de agente normal; o Sabi decide qual modelo, qual esforço de raciocínio e qual provedor atende cada rodada de inferência — continuamente, ao longo de toda a trajetória, não só no primeiro prompt.

[English](README.md) · **Português (BR)** · [中文](README.zh-CN.md)

## Instalar o Sabi uma vez

O Sabi é instalado uma vez por usuário/máquina. Você não precisa escolher um harness, instalar por worktree ou manter um checkout do repositório para usar o controller.

~~~bash
npm install --global @vizuh/sabi-controller
sabi setup
sabi status
~~~

O `setup` é idempotente: mantém o daemon e o estado no escopo do usuário, detecta hosts compatíveis, instala apenas hooks do Sabi que tenham suporte e deixa o harness seguir normalmente se o Sabi estiver indisponível. Use `sabi setup --no-hooks` se quiser inicializar o daemon sem alterar a configuração do host.

O pacote do controller é publicado separadamente por tags `controller-v*`. Se ainda não houver uma versão no npm, use temporariamente o [checkout de mantenedor](docs/install.pt-BR.md#checkout-do-mantenedor-somente-desenvolvimento); esse fluxo não é o modelo de instalação para usuários.

Depois da instalação, abra seu harness normalmente. As integrações de Command Code, proxy e controller são opcionais e entram apenas quando você precisa daquela capacidade.


## Escolher uma integração opcional

| Objetivo | Integração | O que o Sabi faz | Limite atual |
|---|---|---|---|
| Roteamento por rodada de modelo + esforço de raciocínio | [Mod do Command Code](docs/adapters/command-code.md) | Usa o loop nativo e o catálogo da assinatura do host | Somente Command Code |
| Roteamento de modelo/provedor com suas próprias credenciais | [Proxy local](docs/install.pt-BR.md#integração-opcional--proxy-local-compatível-com-openai) | Encaminha requisições por um endpoint compatível com OpenAI | Modelo/provedor; não troca nativamente o esforço de raciocínio |
| Mover trabalho entre sessões e worktrees | [Hooks do controller](docs/adapters/README.md) | Coordena ações limitadas de continuar/delegar/criar | Não troca o modelo dentro de uma sessão nativa existente |
| Adicionar outro host | [Contrato de mantenedor](docs/maintainers.md) | Define a fronteira e as evidências necessárias para o adaptador | Adaptador não cria uma segunda política de roteamento |

Essas integrações compartilham o core do Sabi, mas não são etapas da instalação. Instale o Sabi uma vez; escolha uma integração somente quando precisar daquela capacidade.

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

O proxy registra as rodadas roteadas em `.sabi/decisions.jsonl` e as resume com `npm run report`. O mod registra as decisões como entradas da própria sessão do host, que esse relatório não lê. **Privacidade:** por padrão, a telemetria guarda evidências de uma lista permitida e identidades opacas com hash; trechos de diagnóstico são opt-in. Mantenha os logs locais e revise as configurações de `telemetry` antes de habilitar a captura.

**Contexto medido e compactação do host.** Quando o cliente identifica sua sessão (`x-sabi-session`), o proxy pisa a estimativa de contexto no total cobrado pelo provedor na rodada anterior — uso medido, não contagem de caracteres — e trata um transcript que volta com menos da metade das mensagens anteriores como uma compactação do host. Uma fronteira avança uma geração de contexto, o que impede que veredictos do Jev em cache atravessem a reescrita, e reinicia a sequência de falhas: uma falha após a reescrita é uma falha nova, não a continuação da tentativa que o host descartou. O host continua dono da compactação — o Sabi não reescreve transcript em nenhum dos adaptadores. No caminho do mod, os mesmos dois sinais vêm do `usage` do host e do encolhimento de `state.messages`.

**Limites de provedor e de assinatura.** Um rate limit, limite de sessão/uso/cota ou timeout é uma condição de transporte, não uma falha da tarefa: a rodada repete no nível de transporte e nunca é escalada para um modelo mais forte. A redação decide: um limite nomeado (`rate limit`, `session limit`, `too many requests`) vence uma linha com cara de erro no mesmo resultado, enquanto um código de status sozinho não vence — um teste que falha imprimindo 429 continua escalando.

## Mídia e visão

Mídia é uma restrição de roteamento, não uma preferência decidida depois do fato. Cada nível pode declarar as modalidades de entrada que seu modelo aceita (`capabilities.inputModalities` no proxy, `inputModalities` em `harness.tiers`). Uma rodada que carrega uma imagem nunca é enviada a um nível que declara só texto — ela é atendida pelo primeiro nível, na ordem de configuração, que declara a modalidade, e a decisão registra `rule: capability`. O que não é declarado continua desconhecido: um nível que não declara nada nunca é bloqueado.

| Nível | Proxy (`models`) | Mod (`harness.tiers`) |
|---|---|---|
| cheap | `deepseek/deepseek-v4-flash-0731` — só texto | `deepseek/deepseek-v4-flash` — só texto |
| mid | `openai/gpt-5.6-luna` — texto, imagem, arquivo | `gpt-5.6-luna` — texto, imagem |
| strong | `anthropic/claude-sonnet-5` — texto, imagem, arquivo | `zai-org/glm-5.3` — só texto |

O que acontece quando nada consegue atender a rodada:

- **Alias adaptativo (`sabi-code`)** — a rodada vai para um nível que consegue lê-la. Verificado ao vivo: uma rodada de exploração carregando uma imagem, planejada para o nível cheap (só texto), foi atendida por `openai/gpt-5.6-luna` (`rule: capability`), em vez de falhar no upstream com `404 No endpoints found that support image input`.
- **Alias fixo (`sabi-cheap`)** — recusada, com `400 incompatible route 'cheap': input modality 'image' is not supported`. Um alias de baseline é uma escolha explícita de modelo e não sobe de nível em silêncio.
- **Nenhum nível** — recusada no proxy; no caminho do mod, a rodada fica no modelo da sessão, porque o host remove imagens para um modelo só-texto e rotear para lá responderia às cegas.

A mídia também é cobrada na estimativa de contexto: cada imagem custa 1500 tokens (o limite do próprio host, não o tamanho em base64, que não diz nada sobre tokens de imagem) e as outras mídias são cobradas pelo tamanho do payload, então uma rodada com captura de tela não parece mais minúscula para a regra de pressão de contexto. `contextChars` continua só texto; `state.inputModalities` e `state.mediaCounts` são gravados em cada decisão.

As modalidades declaradas precisam ser verificadas por id de modelo, não inferidas pela família: na OpenRouter, `deepseek/deepseek-v4-flash-0731` é só texto enquanto `deepseek/deepseek-v4-flash-vision-exp` aceita imagens; no catálogo do Command Code, `gpt-5.6-luna` aceita imagens enquanto `zai-org/GLM-5.3` não.

## Integração opcional — mod nativo do Command Code

Requisitos: Node 22.6+, Command Code, git (este repositório é público), e um plano que cubra os modelos em `harness.tiers` (veja [Cobertura de plano](#cobertura-de-plano)).

```bash
git clone https://github.com/vizuh/sabi && cd sabi
npm install                                                    # .npmrc força devDeps nesta máquina
cmd mods add ./packages/adapters/command-code                  # registra o mod (escopo de projeto)
cmd mods list                                                  # → sabi · project · from local:/…/packages/adapters/command-code
```

Ou instale o mesmo mod sem clonar — ele é publicado como um pacote npm empacotado, sem dependências de runtime (só o mod; o caminho do proxy abaixo ainda precisa do clone):

```bash
cmd mods add -g npm:@vizuh/sabi                                # escopo de usuário; atualize depois com `cmd mods update`
```

O mod carrega na sua próxima sessão nesse projeto (a primeira sessão também pede para confiar no workspace, o que mods de projeto exigem). A partir daí o Sabi planeja cada rodada seguinte; a rodada 1 sempre roda no modelo da sessão, porque `prepareNextTurn` só dispara da segunda rodada em diante.

Para verificar que está roteando, peça uma leitura de arquivo e observe o modelo mudar entre as rodadas:

```bash
cmd -p "Read package.json and reply with only the value of its name field." \
  --mod ./packages/adapters/command-code/mod/sabi.ts -t --output-format json
```

A rodada 1 roda no modelo da sessão; a rodada 2 (leitura → `exploration` → cheap) roda no nível cheap. Execuções headless `-p` não carregam mods de escopo de projeto — por isso a verificação passa `--mod` explicitamente.

## Integração opcional — proxy local (BYOK / outros harnesses)

```bash
npm install
npm start                        # http://127.0.0.1:8787/v1

npm run connect:command-code     # grava/atualiza o provider "sabi" em ~/.commandcode/providers.json
cmd --list-models | grep sabi    # confirme que os quatro modelos aparecem

npm run connect:opencode         # OpenCode: grava o provider "sabi" em ~/.config/opencode/opencode.json
```

Depois escolha `sabi/sabi-code` em `/model` (ou `--model sabi/sabi-code`). Aliases fixos para comparação: `sabi-cheap`, `sabi-mid`, `sabi-strong`. `sabi-local` aponta para o Ollama e não é exposto por padrão — a janela de 32k é pequena demais para prompts de harness. Outros clientes — OpenCode e Hermes, com o que eles ganham e não ganham — estão em [docs/install.pt-BR.md](docs/install.pt-BR.md#clientes-além-do-command-code).

O Sabi é um processo em primeiro plano, não um serviço: se não estiver rodando, toda requisição `sabi/*` falha dentro do harness com `ECONNREFUSED 127.0.0.1:8787`.

## Daemon do Agent Controller (experimental)

O controller foi desenhado para rodar uma vez por usuário, em vez de uma vez por worktree. O pacote
público do controller é separado do adaptador de inferência:

```bash
npm install --global @vizuh/sabi-controller
sabi setup --hooks               # grava o estado, inicia o daemon e instala os hooks
sabi status
sabi route "revise esta mudança"
sabi integrations list
sabi upgrade --version=0.1.0    # rollback por versão exata também é suportado
sabi uninstall                   # restaura backups dos hooks e arquiva o estado do Sabi
sabi replay --last=1000         # resumo somente leitura das decisões/resultados
```

A primeira release de `@vizuh/sabi-controller` é preparada pelo workflow `controller-v*`. Até uma
tag do controller ser publicada, `npm run build:controller` neste repositório é apenas uma
verificação de mantenedor/CI, não um fluxo de instalação para usuários. O resultado é um tarball
autocontido com CLI, daemon, hooks, plugin OpenCode e recursos da ponte Orca; ele não depende deste
checkout nem do `node_modules` em runtime.

`setup` detecta os harnesses instalados e habilita o roteamento automático pelo daemon. Com
`--hooks`, ele mescla um hook `UserPromptSubmit` do Sabi no Claude Code e no Codex, e instala o
pequeno plugin `chat.message` do OpenCode. A configuração JSON existente é preservada e recebe um
backup único em `<arquivo>.sabi-backup`. Um plano `CONTINUE` é silencioso; uma delegação só bloqueia
o prompt atual depois que o daemon informa que o alvo aceitou a execução. Falhas do hook deixam o
harness seguir normalmente se o Sabi estiver parado. Esses hooks roteiam a execução do controller;
eles não trocam silenciosamente a assinatura paga nem o modelo selecionado dentro do harness.

Para instalar ou reparar os hooks separadamente, rode `sabi hooks install` (ou selecione `--claude`,
`--codex` ou `--opencode`). No Linux, `sabi setup` também tenta instalar um serviço `systemd --user`
e reporta um fallback lazy detached quando o bus do usuário não está disponível. Instaladores de
serviço para macOS e Windows continuam sem suporte até serem validados. Use `sabi integrations list`
para distinguir um executável de um harness realmente integrado ao controller. O daemon fica apenas
em loopback e reutiliza o inventário real do Orca quando disponível; a ativação universal live do
OpenCode/Orca continua sendo um gate separado.

Os registros do controller usam o schema de trace v1: candidatos bounded, conjunto fechado de ações
válidas, rota escolhida, status da execução e duração. Requests brutos, handoffs, diffs e handles de
terminal não são persistidos por padrão; o handoff live é enviado somente ao alvo selecionado.
`sabi replay` lê o JSONL sem chamar nenhum harness, permitindo avaliar mudanças de política sobre
tráfego observado antes de executar.

O controller tem seu próprio pacote `@vizuh/sabi-controller` e sua própria linha de release. A
release pública `@vizuh/sabi` no GitHub/npm publica apenas o adaptador do Command Code. Uma release
do controller ainda precisa passar pelo teste em máquina limpa e pelos gates de integração do host
em `docs/research/public-installation-plan.md`; instalar o pacote não prova ativação live no Orca
nem execução entre terminais.

Na subida, o proxy carrega somente os nomes de credencial referenciados pela configuração ativa.
Variáveis já presentes no ambiente vencem; depois vêm `SABI_SECRETS_FILE`, o `secrets/.env` mais
próximo no workspace e, por fim, `~/.config/sabi/secrets.env` ou `~/.config/sabi/.env`. O arquivo
dotenv pode usar `OPENROUTER_API_KEY=...` e `TYPESAFE_API_KEY=...`; o nome `typesafe=...` que já
existe no workspace HugoOS também é aceito para a chave TypeSafe. O Sabi não copia os valores carregados para configurações geradas do harness nem para os logs.
Se você usa um secrets/.env no workspace, esse arquivo já está no worktree: mantenha-o fora do
controle de versão, adicione-o ao .gitignore e proteja suas permissões. O mod do Command Code continua sem chave;
OpenCode, Hermes, Kilo e outros clientes compatíveis com OpenAI apenas apontam para o proxy local,
enquanto as credenciais próprias da conta continuam no harness.

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

**Problema conhecido (2026-09-18).** Uma rodada que o mod planeja para o nível `strong` padrão (`zai-org/glm-5.3`) falha com `403 Model/provider not recognized`. O id funciona como modelo *de sessão* nas duas grafias (`GLM-5.3`), mas não quando é o mod que o fornece; nenhum id verificado para `strong` foi encontrado ainda. Repro e evidência em `docs/handoff.md`.

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

**Só o proxy** consulta o Jev (modelo System One da TypeSafe) nas regras configuradas. O mod do Command Code não chama o Jev hoje:

- rodadas `failure` — "isto é um problema real ou um resultado esperado?" Uma probabilidade baixa de problema real veta a escalada (por exemplo: um comando que o usuário pediu explicitamente que falhasse).
- rodadas `unclassified` — "quão exigente é o próximo passo?" (`trivial` / `standard` / `demanding` → cheap / mid / strong) quando a confiança passa do limite.

Uma única requisição em lote para a TypeSafe cobre as três perguntas usando trechos da última instrução e do último resultado de ferramenta mais metadados da rodada, não a conversa inteira. A terceira pergunta é **apenas em modo sombra**: ela pontua se o último resultado de ferramenta é redundante para o próximo passo, e a resposta é registrada na decisão (`judge.evidenceRedundant`) e contada pelo `npm run report` — nada é descartado ou reescrito, nenhuma rota muda, e ela continua não verificada até ser medida em tráfego real. O alvo atual de 6k caracteres do estado não é uma garantia estrita de tamanho serializado para todos os campos. Os julgamentos são cacheados, custam cerca de $0.00003 cada, e são **fail-open**: qualquer erro ou timeout volta à política determinística. Desligue com `judge.enabled: false`.

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
packages/adapters/opencode       escritor de config do OpenCode (npm run connect:opencode)
packages/adapters/hermes         ponte de metadados opt-in e sonda de compatibilidade isolada
packages/adapters/prime-agent   sonda privada e isolada de proxy/timing; sem adaptador nativo
```

`npm run mod` carrega o mod a partir de um checkout. O proxy usa uma verificação única de envelope efetivo antes de adicionar `stream_options.include_usage` para upstreams elegíveis, reescreve o campo `model` da resposta de volta para o alias sintético, captura o uso no stream SSE e grava registros de decisão com os limites de privacidade descritos acima. As chamadas ao Jev acontecem antes do encaminhamento e ficam registradas na decisão (`judge.status`, probabilidades, direção do override, latência, custo em tokens).

Planejado: `evals`, adaptadores `prime-agent` e `opencode`, perfis de modelo aprendidos, consciência de cota.

## Trabalhos relacionados

[docs/research/github-landscape.md](docs/research/github-landscape.md) — levantamento verificado (2026-09-18) dos projetos mais próximos e da lacuna que o Sabi ataca.

## Nome

Nome do produto: **Sabi**. Os handles `sabi` e `uasabi` no GitHub já estavam tomados, então o repositório vive no namespace Vizuh: https://github.com/vizuh/sabi (público).

## Documentação

- [Command Code roadmap](docs/research/command-code-roadmap.md) — roteamento de contexto/ferramentas proposto e critérios de aceite (em inglês)
- [Folder review](docs/research/folder-review.md) — achados no código e comentários prontos para issue (em inglês)
- [Prime Agent reuse](docs/research/prime-agent-reuse.md) — evidência do runtime instalado e padrões que valem reaproveitar (em inglês)
- [docs/install.pt-BR.md](docs/install.pt-BR.md) — instalação passo a passo na máquina de outra pessoa
- [docs/context.md](docs/context.md) — contexto, restrições, riscos (em inglês)
- [docs/decisions.md](docs/decisions.md) — decisões correntes (em inglês)
- [docs/handoff.md](docs/handoff.md) — estado atual e próximos passos (em inglês)
- [log.md](log.md) — histórico de mudanças (em inglês)
