# MAU-MAU CANDEIAS — Status Pré-APK

**Data:** 23/09/2026  
**Base:** projeto completo enviado após validação da reconexão crítica.

## Concluído

- [x] Regras centrais congeladas e protegidas por teste de regressão.
- [x] Login Google preservado.
- [x] Login por e-mail + senha de 6 a 60 caracteres.
- [x] Recuperação de senha por código de 6 dígitos enviado por e-mail.
- [x] Domínio `maumaucandeias.com.br` verificado para envio.
- [x] PostgreSQL persistente em plano pago.
- [x] Limite padrão de 10 salas e 5 observadores por sala.
- [x] Reconexão crítica de F5/reload corrigida por identidade persistente.
- [x] AUTO temporário após 60 segundos preservado.
- [x] Regra de 5 minutos quando todos os humanos ficam offline preservada.
- [x] Confirmação antes de abandonar uma partida ativa para entrar em outra sala.
- [x] Documentação operacional alinhada ao estado atual.

## Próximas etapas antes do primeiro APK

1. Testes reais completos em dois dispositivos/contas: F5, fechar/abrir navegador, Wi-Fi ↔ 4G/5G, retorno após AUTO, observadores, voz, convites e troca voluntária de sala.
2. Teste de carga nos limites atuais do servidor.
3. Criar Web App Manifest e ícones 192×192 / 512×512, sem alterar a lógica do jogo.
4. Definir identificador Android e versão inicial do aplicativo.
5. Preparar Trusted Web Activity (TWA) para preservar o fluxo web e o login Google.
6. Gerar chave de assinatura Android e guardá-la com segurança.
7. Publicar `/.well-known/assetlinks.json` para associar o domínio ao aplicativo.
8. Gerar APK de teste e instalar em pelo menos dois aparelhos Android.
9. Repetir a bateria de testes dentro do APK.
10. Somente depois gerar a versão candidata para distribuição/publicação.

## Itens que não devem ser alterados durante a preparação do APK

- regras das cartas;
- ordem dos jogadores e turnos;
- mão, pontuação e efeitos especiais;
- comportamento do AUTO temporário;
- ranking OFICIAL/TREINO;
- limites atuais de salas e observadores;
- política de 5 minutos totalmente offline;
- identidade persistente por conta.
