# V40.46 — Performance Mobile

## Objetivo

Reduzir uso de memória, tráfego e carregamento no celular sem alterar as regras do jogo.

## Alterações

1. Música longa via HTMLAudioElement, sem `decodeAudioData` para as trilhas.
2. Música da tela inicial recomprimida para 112 kbps.
3. Avatares fixos em 256×256 WebP.
4. Figurinha personalizada nova em 192×192 WebP e limite de 90.000 caracteres no data URL gerado.
5. Migração local de figurinhas antigas grandes quando possível.
6. Cache HTTP de assets e cache-busting V40.46 para JS/CSS.

## Reversão de avatares

O backup `MAU-MAU_V40.45_Backup_Avatares_Originais.zip` deve ser mantido fora do projeto publicado. Para reverter, substitua apenas `public/assets/avatars/` pelos arquivos do backup.

## Regras preservadas

Ás, Dama (incluindo a regra validada para 2 jogadores), Queima, Carta Dupla, Ação Rápida, regra do 7, reconexão, observador e microfone não foram alterados.
