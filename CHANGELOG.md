# CHANGELOG


## V40.35 — Microfone do observador sempre visível

- Move o botão `liveMicBtn` para fora da mesa (`felt`), evitando recorte por `overflow: hidden`.
- Garante por CSS que o botão permaneça visível no `Modo Observador`.
- Cria posição flutuante independente para jogador e observador.
- No primeiro uso como observador, posiciona o microfone na parte inferior esquerda da tela, onde não disputa espaço com o painel do modo observador.
- Mantém voz WebRTC entre jogadores e observadores, privacidade das cartas e bloqueio das ações de jogo.
- Adiciona teste de regressão específico para a visibilidade do microfone do observador.

## V40.34 — Microfone também para observadores

- Observadores agora veem e podem ligar o botão flutuante **🎙️ LIGAR MICROFONE**.
- Voz ao vivo WebRTC passa a conectar **jogadores humanos e observadores** da mesma sala.
- O servidor continua aceitando apenas sinalização WebRTC; o áudio permanece P2P.
- Observadores continuam sem receber cartas privadas e continuam bloqueados de jogar, comprar, queimar ou executar qualquer ação da partida.
- A lista de observadores mostra um pequeno **🎙️** quando um observador está com o microfone ligado.
- Reconexão automática, fila ICE, Opus e TURN opcional da V40.33 foram preservados.

## V40.33 — Microfone ao vivo mais estável

- corrigida a perda de candidatos ICE quando a sinalização chega durante a negociação;
- adicionada reconexão automática quando um enlace de voz falha ou fica desconectado;
- o microfone tenta retomar automaticamente após uma oscilação da conexão Socket.IO;
- captura otimizada para fala: cancelamento de eco, redução de ruído, ganho automático, mono e preferência por 48 kHz;
- preferência pelo codec Opus e limite de bitrate voltado para voz;
- música é reduzida automaticamente enquanto há conversa ao vivo, melhorando a inteligibilidade;
- novo estado visual **RECONECTANDO...** no botão do microfone;
- suporte opcional a servidor TURN via `VOICE_TURN_URLS`, `VOICE_TURN_USERNAME` e `VOICE_TURN_CREDENTIAL`;
- o áudio continua sem ser salvo no PostgreSQL, ranking ou histórico de chat.

## V40.32 — Central de Partidas ao Vivo e Modo Observador aprimorado

- Nova opção **👁️ ASSISTIR PARTIDAS** na tela inicial.
- Contadores de salas públicas, partidas ao vivo e observadores conectados.
- Lista de salas públicas em andamento com entrada direta como observador.
- Cada sala criada pela tela inicial pode ser marcada como pública ou privada.
- O anfitrião pode alternar a visibilidade da sala durante a sessão.
- Painel exclusivo do observador com jogadores, rodada, número de espectadores, lista de observadores e acontecimentos recentes.
- As cartas privadas continuam protegidas no servidor e não são enviadas ao observador.

## V40.31 — Lobby de avatares mais equilibrado

- agrupados **Pessoas** e **Sua Figurinha** em uma coluna lateral própria;
- removida a lacuna vertical grande que aparecia antes da área de figurinha;
- figurinha personalizada ficou menor e mais discreta;
- mantidos seleção, troca, remoção, avatares premium e toda a lógica do jogo;
- layout mobile continua empilhado e responsivo.


## V40.30 — Figurinha mais discreta

- A área **Sua Figurinha** foi movida para a parte inferior da galeria de avatares, ficando mais alinhada com o layout da tela inicial.
- O componente ficou mais **compacto e discreto**, com preview menor e botões reduzidos.
- O botão principal mantém a seleção da figurinha personalizada sem alterar a lógica existente do avatar customizado.
- Em celular, a área continua empilhada e com toque confortável.

# Changelog

## V40.26 — Avatares Premium
- redesenhados **Tela Azul, Caldinho, Anão, Anão Cabeção, Vesgo e Hulk Magrelo**;
- novo padrão visual com acabamento 3D/cartoon, luz, volume e halo, compatível com os avatares originais;
- imagens otimizadas em WEBP para manter boa qualidade sem pesar no carregamento;
- nenhuma regra, turno, ranking ou lógica multiplayer foi alterada.

## V40.25 — Figurinha própria e novos avatares
- incluída opção para o jogador enviar a própria figurinha (JPG, PNG ou WEBP);
- a imagem é centralizada, recortada e convertida automaticamente para WEBP antes de ser usada;
- adicionados os novos avatares: **Tela Azul, Caldinho, Anão, Anão Cabeção, Vesgo e Magrelo Verde**;
- mantidas as regras existentes do jogo, sem alteração de turnos, cartas especiais ou ranking.

