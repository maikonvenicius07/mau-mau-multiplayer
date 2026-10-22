# MAU-MAU CANDEIAS — V51.6.1 — Silenciar sons do jogo

## Objetivo

Controle de áudio mais visível e confiável, sem alterar as regras, torneios, câmera, microfone ou reconexão.

## O que foi alterado

- Na **tela principal**, aparece um controle discreto **🔊 Som ligado / 🔇 Jogo silenciado**.
- **Dentro da partida**, o botão 🔊 no topo agora tem texto e informa claramente quando está silenciado.
- Ambos os botões alteram a mesma preferência e salvam a escolha neste navegador (`localStorage`, chave `maumauSound`).
- Ao silenciar, efeitos de cartas, campainha de turno, sons de reações e vozes de narração do jogo param imediatamente, inclusive sons já iniciados.
- Não suspende o `AudioContext` compartilhado com a tecnologia de áudio ao vivo.
- **Microfone, conversa entre jogadores, mensagens de áudio e Minha Música** continuam com seus controles próprios. A vibração tem botão próprio.
- As preferências são **locais por dispositivo**, sem alterar o som de outros jogadores.

## Instalação

1. Salve uma cópia do projeto atual.
2. No GitHub, envie os arquivos do ZIP de atualização respeitando suas pastas.
3. Aguarde o deploy no Render.
4. Atualize a página, inclusive por Ctrl+F5 se houver cache.
5. Na tela principal toque em **Som ligado** para alternar para **Jogo silenciado**.
6. Entre numa sala e verifique que o controle no topo reflete a mesma opção.
7. Faça uma jogada que reproduz som: quando estiver silenciado, não deve tocar efeito ou voz de narração.
8. Confirme que um segundo jogador continua conseguindo falar pelo microfone e ser ouvido normalmente.
9. Toque em **Jogo silenciado** para reativar os efeitos.

## Arquivos modificados ou acrescentados

- `public/index.html`
- `public/styles.css`
- `public/app.js`
- `tests/silenciar-jogo-v5161.test.js` (novo)
- `INSTALAR_SOM_V51.6.1.md` (novo)

**Sem alterações no banco, nas variáveis do Render, no LiveKit ou no servidor.** Nenhum áudio ou vídeo é gravado pela nova função.
