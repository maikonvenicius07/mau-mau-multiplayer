-- MAU-MAU CANDEIAS: diagnóstico SOMENTE DE LEITURA.
-- Execute exclusivamente em ferramenta PostgreSQL autorizada do banco correto.
-- Nenhum comando modifica dados, usuários, resultados ou ranking.
-- Filtra os dias 08/11/2026 em diante, usando horário local de Rondônia (UTC-4).

-- A) Partidas, resultados e vitórias gravadas por data e modalidade.
SELECT (m.finished_at AT TIME ZONE 'America/Porto_Velho')::date AS dia_ro,
       m.mode,
       COUNT(DISTINCT m.match_id) AS partidas_gravadas,
       COUNT(r.player_key) AS resultados_de_jogadores,
       COUNT(r.player_key) FILTER (WHERE r.won IS TRUE) AS vitorias_gravadas
FROM mm_matches m
LEFT JOIN mm_match_results r ON r.match_id=m.match_id
WHERE m.finished_at >= TIMESTAMPTZ '2026-11-08 00:00:00-04'
GROUP BY 1,2
ORDER BY 1 DESC,2;

-- B) Data da última partida concluída registrada em cada modalidade.
SELECT mode,
       MAX(finished_at AT TIME ZONE 'America/Porto_Velho') AS ultima_partida_hora_ro,
       COUNT(*) AS partidas_na_temporada
FROM mm_matches
WHERE season_id=1
GROUP BY mode
ORDER BY mode;

-- C) Total por modalidade na Temporada 1, independentemente do filtro HOJE.
SELECT m.mode,
       COUNT(DISTINCT m.match_id) AS partidas,
       COUNT(r.player_key) FILTER (WHERE r.won IS TRUE) AS vitorias
FROM mm_matches m
LEFT JOIN mm_match_results r ON r.match_id=m.match_id
WHERE m.season_id=1
GROUP BY m.mode
ORDER BY m.mode;

-- D) Confirmação da geração do ranking (sem atualizar ou reiniciar a temporada).
SELECT meta_key,meta_value,updated_at
FROM mm_ranking_meta
WHERE meta_key='ranking_generation';
