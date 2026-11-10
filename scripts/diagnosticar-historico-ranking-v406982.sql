-- MAU-MAU CANDEIAS — V40.69.8.2
-- Diagnóstico SOMENTE DE LEITURA: não altera partidas, vitórias nem identidades.
-- Execute em PostgreSQL de produção antes do deploy (guarde o resultado)
-- e novamente após o deploy, comparando as contagens existentes.
-- Não compartilhe senhas, DATABASE_URL ou player_key em capturas públicas.

-- 1) Geração persistida (metadados técnicos, sem alterar dados).
SELECT meta_key, meta_value, updated_at
FROM mm_ranking_meta
WHERE meta_key IN ('ranking_generation','ranking_generation_before_v406982')
ORDER BY meta_key;

-- 2) Contagens históricas por modalidade e temporada.
SELECT m.season_id, m.mode,
       COUNT(DISTINCT m.match_id) AS partidas,
       COUNT(r.player_key) AS participacoes,
       COUNT(*) FILTER (WHERE r.won IS TRUE) AS vitorias_marcadas,
       MIN(m.finished_at) AS primeira_partida,
       MAX(m.finished_at) AS ultima_partida
FROM mm_matches AS m
LEFT JOIN mm_match_results AS r ON r.match_id=m.match_id
GROUP BY m.season_id,m.mode
ORDER BY m.season_id,m.mode;

-- 3) Totais consolidados para conferência antes/depois do deploy.
SELECT
  (SELECT COUNT(*) FROM mm_players) AS identidades,
  (SELECT COUNT(*) FROM mm_matches) AS partidas,
  (SELECT COUNT(*) FROM mm_match_results) AS resultados,
  (SELECT COUNT(*) FROM mm_match_results WHERE won IS TRUE) AS marcas_de_vitoria,
  (SELECT COUNT(*) FROM mm_seasons) AS temporadas;

-- 4) Integridade: partidas com resultado ausente ou campeão não registrado.
-- ATENÇÃO: isso não prova perda de vitória (p. ex. houve abandono e bot vencedor).
SELECT m.match_id, m.mode, m.finished_at,
       COUNT(r.player_key) AS participantes_gravados,
       COUNT(*) FILTER (WHERE r.won IS TRUE) AS campeoes_gravados
FROM mm_matches AS m
LEFT JOIN mm_match_results AS r ON r.match_id=m.match_id
GROUP BY m.match_id,m.mode,m.finished_at
HAVING COUNT(r.player_key)=0 OR COUNT(*) FILTER (WHERE r.won IS TRUE)=0
ORDER BY m.finished_at DESC
LIMIT 100;

-- 5) Contagem cronológica desde 8 de novembro para investigar período informado.
SELECT (m.finished_at AT TIME ZONE 'America/Porto_Velho')::date AS data_ro,
       m.mode, COUNT(DISTINCT m.match_id) AS partidas,
       COUNT(*) FILTER (WHERE r.won IS TRUE) AS vitorias
FROM mm_matches AS m
LEFT JOIN mm_match_results AS r ON r.match_id=m.match_id
WHERE m.finished_at >= TIMESTAMPTZ '2026-11-08 00:00:00-04'
GROUP BY 1,2 ORDER BY 1 DESC,2;
