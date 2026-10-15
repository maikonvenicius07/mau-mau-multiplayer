# MAU-MAU CANDEIAS — V50.3 Trocar câmera frontal/traseira

Atualização incremental sobre a V50.2 (câmera flutuante arrastável).

## O que foi acrescentado

- Novo botão **🔄** no canto inferior direito da prévia flutuante do **próprio jogador**, visível **somente com a câmera ligada**.
- Em celulares, o botão tenta alternar entre **câmera frontal e câmera traseira**. Em computadores com duas ou mais câmeras, alterna entre as webcams detectadas.
- Troca a câmera **na mesma faixa WebRTC publicada no LiveKit**, sem reiniciar a sala nem alterar o microfone.
- A prévia atualiza para a nova câmera; a prévia frontal permanece espelhada e a traseira não fica espelhada quando o navegador informa corretamente a orientação.
- O botão 🔄 não arrasta a janela por acidente. O restante do círculo continua arrastável, com posição salva conforme V50.2.
- Quando há apenas uma câmera disponível, exibe um aviso em vez de impedir a partida.
- **Sem gravações**: não usa MediaRecorder, armazenamento de vídeo, captura de frames ou envio de vídeo pelo Socket.IO. Somente as posições dos controles já eram salvas pelo navegador.

## Arquivos incluídos no ZIP de atualização

- `public/camera-video.js` — lógica de alternância de câmera e atualização de prévia.
- `public/index.html` — botão 🔄 e versão do JS/CSS para evitar cache desatualizado.
- `public/styles.css` — aparência do botão e prévia frontal/traseira.
- `tests/camera-v501-contract.test.js` — valida nova versão do carregamento.
- `tests/camera-v502-floating.test.js` — valida nova versão do carregamento.
- `tests/camera-v503-switch.test.js` — testes de troca frontal/traseira, webcam, ausência de segunda câmera e prevenção de arraste.
- `INSTALAR_CAMERA_V50.3.md` — este documento.

**Não houve alteração** em `server.js`, `package.json`, `package-lock.json`, regras de cartas, bots, login, ranking, observadores, áudio e reconexão.

## Instalação

1. Faça backup do MAU-MAU que está funcionando.
2. No GitHub, envie os arquivos do ZIP de atualização às **mesmas pastas**, substituindo os existentes.
3. Faça commit e aguarde o Render executar o deploy. Não é necessário recriar projeto/chaves do LiveKit.
4. No navegador, faça uma atualização forçada (`Ctrl+F5` no computador). No celular, feche e reabra a página/PWA para obter os scripts novos.
5. Entre em uma partida, ligue a câmera 📷 e pressione **🔄** na sua própria prévia para alternar.
6. Teste em dois aparelhos para verificar que o **outro jogador também vê** a câmera trocada.

## Testes e limitações

- Teste em memória com SDK LiveKit simulado: troca frontal/traseira; webcams; prévia atualizada; disponibilidade do botão; ausência de segunda câmera e bloqueio de arraste acidental.
- Testes de sintaxe e contrato da câmera V50.1/V50.2 passaram.
- Suíte geral: **111 testes passaram**; **1 teste** de integração Socket.IO não foi executado por falta de `socket.io-client` no ambiente desta auditoria.
- **Pendente de validação física**: troca de câmera em Chrome Android, Safari iPhone e aparelhos específicos. A enumeração/permissão de câmeras varia conforme navegador e fabricante. Alguns aparelhos possuem uma só câmera ou não aceitam alternância durante a transmissão; o sistema mostrará uma mensagem quando detectar falha.
- Se uma troca falhar e a imagem deixar de funcionar, desligue e religue a câmera; a partida deve permanecer ativa.

A aplicação **não grava** a mídia e não cria arquivos de vídeo no Render/PostgreSQL. Isso não impede que terceiros gravem a própria tela externamente nem significa ausência de metadados de rede no fornecedor.
