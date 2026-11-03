# Microfone ao vivo — V40.33

A V40.33 reforça a estabilidade do microfone WebRTC sem alterar as regras do Mau-Mau.

## Melhorias

- fila de candidatos ICE durante a negociação;
- recuperação automática de conexões `disconnected`/`failed`;
- retomada após retorno da internet e reconexão da sala;
- áudio mono otimizado para fala, com cancelamento de eco, redução de ruído e ganho automático;
- preferência por Opus e bitrate de até 48 kbps por enlace;
- redução automática da música durante voz ao vivo;
- indicação visual `RECONECTANDO...`;
- TURN opcional para redes em que STUN/P2P não é suficiente.

## TURN no Render

Para máxima compatibilidade entre operadoras móveis, Wi-Fi corporativo e CGNAT, configure um provedor TURN e adicione no Render:

- `VOICE_TURN_URLS`: uma ou mais URLs separadas por vírgula, por exemplo `turn:host:3478?transport=udp,turns:host:5349?transport=tcp`;
- `VOICE_TURN_USERNAME`: usuário do TURN;
- `VOICE_TURN_CREDENTIAL`: senha/credencial do TURN.

Sem TURN, o jogo continua usando STUN e conexão P2P direta. A V40.33 melhora bastante a recuperação, mas nenhuma implementação WebRTC baseada apenas em STUN consegue garantir conexão entre todas as combinações de redes/NAT.
