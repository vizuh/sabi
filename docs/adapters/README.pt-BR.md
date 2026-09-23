# Adaptadores do Sabi

Os adaptadores são pontes opcionais, não pré-requisitos de instalação. Instale o Sabi uma vez no
escopo do usuário e depois escolha nesta página a capacidade específica do host. O core/controller
continua independente de Command Code, OpenCode, Claude Code, Codex, Hermes, Orca e qualquer outro
harness. O controller publicado cobre o daemon e os hooks no escopo do usuário; a inferência de
Hermes e OpenCode pelo proxy local continua usando o setup por checkout no [guia de instalação](../install.pt-BR.md).

**Português (BR)** · [English](README.md)

~~~bash
npm install --global @vizuh/sabi-controller@0.1.0
sabi setup
sabi doctor
~~~

Se um host não tiver um seam de execução verificado, o Sabi ainda pode documentar ou observar esse
limite, mas o adaptador não deve alegar troca nativa de modelo que o host não consegue expor.

## Escolha pelo objetivo

| Objetivo | Adaptador(es) | Limite |
| --- | --- | --- |
| Trocar modelo + esforço de raciocínio dentro do Command Code | Mod do Command Code | Modelo + esforço por rodada |
| Roteiar requisições de modelo/provedor com suas próprias credenciais | OpenCode, Hermes, Prime Agent, Kilo, qualquer cliente compatível com OpenAI | Proxy local; somente modelo/provedor |
| Mover trabalho entre sessões/worktrees existentes | Hooks do controller para Claude Code, Codex e OpenCode + Orca | Controller de tarefa/sessão |
| Adicionar um novo host | Siga o [contrato de mantenedor](../maintainers.md) | Proposta de adaptador |

## Mapa de capacidades

| Adaptador | Forma | Status atual | Entrada opcional |
| --- | --- | --- | --- |
| [Command Code](command-code.md) | Mod em processo | Roteamento publicado de modelo + esforço por rodada | `cmd mods add -g npm:@vizuh/sabi-commandcode` |
| [OpenCode](opencode.md) | Proxy local + hook opcional do controller | Proxy testado por protocolo; controller parcial | `npm start` + `npm run connect:opencode` |
| [Hermes](hermes.pt-BR.md) | Middleware nativo `llm_request` + proxy | Caminho Hermes 0.21.3 fixado e testado; caminhos auxiliares separados | Perfil isolado |
| [Oh My Pi](oh-my-pi.md) | Provider de extensão compatível com OpenAI | Contrato de fonte + fixture + smoke no OMP 18.2.8 instalado testados | `omp --extension ... --model sabi/sabi-code` |
| [Prime Agent](prime-agent.md) | Provider compatível com OpenAI + sondas | Compatibilidade do proxy testada com mock; timing nativo experimental | Perfil manual |
| [Kilo](kilo.md) | Provider compatível com OpenAI | Receita de CLI testada; VS Code é um gate separado | Perfil manual |
| [Cline](cline.md) | Provider compatível com OpenAI | Fixture de protocolo testada; execução real da extensão pendente | Perfil manual |
| [Claude Code](claude-code.md) | Hook de controller no prompt do usuário | Integração parcial do controller | `sabi setup` |
| [Codex](codex.md) | Hooks de ciclo de vida/prompt do controller | Integração parcial do controller | `sabi setup` |
| [Orca](orca.md) | Plugin + ponte de inventário/dispatch | Inventário e superfície de dispatch limitada | `sabi setup` + Orca |
| DeepSeek Harness | Bundle DSH + proxy Sabi | Somente inferência; runtime developer-preview, receipt DSH ao vivo pendente | `dsh plugin --profile <name> add @vizuh/sabi-deepseek-harness` |

## Leia o suporte corretamente

Uma linha marcada como testada significa que existe a evidência descrita na página. Não significa
que todas as famílias de modelos, assinaturas, agentes filhos, extensões ou versões futuras sejam
suportadas.

- **Roteamento de inferência** muda a próxima requisição de modelo/provedor.
- **Roteamento do controller** escolhe uma ação de sessão ou worktree.
- **Detecção** significa apenas que um comando existe no `PATH`.
- **Catálogo** significa apenas que um nome de modelo foi observado; elegibilidade e quota continuam desconhecidas.
- **Compatibilidade com mock** prova preservação de protocolo, não qualidade nem economia.

O README do pacote é a referência de implementação quando existe:
[Command Code](../../packages/adapters/command-code/README.md),
[Hermes](../../packages/adapters/hermes/README.md),
[DeepSeek Harness](../../packages/adapters/deepseek-harness/README.md) e
[Orca](../../packages/adapters/orca/README.md). Esses READMEs de implementação permanecem em inglês.
