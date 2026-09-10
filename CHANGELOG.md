# Changelog

## V40.15.0 — Ordem visual dos jogadores

- Avatares reposicionados na mesa conforme a ordem real de jogar.
- O próprio jogador permanece ancorado na parte inferior da mesa.
- Inclusão de selo visual em cada avatar: **JOGA AGORA**, **PRÓXIMO** ou posição na fila.
- Distribuição ajustada no desktop e no celular para manter a leitura da sequência com 2 a 5 jogadores.

## V40.14.0 — Queima e Carta Dupla flutuantes

- Adicionados botões flutuantes **🔥 QUEIMA** e **×2 DUPLA**, exibidos apenas quando a ação correspondente está disponível.
- Ambos podem ser arrastados livremente; a posição é salva no navegador e restaurada nas próximas partidas.
- As cartas válidas continuam com destaque visual e foco automático, mas os botões deixam de ocupar espaço sobre as cartas.
- Quando existem várias opções de Carta Dupla, um seletor compacto permite escolher a dupla desejada.
- Duplo clique em cada botão restaura sua posição padrão.
- Mantidas integralmente as regras atuais de Queima, Queima da abertura, Carta Dupla e Mau-Mau.


## V40.13.0 — Carta Dupla otimizada para celular

- O botão **×2 JOGAR DUPLA** passa a existir em somente uma das duas cartas idênticas de cada par.
- A segunda carta permanece identificada visualmente como integrante da dupla, sem botão repetido.
- O botão foi deslocado para a parte superior da carta e ampliado no mobile para facilitar o toque.
- A carta dona do botão ganha prioridade de `z-index` em mãos sobrepostas.
- Quando a mesma carta também oferece Queima, o ×2 fica acima e o botão **QUEIMAR** abaixo.
- Nenhuma regra do motor da Carta Dupla foi alterada.


## V40.12.0 — Liberdade de anúncio na batida

- Corrige a regra das duas últimas cartas: o jogador pode escolher **Mau-Mau** simples ou **Mau-Mau batendo/queimando**.
- Ambos os anúncios permitem finalizar por **Queima + continuação** ou **Carta Dupla**.
- Sem anúncio, a batida composta continua proibida.
- Mantida a possibilidade de anunciar Mau-Mau simples, queimar uma carta e passar, ficando com uma carta.


## V40.11.0 — Carta Dupla visual melhorada

- Destaque dourado reforçado para cartas com Carta Dupla disponível.
- Botão pequeno `×2` substituído por **×2 JOGAR DUPLA**, maior e mais fácil de tocar.
- Aviso na mão quando existir Carta Dupla disponível.
- Foco automático na primeira dupla disponível em mãos grandes, sem tirar a prioridade da Queima quando ambas aparecem.
- Queima e Carta Dupla simultâneas ficam com botões separados na mesma carta.
- Nenhuma regra da Carta Dupla foi alterada.


## V40.10.0 — Queima mais visível

- Substitui o pequeno botão 🔥 por uma faixa/botão **🔥 QUEIMAR** maior sobre a carta queimável.
- Reforça a borda e o brilho laranja das cartas com Queima disponível.
- Adiciona aviso **QUEIMA DISPONÍVEL** junto à mão.
- Centraliza automaticamente a primeira carta queimável quando a oportunidade aparece, especialmente útil em mãos grandes.
- Na exceção da abertura, tocar diretamente na carta destacada também pode executar a Queima quando não há outra ação concorrente.
- Mantém inalteradas as regras de Queima, Ação Rápida, Carta Dupla e cartas especiais.

## V40.9.0 — Microfone flutuante

- O botão **🎙️ LIGAR MICROFONE** agora é flutuante e pode ser arrastado livremente pelo jogador.
- Funciona com mouse e toque usando Pointer Events.
- A posição é salva no navegador (`localStorage`) e restaurada ao voltar ao jogo.
- O botão é limitado à área visível da tela para não ficar perdido fora do viewport.
- Ao redimensionar ou girar a tela, a posição é automaticamente ajustada para continuar visível.
- Arrastar não liga/desliga o microfone por engano; clique/toque curto continua controlando o microfone.
- Duplo clique retorna o botão à posição inicial.
- A alteração é somente visual/local e não modifica WebRTC, regras, cartas ou posições dos jogadores.

## V40.8.0 — Novo Ranking + Temporada 1

- Reset único do ranking antigo no primeiro deploy da V40.8, preservando as identidades Google dos jogadores.
- Início da **Temporada 1** com resultados zerados.
- Ranking simplificado para contar **somente vitórias**.
- Modalidades separadas em **👥 OFICIAL** (somente humanos) e **🤖 TREINO** (partidas com máquina).
- Novos filtros: **Hoje, Semana, Mês, Temporada e Histórico**.
- Histórico começa vazio enquanto a primeira temporada estiver em andamento.
- `playerKey` derivado da Conta Google é a chave única do jogador; mudança de nome/avatar apenas atualiza a apresentação.
- Empates em número de vitórias recebem a mesma posição.
- `matchId` passa a incluir `matchSerial`, evitando perda de registro de revanches na mesma sala.

