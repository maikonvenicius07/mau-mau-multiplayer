# Fase 5B — Verificação técnica

## Resultado estático

- Logotipo PNG original (512 × 512): **393.497 bytes**.
- Logotipo WebP de exibição (512 × 512): **62.762 bytes**.
- Economia por transferência do recurso de logo: **330.735 bytes (84,05%)** quando não atendido do cache.
- Os PNG do manifesto/iOS não foram apagados nem substituídos.
- 17 imagens de avatares recebem `loading="lazy" decoding="async"`, sem alteração de `src`, IDs ou `data-avatar`.
- URLs de WebP versionadas com hash curto por `static-asset-versioning.js`.

## Resultados dos testes

- `node --check public/app.js`: aprovado.
- `node --check server.js`: aprovado.
- `node --check static-asset-versioning.js`: aprovado.
- Teste Fase 5B: aprovado.
- Teste Fase 5A (regressão de cache): aprovado.
- Suíte de testes locais: **147 aprovados, 0 falhas**.
- Teste Socket.IO end-to-end: **não executado**, a biblioteca `socket.io-client` não está instalada no ambiente de teste.

## Restrições do teste

- O Chromium disponível retorna `ERR_BLOCKED_BY_ADMINISTRATOR` ao abrir URL local ou arquivo local neste ambiente. Portanto, **não houve medição de LCP/FCP, CPU ou rede real**, nem teste visual da página inteira em navegador executando o servidor Express.
- Não é possível afirmar porcentagem de melhora do tempo total de carregamento; apenas o tamanho de recursos alterados foi medido.
- Testes entre dois celulares, fluxo de sessão, login, câmera/microfone e partida real são necessários após deploy.