## V40.24 — Avatares Fixos + Turno em Destaque
- corrigida a ordem visual dos assentos para que ela não dependa mais de `direction`;
- Dama/inversão, Ás/pulo e demais cartas especiais agora mudam apenas a fila/indicadores, sem reorganizar os avatares;
- adicionado destaque forte e elegante no jogador de `currentPlayerId`;
- adicionado indicador `SUA VEZ` para o jogador local e `VEZ DE [NOME]` para os demais;
- preservado o indicador `PRÓXIMO`, calculado pela fila real do servidor;
- nenhuma alteração em `game-engine.js` ou `server.js`.

## V40.23 — Ação Rápida Flutuante
- a **Ação Rápida (⚡)** agora usa um **botão flutuante**, igual à Queima e à Carta Dupla;
- o botão aparece **somente quando a ação estiver disponível**;
- o jogador pode **arrastar o botão** para onde achar melhor e a posição fica salva no navegador;
- o botão some automaticamente quando a oportunidade de Ação Rápida termina;
- removido o pequeno botão ⚡ de cima da carta, deixando a mão mais limpa no celular.

## V40.22 — Carinha Discreta com Transparência Inteligente
- Reduzi o tamanho do botão flutuante de reações, deixando somente a carinha **😊** menor e mais discreta.
- Adicionei efeito de **semi-transparência automática** após alguns segundos sem uso.
- Ao tocar, arrastar, focar ou abrir o painel de reações, a carinha volta automaticamente para o estado totalmente visível.
- Mantive o comportamento atual: a carinha continua arrastável, com posição salva no navegador do jogador.

## V40.21 — Reações com Apenas a Carinha

- simplificada a barra flutuante de reações para exibir **somente a carinha 😊** na mesa;
- ao tocar na carinha, abre o painel com **todas as reações disponíveis**;
- o próprio botão **😊** agora pode ser arrastado para qualquer posição da tela;
- **duplo toque** na carinha devolve o botão à posição inicial;
- removidos da área visível os atalhos fixos **😂**, **😡** e **🔊**, reduzindo poluição visual na mesa.

## V40.20 — Todas as Reações em um Toque

- adicionado botão **😊** na barra flutuante de reações rápidas;
- ao tocar em **😊**, abre um painel compacto com **todas as reações da mesa**;
- painel inclui **👏 Aplausos, 😂 Risada, 😡 Raiva, 📯 Corneta, 🥁 Tambores, 🎉 Vitória, 😱 Uau e 🔊 Joga Boca Aberta**;
- ao escolher uma reação, o painel fecha automaticamente;
- o painel abre acima ou abaixo da barra conforme o espaço disponível na tela;
- mantém a barra arrastável e a posição salva da V40.19.

## V40.19 — Reações Rápidas Flutuantes

- a barra de reações rápidas **😂 😡 🔊** agora é **flutuante e reposicionável**;
- o jogador pode **arrastar a barra** pela alça lateral e colocá-la onde preferir;
- a posição escolhida fica salva no navegador do próprio jogador;
- **duplo clique na alça** retorna a barra à posição inicial;
- mantém o mesmo comportamento de **um toque** para risada, raiva e **JOGA BOCA ABERTA**.

## V40.18 — Reações Rápidas Visíveis

- adicionados **3 atalhos rápidos sempre visíveis** logo abaixo do topo do jogo: **😂 risada**, **😡 raiva** e **🔊 joga boca aberta**;
- o atalho **🔊** fala em voz alta **"JOGA BOCA ABERTA!"** com um clique;
- incluído o novo efeito **Raiva** também dentro do painel de chat/efeitos;
- o botão de **Joga Boca Aberta** no painel lateral foi simplificado para estilo de **alto-falante**, ficando mais claro no celular.

## V40.17.0 — Interface mais limpa no celular

- Removidos os banners inferiores de **Queima disponível** e **Carta Dupla disponível**.
- Mantidos os botões flutuantes reposicionáveis, o destaque das cartas e o foco automático.
- Nenhuma regra do jogo foi alterada.

## V40.16.0 — Seta do próximo jogador

- Adicionada seta visual **PRÓXIMO** no avatar de quem jogará depois do jogador atual.
- A indicação acompanha automaticamente o avanço dos turnos e a inversão de sentido pela Dama.
- Próximo jogador recebe contorno visual adicional, com ajuste para desktop e celular.
- Respeita `prefers-reduced-motion`.

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
