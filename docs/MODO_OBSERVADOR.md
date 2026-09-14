# Modo Observador — V40.31

## Separação de papéis

O servidor usa os papéis `PLAYER` e `SPECTATOR`. Jogadores permanecem em `room.players`. Observadores ficam em `room.spectators` e não participam de contagem de vagas, turno, distribuição ou pontuação.

## Privacidade das cartas

`roomPublicState(room, playerId)` continua sendo usado para jogadores. `roomSpectatorState(room, spectator)` parte somente do estado público e fornece uma identidade local com `hand: []` e listas de ações vazias. Durante `playing`, o estado de observador não contém mãos, conteúdo do deck nem o identificador privado de carta mantida após compra/passe.

A `roundReview` só é exposta em `between-rounds` ou `finished`, preservando a regra de conferência após a rodada.

## Interação

Observadores podem enviar mensagens de texto e reações sociais. Eventos de jogada continuam passando por `withRoom`, que rejeita explicitamente conexões `SPECTATOR`.

## Reconexão

O observador tem token próprio e permanece reservado por 60 segundos após perda de conexão. Esse prazo não pausa a partida e não aciona bot temporário.

## Histórico público e dados derivados da mão

Além de remover `hand`, conteúdo de `deck` e `keptCardId`, o estado do observador filtra mensagens internas que revelariam quantas jogadas válidas um jogador possui depois de comprar ou se ele ficou sem jogada válida. O observador recebe apenas o histórico que representa ações públicas da mesa, como carta jogada, quantidade comprada, Mau-Mau, efeitos especiais e mudança de turno.

## Entrada após o início

Uma entrada manual por código em uma partida já iniciada oferece o **Modo Observador**. Reconexões de jogadores são resolvidas antes dessa oferta, portanto um jogador que perdeu a conexão continua recuperando sua cadeira original. Entradas reservadas por convite continuam usando o fluxo próprio do sistema entre rodadas.
