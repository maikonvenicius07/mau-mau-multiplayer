# MAU-MAU CANDEIAS — Câmera ao vivo opcional V50.1

## O que foi implementado

- Câmera **opcional**, desligada por padrão, que substitui o avatar pelo vídeo ao vivo.
- Outros jogadores podem ver os vídeos quando há câmeras ativas; observadores **só podem assistir**.
- Webcam no computador e câmera do celular por autorização do navegador.
- Qualidade inicial 320×240 e 12 fps, adequada à área do avatar.
- Prévia local para o jogador no celular e retorno ao avatar ao desligar.
- Microfone existente, cartas, ranking, bots e reconexão **não foram alterados**.
- Quando alguém sai/desconecta, a câmera local é desligada e a presença temporária é apagada.
- **Nenhuma captura, gravação ou foto é salva no código, no servidor do Render ou no PostgreSQL.** A mídia é transmitida em tempo real pelo LiveKit. Não ativamos recursos de gravação no LiveKit. Outros usuários ainda podem fazer gravações externas de tela, o que o jogo não consegue impedir.
- O SDK de vídeo do LiveKit é carregado **apenas quando necessário**, de CDN com versão fixada. Não há novas dependências npm ou vídeos armazenados no repositório.

## Como ativar no Render — sem plano pago inicialmente

1. Crie um projeto no plano gratuito do **LiveKit Cloud**: https://cloud.livekit.io/. Confirme no painel os limites gratuitos vigentes.
2. Copie do LiveKit Cloud a URL WebSocket (`wss://...`), a API Key e a API Secret.
3. Render → Web Service do MAU-MAU → **Environment** → crie as variáveis:

```text
LIVEKIT_URL=wss://seu-projeto.livekit.cloud
LIVEKIT_API_KEY=sua-chave
LIVEKIT_API_SECRET=seu-segredo
```

4. **Não** inclua os valores reais no GitHub ou nos arquivos ZIP. O arquivo `.env.example` contém apenas campos vazios.
5. Salve as variáveis e faça o redeploy. Verifique se `/api/camera/config` responde com `{"enabled":true,"recording":false}`.
6. Entre com duas contas diferentes em dois dispositivos/navegadores. Ligue a câmera de um jogador. O outro deve enxergar o vídeo no lugar do avatar, sem precisar ligar sua própria câmera.
7. Repita o teste como observador e confirme que o observador **não tem permissão de publicar câmera**.
8. Teste desligamento, troca de sala, queda de conexão, F5, entrada do bot depois de 60 s, Chrome Android e Safari iPhone.

Se as três variáveis faltarem ou estiverem inválidas, **o jogo permanece operacional e o botão aparece indisponível**. Nenhuma câmera será transmitida e nada é cobrado por essa integração em si. A capacidade gratuita do LiveKit é limitada; não se garante uso ilimitado sem custo.

## Arquivos alterados

- `server.js`: autorização autenticada por sala, JWT efêmero assinado no servidor, política de segurança e presença de câmera.
- `public/index.html`: botão de câmera e prévia local.
- `public/app.js`: integra estado da partida, assentos e eventos de desconexão.
- `public/styles.css`: estilo para vídeo circular e celular.
- `public/camera-video.js`: **novo controlador**, somente transmissão em memória.
- `.env.example`: variáveis vazias de configuração.
- `tests/camera-v501-contract.test.js`: teste estático de contratos da versão.
- `INSTALAR_CAMERA_V50.1.md`: este guia.

## Segurança, custos e limitações de teste

- Os tokens são emitidos só para integrantes autenticados da sala, têm validade para conexão inicial de 10 minutos e só autorizam publicação de **câmera** para jogadores; espectadores recebem permissão apenas para assistir.
- A LiveKit Cloud funciona como servidor de mídia. As transmissões não entram em gravações nem bancos do projeto.
- O tráfego e os minutos dos participantes contam para o plano do LiveKit, inclusive quem assiste. Assim, após esgotar o limite gratuito, novas conexões de vídeo poderão falhar até a franquia renovar; o jogo deve permanecer funcional.
- Versão **candidata a testes**: arquivos JavaScript passaram na checagem de sintaxe e o teste de contrato de câmera passou. A suíte de integração inteira não pôde ser concluída neste ambiente porque as dependências npm não estão instaladas. O LiveKit Cloud não estava configurado para testar mídia real. É obrigatório um teste de dois dispositivos antes de publicar amplamente.
- Ainda não há corte remoto forçado de uma sessão LiveKit que permaneça conectada depois de expulsão do jogador por ação administrativa. O cliente normal encerra a câmera ao sair/desconectar; para exigências de moderação mais rigorosas, uma próxima versão deverá chamar a API de remoção de participantes do LiveKit.

## Entrega

- ZIP de atualização: contém **somente arquivos modificados e novos**, em seus caminhos relativos à raiz do GitHub.
- ZIP completo: contém todo o projeto na pasta `mau-mau-multiplayer-main`.