## V40.7.0 — Instrumental na tela inicial

- Adicionada a faixa `tela_inicial_instrumental.mp3`, derivada do áudio enviado pelo usuário.
- A voz foi reduzida por processamento de cancelamento vocal, priorizando a base instrumental.
- A nova faixa toca **somente na tela inicial** (`state == null`).
- O lobby de uma sala continua usando `Mesa Aberta`.
- Durante a partida continuam disponíveis o modo Dinâmico e o **Rock Candeias**.

## V40.6.0 — Rock Candeias

- Adicionada a faixa original **🎸 Rock Candeias** ao painel de música.
- Novo seletor de estilo: **Dinâmica** ou **Rock Candeias**.
- A preferência musical fica salva no navegador.
- No modo Rock, a faixa toca durante a partida normal; a trilha de última carta, conferência e stingers de vitória permanece dinâmica.
- Arquivo `rock_candeias.mp3` sintetizado do zero, sem samples ou gravações de terceiros.


## V40.5.0 — Microfone ao vivo na mesa

- Adicionado botão **🎙️ LIGAR MICROFONE** na área superior da mesa, no ponto indicado pelo usuário.
- Voz em tempo real entre jogadores humanos usando WebRTC; Socket.IO é usado apenas para sinalização.
- Áudio não é gravado, não passa pelo PostgreSQL e não entra no ranking.
- Botão alterna para **MICROFONE LIGADO** e exibe indicador verde enquanto transmite.
- Jogadores com microfone ativo recebem um pequeno ícone 🎙️ junto ao nome.
- Cancelamento automático do microfone ao sair da sala ou perder a conexão, preservando privacidade.
- Mantido o Áudio Rápido de 15 s; quando o microfone ao vivo está ativo, a gravação rápida reutiliza uma cópia da faixa de áudio quando possível.
- STUN público configurado para negociação P2P; redes muito restritivas podem exigir TURN em uma etapa futura.

## V40.4.0 — Jogar de Novo
- Ao terminar uma partida entre jogadores humanos, aparece **🔁 JOGAR DE NOVO**.
- Cada jogador confirma individualmente que deseja continuar.
- Quando todos os humanos conectados confirmam e há pelo menos 2 jogadores, uma nova partida de 5 rodadas começa automaticamente na mesma sala.
- O placar e o histórico de rodadas são zerados para a nova partida, sem exigir novos convites.
- A partida anterior continua sendo registrada separadamente no ranking, mesmo se a nova partida começar antes da gravação assíncrona terminar.

Este arquivo mantém somente os marcos relevantes do projeto. Os antigos arquivos separados `ATUALIZACAO_V*.txt` foram consolidados para evitar documentação repetida na raiz do repositório.

## 40.3.0 — Queima da primeira carta
- Corrige a abertura da rodada: a primeira carta normal virada pode ser queimada por qualquer jogador que tenha uma cópia exatamente igual, mesmo fora da vez.
- A primeira Queima válida assume a jogada e usa a continuação normal da Queima.
- A janela especial termina assim que ocorre a primeira ação normal da rodada.
- Bots e jogadores humanos seguem a mesma regra da abertura.

## 40.2.0 — Buscar Jogadores
- Matchmaking automático de 2 a 5 jogadores.
- Com 1 jogador a fila aguarda; ao entrar o 2º começa uma janela de 15 s.
- Com 5 jogadores a partida começa imediatamente.
- Cancelamento e remoção da fila validados no servidor.
- Aceitar convite remove o jogador da fila antes da troca de sala.

## 40.1.0 — Jogadores Online + Convites
- Presença online unificada pela identidade Google.
- Lista com avatar, nome e status.
- Convites de 30 s com aceitar/recusar.
- Reserva temporária de vaga sem interromper partida multiplayer em andamento.
- Integração com Reconexão Inteligente.

## 39.2.0 — SUA VEZ melhorado
- Aviso grande, destaque visual e iluminação das cartas válidas.
- Campainha curta e vibração opcional.
- Preferência de vibração salva no navegador.

## 39.1.0 — Reconexão Inteligente
- 60 s de tolerância para reconexão.
- Depois do prazo, AUTO temporário joga a mesma mão/posição do usuário.
- Ao retornar, o jogador humano retoma a vaga.
- A identidade do ranking permanece humana.

## 38.x — Consolidação da experiência online
- Login Google obrigatório e sessão HttpOnly.
- Conferência visual da pontuação ao fim da rodada.
- Música dinâmica original.
- Áudio Rápido de até 15 s.
- Regras e textos da interface consolidados.

## 37.x — Consolidação das regras e mobile
- Regras atuais de Queima, Ação Rápida e Carta Dupla consolidadas.
- Melhorias de leitura e layout em celulares.

## Marcos anteriores
- Ranking persistente em PostgreSQL.
- Chat e efeitos compartilhados.
- Mau-Mau falado e alertas de uma carta.
- Bots, avatares e melhorias sucessivas do motor de jogo.
