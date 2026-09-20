# Instalar o Sabi

Para colocar o Sabi numa máquina que não é esta. O repositório `https://github.com/vizuh/sabi` é público;
você precisa de uma conta no Command Code para o caminho de classe A.

**Setup rápido**: `npm run setup` guia você na escolha do harness e, opcionalmente, do Jev — veja
[Setup rápido](#setup-rápido) abaixo. As seções depois dela são os passos manuais detalhados que
ela executa por você; leia-as se quiser automatizar uma peça isolada.

São dois caminhos, e são alternativas entre si, não etapas:

- **A — o mod** (recomendado se você usa Command Code): o Sabi roda dentro do harness, roteia o
  catálogo da assinatura e não precisa de proxy nem de chave de API.
- **B — o proxy**: o Sabi roda como um endpoint local compatível com OpenAI. Use para harnesses que só
  aceitam uma `baseURL`, ou para rotear seus próprios modelos via OpenRouter/Ollama.

Dá para instalar os dois; eles não interferem (mecanismos diferentes, namespaces de modelo diferentes).

## Setup rápido

```bash
git clone https://github.com/vizuh/sabi && cd sabi && npm install
npm run setup
```

Pergunta qual harness (Command Code / OpenCode / Hermes) e, separadamente, se quer ativar o Jev.
Para Command Code e OpenCode, roda o mesmo escritor certificado que a seção detalhada de cada
harness abaixo documenta. Para Hermes, automatiza as partes mecânicas da receita manual abaixo
(criar `HERMES_HOME`, copiar o plugin, escrever `config.yaml`) — esse caminho continua
**não certificado**, exatamente como a seção do Hermes diz; ele imprime o candidato de janela de
contexto para você verificar, não o afirma como verdade. Flags pulam qualquer pergunta:
`npm run setup -- --harness=command-code --class=a`, `--harness=opencode --no-jev`,
`--harness=hermes --hermes-home=<caminho>`. Sem flag de harness e sem TTY para perguntar, não
escreve nada e imprime o uso — não existe harness padrão seguro, cada escolha grava um arquivo
diferente. `--jev` só liga `judge.enabled`/`judge.baseURL` em `sabi.config.json`; nunca lê,
imprime ou grava sua `TYPESAFE_API_KEY` — exporte-a você mesmo, como sempre.
Kilo e Prime Agent não são automatizados — `--harness=kilo`/`prime-agent` só aponta para
[as receitas manuais](harnesses.md).

## Requisitos

| | |
|---|---|
| Node | 22.6 ou mais novo (type stripping; desenvolvido no 24) |
| Harness | Command Code para o caminho A; qualquer coisa compatível com OpenAI para o caminho B |
| Acesso | nenhum — o repositório é público |
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

Se você preferir não manter um checkout, o mesmo mod é publicado no npm como um único arquivo empacotado, sem dependências de runtime, com um `sabi.config.json` padrão próprio:

```bash
cmd mods add -g npm:@vizuh/sabi     # escopo de usuário — carrega em todo projeto
```

Um `sabi.config.json` no projeto (ou `~/.config/sabi/sabi.config.json`) tem precedência sobre o padrão que vem no pacote. As atualizações vêm de `cmd mods update`. O caminho B abaixo continua precisando do clone.

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
npm start                          # http://127.0.0.1:8787/v1
```

### As credenciais não dependem do harness

O proxy carrega somente os nomes de ambiente referenciados pelo `sabi.config.json` ativo. Variáveis
já presentes no ambiente vencem; depois vêm `SABI_SECRETS_FILE`, o `secrets/.env` mais próximo no
workspace e `~/.config/sabi/secrets.env` ou `~/.config/sabi/.env`. Use atribuições dotenv normais,
como `OPENROUTER_API_KEY=...` e `TYPESAFE_API_KEY=...`; o alias `typesafe=...` do arquivo atual do
HugoOS também é aceito. O Sabi não copia esses valores para configurações geradas do OpenCode, Hermes, Kilo, Command Code
ou Orca, nem para os logs. Se a origem for um secrets/.env no workspace, esse arquivo já está no
worktree: mantenha-o fora do controle de versão, adicione-o ao .gitignore e proteja suas permissões.
O caminho do mod do Command Code continua sem chave. Os outros harnesses
precisam apenas da URL do proxy local; as assinaturas e credenciais próprias continuam neles.

Se os segredos estiverem em outro lugar, inicie com `SABI_SECRETS_FILE=/caminho/absoluto/.env npm start`.
Usuários sem arquivo central podem continuar exportando as variáveis do provider normalmente, e quem
não usa Jev pode definir `judge.enabled` como `false`.

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

Isso pergunta antes de registrar qualquer coisa paga: **rotear modelos pagos (créditos reais de
API) através do Command Code?** Em um terminal real pergunta uma vez; com Enter em branco ou numa
execução não interativa (CI, agente) o padrão é **não**, e nada pago é registrado — passe `--paid`
para pular a pergunta e registrar os níveis pagos sem interação, ou `--free` para pular e não
registrar nenhum. Isso é uma mudança de comportamento em relação a versões anteriores, que
registravam todos os níveis pagos sem perguntar.

Na config que vem no repositório, `sabi-code`, `sabi-cheap`, `sabi-mid` e `sabi-strong` resolvem só
para o upstream pago `openrouter` — nenhum deles é registrado a menos que você tenha respondido sim
ou passado `--paid`.
Depois escolha `sabi/sabi-code` em `/model`, ou passe `--model sabi/sabi-code`. Os aliases fixos
(`sabi-cheap`, `sabi-mid`, `sabi-strong`) ignoram a política e existem como baselines de comparação.
`--include-local` também expõe `sabi-local` (Ollama); ele fica de fora por padrão porque uma janela de
32k é pequena demais para prompts de harness.

Para desativar de forma permanente um upstream específico, independente de `--paid`, defina
`"enabled": false` nele em `sabi.config.json` — veja Configuração abaixo. Esse interruptor é
aplicado de novo no momento da requisição, então mesmo um registro antigo ou a config de outro
harness apontando para o proxy em execução é recusado.

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

Cada entrada em `upstreams` aceita `"enabled": false` como um interruptor permanente — omitido ou
`true` significa utilizável. Um upstream desativado continua válido no schema, mas o
`connect:command-code` não registra nenhum alias que dependa dele, e o proxy recusa despachar para
ele mesmo que algo mais ainda aponte para lá.

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

#### Hook do Controller

O Agent Controller separado pode instalar um pequeno plugin `chat.message` do OpenCode junto com os
hooks do Claude e do Codex:

```bash
npm install --global @vizuh/sabi-controller
sabi setup --hooks
# ou: sabi hooks install --opencode
```

Este é o fluxo pretendido para usuários. A release pública `@vizuh/sabi` contém apenas o adaptador do
Command Code; ela não instala o controller nem a ponte Orca. Antes da primeira tag de
`@vizuh/sabi-controller`, o pacote ainda não está disponível de propósito; não substitua esse fluxo
por `npm link` numa instalação de usuário. Mantenedores podem executar `npm run build:controller` e
o teste de pacote em prefixo limpo a partir do repositório.

O plugin consulta o daemon loopback, despacha apenas `DELEGATE`, `SPAWN` e `ORCHESTRATE`, e substitui
a mensagem atual somente depois que o daemon informa execução aceita. `CONTINUE` permanece no
OpenCode. Falhas de transporte ou do daemon deixam o harness seguir normalmente. Isto é roteamento
do controller, não troca de assinatura/modelo; a ativação live do plugin OpenCode na instância Orca
do usuário ainda precisa de uma verificação própria.

Os traces do controller usam o schema v1 e mantêm candidatos bounded, ações válidas, status e duração
da execução. Veja o agregado somente leitura com:

```bash
sabi replay --last=1000
```

Isto resume o tráfego registrado; não chama harness nem repete uma tarefa paga.

### Hermes

O Hermes é atendido pelo mesmo proxy, mais um plugin opcional que adiciona atribuição estável. Isto segue `packages/adapters/hermes/README.md`: o caminho principal e de resume do Hermes está certificado pela sonda nativa Hermes → Sabi → mock com runtime fixado. Chamadas auxiliares, rebinding direto de provider e qualidade com provider real continuam gates separados; isto não é certificação de provider pago.

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
  de rede próprio. O caminho B encaminha para os upstreams que você configurou — assim que você
  fornecer uma chave, cada rodada roteada gasta crédito real — e o juiz Jev envia trechos da última
  instrução e do último resultado de ferramenta mais metadados da rodada — um alvo de 6k caracteres,
  não uma garantia estrita de tamanho serializado para todos os campos.
- **Upstreams pagos exigem consentimento no momento de conectar.** `npm run connect:command-code`
  por padrão não registra nada pago, a menos que você passe `--paid` ou responda sim na pergunta;
  `enabled: false` num upstream o desativa em todo lugar, inclusive no momento da requisição,
  independente desse consentimento. Essa pergunta só decide se o Command Code é conectado com
  os níveis pagos — o momento em que o gasto real se torna possível é exportar a chave desse
  upstream e rodar `npm start`, como sempre foi. `enabled: false` é o interruptor permanente para
  "nunca rotear aqui, ponto"; qualquer coisa que acesse o proxy diretamente ainda precisa de uma
  chave que você mesmo forneceu.
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

Nada mais a fazer no caminho A (o mod é referenciado no lugar). Para a instalação via npm (`cmd mods add -g npm:@vizuh/sabi`), atualize com `cmd mods update`, que reinstala a versão publicada mais nova. No caminho B, reinicie o proxy.
Se algum id de modelo ou preço mudou, reconfira no upstream antes de confiar no relatório de custo —
veja as notas de procedência em `sabi.config.json`.
