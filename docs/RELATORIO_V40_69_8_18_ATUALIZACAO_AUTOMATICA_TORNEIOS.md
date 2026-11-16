# MAU-MAU CANDEIAS — V40.69.8.18
## Atualização automática do painel de torneios
**Data:** 16/11/2026  
**Base:** V40.69.8.17 — Proteção de resultados pendentes

## Objetivo
O painel do torneio só atualizava dados ao abrir a janela ou pressionar **↻ Atualizar**. Essa versão automatiza a consulta do andamento do campeonato enquanto a janela de torneios estiver aberta, mantendo as regras competitivas, a classificação, a entrada automática, o modo observador e as partidas comuns intactas.

## Alterações implementadas
1. **Atualização automática:** a situação da competição, inscrições, placares públicos, mesas, fases e campeão é consultada pelo navegador a cada **15 segundos** enquanto o diálogo está aberto e a aba está visível e online.
2. **Atualização econômica da lista:** os nomes e estados da lista de campeonatos são verificados em intervalo separado de **60 segundos**, evitando recarregamentos mais frequentes do catálogo.
3. **Sem chamadas paralelas duplicadas:** uma requisição manual e outra automática ao mesmo torneio compartilham a mesma consulta em andamento. O temporizador também bloqueia ciclos paralelos.
4. **Preservação da interface:** dados idênticos não provocam reconstrução de tela. Em mudanças, mantêm-se a rolagem, o estado aberto de cada etapa da competição e os campos do organizador que estejam sendo editados.
5. **Pausa e retomada:** ao fechar a janela do torneio, os temporizadores são cancelados. Ao ocultar a aba ou perder a conectividade, a atualização pausa; ao voltar à aba, à conexão ou ao Socket.IO, retoma.
6. **Resiliência:** erros temporários exibem aviso discreto, sem apagar a última classificação consultada. As tentativas seguintes permanecem habilitadas. O botão **↻ Atualizar** continua disponível.
7. **Compatibilidade:** versão de cache do arquivo JavaScript foi atualizada no `index.html`, garantindo que navegadores carreguem a funcionalidade nova após o deploy.

## Arquivos criados
| Arquivo | Finalidade |
|---|---|
| `public/tournament-auto-refresh.js` | Gerencia o ciclo de atualização automática, temporizadores e frequência das consultas. |
| `tests/tournament-auto-refresh-v4069818.test.js` | Testes de temporização, interrupção, retomada, ausência de requisições concorrentes e preservação visual. |
| `docs/RELATORIO_V40_69_8_18_ATUALIZACAO_AUTOMATICA_TORNEIOS.md` | Relatório técnico desta versão. |

## Arquivos modificados
| Arquivo | Alteração |
|---|---|
| `public/tournament-ui.js` | Integra o mecanismo automático à tela, evita reconstrução sem mudança, deduplica consulta, mantém estado de formulário/rolagem/fases. |
| `public/index.html` | Inclui indicador de atualização e novo arquivo JS com cache-buster. |
| `public/styles.css` | Formata o indicador discreto de atualização e o aviso de erro. |

## Arquivos excluídos
Nenhum.

## Testes realizados
- **192 testes automatizados executados: todos aprovados.**
- **1 teste de integração Socket.IO não executado**, devido à indisponibilidade da dependência no ambiente usado; não foi classificado como falha do projeto.
- Sintaxe validada com `node --check` em `public/tournament-ui.js`, `public/tournament-auto-refresh.js` e `tests/tournament-auto-refresh-v4069818.test.js`.
- Testes novos verificam: um único temporizador; refresh de dados a cada 15 segundos; refresh de catálogo a cada 60 segundos; parada no fechamento; pausa no segundo plano; reinício ao voltar; erro recuperável; ausência de consultas paralelas; retenção de formulário em edição; etapas expandidas; posição da rolagem; não reconstrução quando a resposta é idêntica.
- Integridade dos ZIPs: checagem do arquivo completo e comparação byte a byte de cada arquivo contido no pacote incremental com o mesmo caminho no ZIP completo.

## Como implantar
1. **Confirme que o GitHub já está na V40.69.8.17.** O ZIP incremental foi gerado como diferença exatamente dessa versão.
2. Extraia o ZIP `SOMENTE_ALTERADOS` e substitua/adicione os arquivos correspondentes no GitHub, preservando os caminhos.
3. Faça o commit na branch usada pelo Render e acompanhe o build até seu término.
4. Limpe o cache da página ou recarregue para receber o novo script.
5. Abra **🏆 Torneios** e mantenha o painel aberto. Faça uma inscrição ou conclua uma mesa com outra conta; confirme a mudança na tela em até aproximadamente 15 segundos (sujeito a latência). Verifique também **↻ Atualizar**.
6. Deixe o navegador em segundo plano ou feche o painel; confirme que o acompanhamento não produz novos pedidos periódicos enquanto pausado.
7. Verifique o comportamento com instabilidade de rede e retorno à conexão.

## Limitações e próximas verificações
- A solução usa **consultas HTTP controladas** a cada 15 segundos quando a janela está aberta. Não é atualização instantânea por evento Socket.IO; o novo resultado aparece após a consulta seguinte.
- O código foi testado localmente, **não executado em uma partida real no Render com múltiplos participantes**.
- Não foram alterados banco, pontuação, regras das cartas, ranking, observadores, entrada automática, sorteio nem a lógica de resultados pendentes da V40.69.8.17.
- Recomenda-se validar em homologação com um torneio de pelo menos 6 participantes e duas mesas, com alteração de fases, observadores e reconexão.

## Entrega
- ZIP 1: projeto completo atualizado.
- ZIP 2: exclusivamente os arquivos criados ou modificados, com caminhos idênticos e bytes correspondentes ao projeto completo.
- Relatório Markdown independente: este documento.
