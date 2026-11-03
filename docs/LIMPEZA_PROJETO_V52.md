# Limpeza segura do projeto — V52

## Objetivo
Reduzir ruído no repositório e pequenos consumos contínuos no front-end sem alterar regras do Mau-Mau, Socket.IO, câmera, microfone, observadores, ranking, torneios ou autenticação.

## Alterações realizadas

### 1. Raiz do projeto
Notas históricas de atualização, instalação, validação e patches antigos foram movidas para:

`docs/archive/root-history/`

Nada foi apagado; o histórico foi preservado.

A raiz agora mantém principalmente arquivos de execução, configuração, README e CHANGELOG.

### 2. Timers do front-end
Foram ajustados três contadores que antes ficavam ativos continuamente:

- convites;
- matchmaking;
- reconexão.

Agora eles são iniciados apenas quando existe uma situação ativa que precisa de contagem e são encerrados quando deixam de ser necessários.

A atualização visual passou para 1 segundo, suficiente para contadores exibidos em segundos e com menor atividade de CPU/DOM.

### 3. O que NÃO foi alterado

- regras das cartas;
- ordem de turnos;
- Jogada/Ação Rápida;
- Queima;
- Carta Dupla;
- observadores e promoção para jogador;
- reconexão e AUTO;
- ranking;
- torneios;
- câmera;
- microfone/voz;
- autenticação;
- banco de dados;
- layout atual.

## Próximas limpezas recomendadas
A próxima etapa deve ser feita separadamente e com testes visuais:

1. renderização seletiva de `renderPlayers`, `renderHand`, `renderCenter` e `renderControls`;
2. consolidação gradual do CSS mobile;
3. modularização de `public/app.js`;
4. unificação dos pools PostgreSQL, se validado em ambiente de teste.
