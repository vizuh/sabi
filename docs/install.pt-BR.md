# Instalar o Sabi

Para colocar o Sabi numa máquina que não é esta. O Sabi é software privado: você precisa de acesso a
`https://github.com/vizuh/sabi` e de uma conta no Command Code para o caminho de classe A.

São dois caminhos, e são alternativas entre si, não etapas:

- **A — o mod** (recomendado se você usa Command Code): o Sabi roda dentro do harness, roteia o
  catálogo da assinatura e não precisa de proxy nem de chave de API.
- **B — o proxy**: o Sabi roda como um endpoint local compatível com OpenAI. Use para harnesses que só
  aceitam uma `baseURL`, ou para rotear seus próprios modelos via OpenRouter/Ollama.

Dá para instalar os dois; eles não interferem (mecanismos diferentes, namespaces de modelo diferentes).

## Requisitos

| | |
|---|---|
| Node | 22.6 ou mais novo (type stripping; desenvolvido no 24) |
| Harness | Command Code para o caminho A; qualquer coisa compatível com OpenAI para o caminho B |
| Acesso | leitura no repositório privado |
| Chaves | caminho A: nenhuma; caminho B: uma chave de upstream (ex.: OpenRouter) e opcionalmente uma chave TypeSafe para o Jev |
| Plano | só caminho A: todo id em `harness.tiers` precisa estar coberto — veja [Cobertura de plano](#cobertura-de-plano) |

## A — mod do Command Code

```bash
git clone https://github.com/vizuh/sabi && cd sabi
npm install
cmd mods add ./packages/adapters/command-code
```

`cmd mods add` registra o pacote como fonte de mod para o **projeto** (grava
`.commandcode/settings.json` ao lado do seu checkout, que está no gitignore). Ele não copia nada: o
pacote é referenciado no lugar, e é por isso que o clone precisa ficar onde está.

O que foi adicionado:

```json
{ "mods": { "sources": ["/caminho/para/sabi/packages/adapters/command-code"] } }
```

O pacote declara o que entrega no próprio `package.json`:

```json
{ "commandcode": { "mods": ["./mod/sabi.ts"] } }
```

### Confirmar que carregou

```bash
cmd mods list
```

Esperado — uma linha, sem avisos:

```
Mods (1)
  sabi · project · from local:/caminho/para/sabi/packages/adapters/command-code
```

Se aparecer `Mods (0)`: o projeto ainda não teve sessão, e fontes de escopo de projeto não são
listadas antes disso. Abra o `cmd` uma vez no checkout (ou confie no workspace) e liste de novo.

### Confirmar que está roteando

```bash
cmd -p "Read package.json and reply with only the value of its name field." \
  --mod ./packages/adapters/command-code/mod/sabi.ts -t --output-format json
```

No fluxo de eventos, a rodada 1 usa o modelo da sessão e a rodada 2 usa o nível que o Sabi planejou.
Uma rodada de leitura é `exploration` → cheap, então a rodada 2 mostra o id cheap de `harness.tiers`:

```
turn_start           1
model_request_start  <modelo da sua sessão>
tool_completed       read_file
turn_end             1
turn_start           2
model_request_start  deepseek/deepseek-v4-flash      ← planejado pelo Sabi
turn_end             2
```

Sobre execuções headless: uma execução `-p` **não** carrega mods de escopo de projeto (mods de projeto
passam por confiança, e o modo print nunca pergunta), e é por isso que a verificação acima passa
`--mod` explicitamente. Mods soltos em `~/.commandcode/mods` e fontes de escopo de usuário carregam
headless normalmente.

O mod também grava sua decisão por rodada na sessão, como entrada customizada, legível no transcript:

```json
{"turn":2,"planned":{"tier":"cheap","model":"deepseek/deepseek-v4-flash","rule":"exploration","roundKind":"exploration"},
 "servedBy":"deepseek/deepseek-v4-flash","usage":{"inputTokens":26613,"outputTokens":6}}
```

### Remover

```bash
cmd mods remove sabi          # ou: cmd mods remove ./packages/adapters/command-code
```

## B — proxy local

```bash
npm install
export OPENROUTER_API_KEY=...      # exigido pela config que acompanha o repositório
export TYPESAFE_API_KEY=...        # opcional: Jev. Sem ela, use judge.enabled false
npm start                          # http://127.0.0.1:8787/v1
```

### Confirmar que subiu

```bash
curl -s http://127.0.0.1:8787/healthz
# {"ok":true,"models":["sabi-code","sabi-cheap",...],"upstreams":["openrouter","ollama"],"log":".../decisions.jsonl"}

curl -s http://127.0.0.1:8787/v1/chat/completions -H 'content-type: application/json' \
  -d '{"model":"sabi-code","max_tokens":16,"messages":[{"role":"user","content":"say ok"}]}'
```

O campo `model` da resposta é reescrito de volta para o alias que você pediu, nunca o id real do upstream.

### Apontar o Command Code para ele

```bash
npm run connect:command-code     # grava/atualiza o provider "sabi" em ~/.commandcode/providers.json
cmd --list-models | grep sabi
```

Depois escolha `sabi/sabi-code` em `/model`, ou passe `--model sabi/sabi-code`. Os aliases fixos
(`sabi-cheap`, `sabi-mid`, `sabi-strong`) ignoram a política e existem como baselines de comparação.
`--include-local` também expõe `sabi-local` (Ollama); ele fica de fora por padrão porque uma janela de
32k é pequena demais para prompts de harness.

Leia o resultado com:

```bash
npm run report          # decisões, níveis, tokens, custo, economia vs. contrafactual all-strong, juiz
npm run report -- --json
```

### Parar

O Sabi é um processo em primeiro plano. `Ctrl-C`, ou `kill <pid>`. Não é um serviço e nada o reinicia:
se estiver fora do ar, toda requisição `sabi/*` falha dentro do harness com
`ECONNREFUSED 127.0.0.1:8787`.

## Configuração

`sabi.config.json` é procurado nesta ordem — o primeiro que existir vence:

1. `$SABI_CONFIG` (quando definido, é o único caminho lido)
2. `<cwd>/sabi.config.json`
3. `~/.config/sabi/sabi.config.json` (respeita `$XDG_CONFIG_HOME`)
4. o `sabi.config.json` mais próximo acima do pacote instalado

O caso 4 é o que faz um clone novo funcionar: rodando do checkout, a config que veio com ele é
encontrada. Para uma configuração pessoal que sobrevive a mover o clone, copie o arquivo para
`~/.config/sabi/`. Para trabalhar em um projeto só, coloque uma config nesse projeto.

As decisões vão para `<cwd>/.sabi/decisions.jsonl`; sobrescreva com `$SABI_LOG`.
O Sabi grava só metadados — nível, regra, id do modelo, contagem de tokens, custo, resultado do juiz.
Conteúdo de prompt nunca é gravado, nem no log nem na sessão, com uma exceção: uma chamada de upstream
que falha registra os primeiros 200 caracteres da resposta de erro do provedor (padrões de credencial
redigidos), então um provedor que ecoa conteúdo da requisição na linha de erro coloca essa linha no log.

## Cobertura de plano

`cmd --list-models` lista o **catálogo inteiro, não o seu plano**. Um modelo fora do seu plano continua
listado e falha na hora da requisição:

```
Error: 403 MODEL_NOT_IN_PLAN: Claude Sonnet 5 available in Pro and above plans or extra on demand usage
```

Como o mod troca de modelo no meio da sessão, um nível fora do plano derruba a rodada para a qual ele
roteia. Ajuste `harness.tiers` para ids que seu plano cobre. Padrões que acompanham o repositório,
verificados ao vivo em 2026-09-18:

| Nível | Go e acima (padrão) | Pro e acima | Max |
|---|---|---|---|
| cheap | `deepseek/deepseek-v4-flash` | mesmo | mesmo |
| mid | `gpt-5.6-luna` | `claude-sonnet-5` | `claude-sonnet-5` |
| strong | `zai-org/glm-5.3` | `claude-sonnet-5` | `claude-opus-5` |

Outras escolhas Go-e-acima para `strong`: `moonshotai/kimi-k3`, `qwen/qwen3.8-max`,
`deepseek/deepseek-v4-pro`. O `minPlan` na config é uma nota para humanos, não uma checagem em tempo
de execução — o Sabi não consegue ler o seu plano.

## Imagens e outros tipos de mídia

O Sabi se recusa a enviar mídia para um modelo que não consegue lê-la. Declare o que cada nível aceita e o roteador faz o resto:

```json
"mid": {
  "upstream": "openrouter",
  "model": "openai/gpt-5.6-luna",
  "capabilities": { "inputModalities": ["text", "image", "file"] }
}
```

- Uma rodada adaptativa (`sabi-code`) que carrega uma imagem é atendida pelo primeiro nível, na ordem de configuração, que declara `image` — a ordem dos níveis é a ordem de preferência, então liste cheap antes de strong. A decisão registra `rule: capability` com um motivo que nomeia os dois níveis.
- Um alias fixo (`sabi-cheap`) é recusado com `400 incompatible route 'cheap': input modality 'image' is not supported`, porque um alias de baseline é uma escolha explícita. Use `sabi-code` quando a sessão puder conter capturas de tela.
- Nada declarado significa desconhecido, e o Sabi encaminha como antes — declarar modalidades é o que liga a restrição. Verifique por id de modelo no upstream: na OpenRouter, `deepseek/deepseek-v4-flash-0731` é só texto enquanto `deepseek/deepseek-v4-flash-vision-exp` aceita imagens.
- O caminho do mod lê a mesma ideia de `harness.tiers[].inputModalities` e varre o transcript em busca de mídia. Ele não consegue corrigir um modelo que o host já escolheu: se nenhum nível consegue ler a imagem, a rodada fica no modelo da sessão em vez de ser roteada para um nível só-texto que teria a imagem removida em silêncio.
- A mídia é cobrada na estimativa de contexto — 1500 tokens por imagem, o limite do próprio host — então uma captura de tela não parece uma rodada pequena para a regra de pressão de contexto.

## Clientes além do Command Code

O proxy é um endpoint compatível com OpenAI, então qualquer cliente que aceite uma `baseURL` pode usá-lo. Esses clientes recebem **só a classe B**: o Sabi continua escolhendo o modelo a cada rodada, mas não o esforço de raciocínio, e infere uma rodada com falha a partir do texto da saída, não do sinal de erro do próprio harness. O juiz continua rodando (veja [Jev para esses clientes](#jev-para-esses-clientes)).

### OpenCode

Verificado ponta a ponta em 2026-09-18 com o OpenCode 1.18.30: uma sessão real de `opencode run --model sabi/sabi-code` alcançou um Sabi local, completou uma rodada de ferramenta e foi gravada com `client: opencode`.

```bash
npm start                       # proxy do Sabi em 127.0.0.1:8787
npm run connect:opencode        # grava o provider "sabi" em ~/.config/opencode/opencode.json
opencode run --model sabi/sabi-code "resuma este repositório"
```

O que o escritor faz — e o que deliberadamente não faz:

- Grava apenas `provider.sabi`. Providers existentes, credenciais e seu modelo padrão ficam intactos; `--set-default` coloca a sessão no alias adaptativo.
- Cria um backup (`<config>.sabi-backup`) e nunca o sobrescreve em uma nova execução.
- Recusa-se a tocar em uma config que não seja JSON válido, e não a modifica.
- Declara cada alias com a menor janela entre os níveis que ele pode atender. O OpenCode rejeita uma entrada de modelo que defina `limit.context` sem `limit.output`, então um nível sem declaração recebe um teto conservador de 4.096 tokens no cliente — declare `maxOutputTokens` no nível para torná-lo exato.
- Declara entrada só de texto. Adicione `image` em `modalities.input` apenas quando os níveis para os quais você roteia declararem `capabilities.inputModalities` com `image`; caso contrário, o Sabi vai recusar a rodada.
- Pula o nível `local` (Ollama) a menos que você passe `--include-local`.

Verifique com `npm run report` (ou `.sabi/decisions.jsonl`): as rodadas aparecem com `client: opencode`. Reverter: remova o provider `sabi` da config, ou restaure o backup.

### Hermes

O Hermes é atendido pelo mesmo proxy, mais um plugin opcional que adiciona atribuição estável. Isto segue `packages/adapters/hermes/README.md`: o plugin e uma sonda Hermes → Sabi → mock estão verificados em isolamento, mas **nenhum perfil real do Hermes rodou contra o Sabi ainda** — trate como template, não como caminho certificado.

1. Crie um `HERMES_HOME` novo. Não aponte para um perfil pessoal existente.
2. Copie `packages/adapters/hermes/plugin/` para `$HERMES_HOME/plugins/sabi-metadata/`.
3. Adapte `packages/adapters/hermes/config.yaml.example`: troque o placeholder de contexto por um limite verificado e mantenha `supports_tools`, `supports_vision` e `supports_reasoning` conservadores até verificar todos os níveis para os quais o Sabi pode rotear. O template traz `false`, o que significa sem ferramentas.
4. `HERMES_HOME=… hermes chat`, e selecione `sabi-code`.

### Jev para esses clientes

O juiz precisa de uma chave da TypeSafe: exporte `TYPESAFE_API_KEY`, ou ponha `judge.enabled: false`. Sem chave, o proxy avisa na subida e toda rodada julgada **falha aberta** — a rodada ainda completa pela política determinística, a decisão registra `judge.status: error` com `note: typesafe unavailable`, e os sinais de veto e de dificuldade se perdem. Verificado em 2026-09-18: HTTP 200, cerca de 0,6 s a mais por rodada julgada. O mod nunca chama o juiz; isto vale só para clientes do proxy.

## Problemas comuns

| Sintoma | Causa e solução |
|---|---|
| `ECONNREFUSED 127.0.0.1:8787` no harness | O caminho B está selecionado (modelo `sabi/*`) mas o proxy não está rodando. `npm start`, ou volte o modelo da sessão ao anterior. |
| `403 MODEL_NOT_IN_PLAN` | Algum nível em `harness.tiers` está acima do seu plano. Veja [Cobertura de plano](#cobertura-de-plano). |
| `No endpoints found that support image input` (404 do upstream) | Um modelo de upstream que não aceita imagens e nenhum `capabilities.inputModalities` declarado. Veja [Imagens e outros tipos de mídia](#imagens-e-outros-tipos-de-mídia). |
| `400 input modality 'image' is not supported` | Funcionando como pretendido: a rodada carrega mídia que o nível selecionado não aceita. Use o alias adaptativo, ou declare um nível que aceite. |
| `Sabi disabled: Sabi config not found at …` | Nenhuma config nos quatro locais. A mensagem lista todos os caminhos procurados; defina `SABI_CONFIG` ou crie uma. |
| `cmd mods list` mostra `Mods (0)` | Fontes de escopo de projeto só aparecem depois que o projeto teve sessão. Abra o `cmd` no checkout uma vez. |
| O mod carrega interativo mas não em `-p` | Esperado: `-p` não carrega mods de escopo de projeto. Passe `--mod ./packages/adapters/command-code/mod/sabi.ts`. |
| `WARN: missing upstream credentials` na subida | A config referencia uma variável de ambiente não definida. Exporte, ou ponha `apiKey: false` nesse upstream. |
| A rodada 1 ignora o Sabi | Por desenho: `prepareNextTurn` só dispara da segunda rodada, então a primeira roda no modelo da sessão. |
| Uma rodada com imagem parece maior que o texto dela | Esperado: a mídia é cobrada a 1500 tokens por imagem em `state.estimatedTokens`, e `state.mediaCounts` registra a contagem. |
| Um erro do provedor chega no meio do stream (`402`, tamanho de contexto) | Provedores podem reportá-lo dentro de um stream HTTP 200. A decisão registra a mensagem do próprio provedor, e o stream do cliente é reiniciado em vez de completado com saída parcial — nada é fabricado. |

## Segurança

- **O mod é código arbitrário** — roda em processo, sem sandbox, como qualquer mod do Command Code.
  Instale pacotes em que você confia; este é curto e legível (`mod/sabi.ts`, mais `packages/core`).
- **Nenhum segredo no git.** As chaves vêm do ambiente; a config guarda só referências `$ENV_VAR`.
  Não commite uma config com chave literal.
- **Nada sai da máquina além das próprias chamadas de modelo.** O caminho A não adiciona nenhum salto
  de rede próprio. O caminho B encaminha para os upstreams que você configurou, e o juiz Jev envia
  trechos da última instrução e do último resultado de ferramenta mais metadados da rodada — um alvo de
  6k caracteres, não uma garantia estrita de tamanho serializado para todos os campos.
- **O log de decisões é só metadado, com uma exceção.** Nada da conversa é gravado — sem conteúdo de
  prompt, sem conteúdo de arquivo, sem saída de ferramenta — mas uma chamada de upstream que falha
  registra os primeiros 200 caracteres da resposta de erro do provedor (padrões de credencial
  redigidos). Um provedor que ecoa conteúdo da requisição na linha de erro coloca essa linha no log.
- Em máquina compartilhada: `~/.config/sabi/sabi.config.json` é por usuário; prefira chaves no
  ambiente, não num arquivo legível por todos.

## Atualizar

```bash
cd /caminho/para/sabi && git pull && npm install
```

Nada mais a fazer no caminho A (o mod é referenciado no lugar). No caminho B, reinicie o proxy.
Se algum id de modelo ou preço mudou, reconfira no upstream antes de confiar no relatório de custo —
veja as notas de procedência em `sabi.config.json`.
