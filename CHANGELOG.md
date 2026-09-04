# Changelog

Este arquivo mantém somente os marcos relevantes do projeto. Os antigos arquivos separados `ATUALIZACAO_V*.txt` foram consolidados para evitar documentação repetida na raiz do repositório.

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
