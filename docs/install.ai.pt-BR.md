# Fluxo de instalação pelo AI do host

Este é o fluxo canônico para quem pede ao Command Code, OpenCode, Hermes,
Claude Code ou Codex para instalar o Sabi. O AI do host deve executar as etapas,
responder no idioma do usuário e nunca adivinhar harness, conta ou plano de modelo.

[English](install.ai.md) · **Português (BR)**

Pedido sugerido ao AI:

> Instale o Sabi para este harness. Siga `docs/install.ai.pt-BR.md`, faça as
> perguntas necessárias em português, use o OpenRouter como única credencial do
> proxy, explique o que o Sabi faz se eu quiser e inicie o caminho compatível,
> mostrando as verificações.

## Perguntas, nesta ordem

1. Detecte o idioma da conversa e só pergunte quando houver ambiguidade.
2. Detecte o harness instalado e confirme: Command Code, OpenCode, Hermes,
   Claude Code ou Codex.
3. Pergunte qual rota o usuário quer:
   - rota nativa do host, quando o harness oferecer uma;
   - proxy do Sabi apoiado no OpenRouter, quando o usuário quiser que o Sabi
     escolha modelo/provedor a cada rodada de inferência compatível.
4. Peça uma única credencial somente quando a rota de proxy for escolhida:
   `OPENROUTER_API_KEY`. Nunca peça ao Sabi senha/chave da OpenAI, Anthropic,
   Nous, ChatGPT Plus ou OpenCode Go. Esses logins permanecem no host ou podem
   ser configurados como BYOK dentro do OpenRouter.
5. Pergunte se o usuário quer uma explicação curta. `--explain=local` é grátis e
   local; `--explain=ai` faz uma requisição explícita ao OpenRouter e pode consumir
   crédito.
6. Antes de alterar uma configuração do host, informe os arquivos e o comando
   exatos e peça confirmação. Preserve os providers existentes e use o backup do Sabi.

O AI não pode colar um segredo no chat, histórico do shell, JSON de configuração,
prompt ou log. Em um TTY, o wizard pede a chave do OpenRouter com entrada oculta e
a grava no arquivo de secrets do usuário com modo `0600`.

## Comando de instalação

Para Claude Code, Codex e os fluxos de OpenCode apoiados pelo controller, instale
primeiro o controller publicado:

~~~bash
npm install --global @vizuh/sabi-controller@0.1.0
sabi setup
sabi doctor
~~~

Para inferência de Hermes ou OpenCode pelo proxy local do Sabi, use um checkout do
Sabi, porque o pacote do controller contém hooks e daemon, não o servidor proxy nem
o perfil do Hermes:

~~~bash
git clone https://github.com/vizuh/sabi
cd sabi
npm install
~~~

O AI deve usar o comando correspondente ao harness confirmado:

| Harness | Primeira ação | Credencial que o Sabi pede |
|---|---|---|
| Command Code | `cmd mods add -g npm:@vizuh/sabi@0.1.3` | nenhuma para o mod nativo |
| OpenCode | `npm run setup -- --harness=opencode --no-jev` | somente OpenRouter |
| Hermes | `npm run setup -- --harness=hermes --upstream=openrouter --hermes-home="$HOME/.config/sabi/hermes" --no-jev` | somente OpenRouter |
| Claude Code | `sabi setup` | nenhuma para o hook do controller |
| Codex | `sabi setup` | nenhuma para o hook do controller |

Na instalação nativa do Command Code, o Sabi usa a assinatura do Command Code e o
mod local; não precisa do proxy nem de uma chave do OpenRouter. O proxy é uma
escolha separada de upstream pago e precisa ser explícita.

Para OpenCode ou Hermes, configure a chave antes de iniciar o proxy. O wizard pode
coletá-la de forma interativa; em uma execução sem TTY conduzida por um agente, use
o ambiente ou `SABI_SECRETS_FILE` pelo gerenciador de secrets do host, sem imprimir o
valor. Nunca coloque a chave literal em um comando mostrado ao usuário.

Depois, inicie o proxy local e o host:

~~~bash
npm start                                      # 127.0.0.1:8787
opencode run --model sabi/sabi-code "sua tarefa"
~~~

O Hermes usa seu loop nativo e o perfil `custom:sabi` gerado:

~~~bash
SABI_CONFIG="$HOME/.config/sabi/hermes/sabi.config.json" npm start
HERMES_HOME="$HOME/.config/sabi/hermes" hermes chat
~~~

A opção Hermes `--upstream=hermes-nous` continua disponível quando o usuário quiser
o proxy isolado do Nous. OpenCode Go e ChatGPT Plus continuam sendo providers nativos
selecionados pelo próprio Hermes com `hermes model`; o Sabi não transfere esses planos
para o proxy.

Claude Code e Codex recebem hooks do controller para roteamento de tarefa/sessão.
Isso é uma integração de host suportada, não uma troca de modelo dentro de uma rodada
nativa nem uma transferência de assinatura. Rode `sabi doctor` e reporte esse limite;
não diga que `sabi-code` está ativo dentro da rodada nativa deles.

## Recomendação de BYOK no OpenRouter

O Sabi precisa somente da chave do OpenRouter na máquina local. Adicione as chaves dos
providers nas configurações de BYOK do OpenRouter e escolha ali a prioridade ou o
fallback. As chaves BYOK priorizadas são tentadas antes da capacidade compartilhada;
as chaves de fallback são tentadas depois dela. A configuração do Sabi não precisa
conter essas credenciais:
[BYOK do OpenRouter](https://openrouter.ai/docs/guides/overview/auth/byok).

Comece com um limite de gasto na chave do OpenRouter e use o alias gerado `sabi-code`.
Mantenha `sabi-cheap`, `sabi-mid` e `sabi-strong` para baselines explícitos; os ids
de modelo e a elegibilidade da conta ainda precisam ser verificados.

## Verificações de conclusão

O AI do host deve reportar cada camada separadamente:

- arquivos alterados e backups criados;
- `sabi.config.json` validado;
- `curl -fsS http://127.0.0.1:8787/healthz` bem-sucedido no caminho do proxy;
- host iniciado com o alias/perfil Sabi pretendido;
- smoke test limitado concluído e presente em `.sabi/decisions.jsonl`;
- comportamento de login/assinatura nativa preservado.

Uma configuração gerada, um hook instalado ou um health check bem-sucedido sozinho
não prova que uma rodada de inferência paga terminou. Se alguma verificação não estiver
disponível, isso deve ser informado.
