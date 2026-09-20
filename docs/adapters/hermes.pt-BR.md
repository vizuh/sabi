# Adaptador Hermes

O Sabi integra-se ao Hermes pelo seam suportado de middleware `llm_request` e por um provider
customizado explícito de Chat Completions.

O caminho V1 suportado é:

~~~text
Hermes → custom:sabi / sabi-code → proxy Sabi → upstream configurado
~~~

O Hermes mantém seu loop nativo. O middleware adiciona headers de atribuição e preserva a
requisição completa, incluindo ferramentas, ids, ordem, argumentos e objetos do SDK. Ele não cria
um segundo loop de retry nem uma segunda implementação de política.

## Status atual

- Fixado/testado contra Hermes 0.21.3 no commit `01382698fc32ec7740b6a204d9b7a6abeac74d33`.
- Sondas nativa com mock e pelo proxy Sabi cobrem um loop limitado de ferramenta e retomada.
- Requisições extras de descoberta de modelos, caminhos auxiliares, subagentes e smokes com
  providers pagos continuam sendo gates separados.
- Middleware fail-open não é uma fronteira de orçamento nem de permissão.

## Iniciar

Para um perfil Hermes de usuário, use o wizard de setup. No Orca, abra três abas de terminal neste
checkout e execute cada bloco na aba indicada:

~~~bash
npm run setup -- --harness=hermes --hermes-home="$HOME/.config/sabi/hermes" --no-jev
export HERMES_HOME="$HOME/.config/sabi/hermes"
hermes auth add nous --type oauth

# Terminal 1
HERMES_HOME="$HERMES_HOME" hermes proxy start --provider nous --host 127.0.0.1 --port 8645

# Terminal 2
SABI_CONFIG="$HERMES_HOME/sabi.config.json" npm start

# Terminal 3
export SABI_HERMES_BASE_URL="http://127.0.0.1:8787/v1"
HERMES_HOME="$HERMES_HOME" SABI_HERMES_BASE_URL="$SABI_HERMES_BASE_URL" hermes chat
~~~

Para um setup de uma única chave com OpenRouter, troque o primeiro comando por:

~~~bash
npm run setup -- --harness=hermes --upstream=openrouter \
  --hermes-home="$HOME/.config/sabi/hermes" --no-jev
~~~

O perfil OpenRouter não inicia `hermes proxy` nem pede login do Nous. Ele usa somente
`OPENROUTER_API_KEY`; BYOK, prioridade e fallback dos providers continuam configurados no
OpenRouter. Use `--explain=local` para uma explicação localizada e gratuita, ou `--explain=ai` para
uma requisição explícita ao OpenRouter.

Nesse modo, pule as linhas de login e proxy do Nous e use dois terminais:

~~~bash
SABI_CONFIG="$HOME/.config/sabi/hermes/sabi.config.json" npm start
HERMES_HOME="$HOME/.config/sabi/hermes" hermes chat
~~~

O wizard cria um `HERMES_HOME` isolado, copia o plugin e grava um perfil Sabi apoiado no Nous ou no
OpenRouter conforme `--upstream`. Leia também o [guia geral de instalação Hermes](../install.pt-BR.md#clientes-além-do-command-code)
antes de alterar o perfil. O diretório de destino precisa ser novo ou vazio; preserve o perfil
`.hermes`/Hermes pessoal existente.

A base loopback exata precisa estar em `SABI_HERMES_BASE_URL`; o plugin permite falha aberta para
outro host ou endpoint não reconhecido. Neste host, `qwen2.5-coder:7b` tem contexto de 32768 tokens,
enquanto Hermes 0.21.3 exige pelo menos 64000 para um modelo customizado. Use Nous ou um modelo
local com contexto verificado de pelo menos 64000 no caminho Hermes; Qwen continua disponível pelo
caminho direto Sabi/Ollama.

OpenCode Go e ChatGPT Plus continuam sendo providers nativos do Hermes. Selecione-os pelo fluxo
`hermes model`; as assinaturas não são transferidas silenciosamente para o Sabi.

## Nota para mantenedores

O adaptador deve retornar a requisição completa e substituir somente os headers de atribuição do
Sabi. Não adicione rebinding de provider, execução de ferramentas, retry ou um segundo loop ao
middleware.

[English](hermes.md) · **Português (BR)**
