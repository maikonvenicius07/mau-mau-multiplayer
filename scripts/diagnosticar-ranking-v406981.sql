-- MAU-MAU CANDEIAS V40.69.8.1 - DIAGNOSTICO DO RANKING (SOMENTE SELECT)
-- Executar somente no PostgreSQL do projeto autorizado (Render).
-- Nenhum comando altera tabelas, pontuacoes, usuarios ou temporadas.
-- Nao compartilhe DATABASE_URL, senha, token nem player_key completo.

-- 1) Partidas completas ja GRAVADAS por dia e modalidade, em horario de Rondonia.
SELECT (m.finished_at AT TIME ZONE 'America/Porto_Velho')::date AS dia_ro,
       m.mode AS modalidade,
       COUNT(DISTINCT m.match_id) AS partidas_gravadas,
       COUNT(r.player_key) FILTER (WHERE r.won IS TRUE) AS vitorias_registradas,
       COUNT(r.player_key) AS resultados_de_jogadores
FROM mm_matches AS m
LEFT JOIN mm_match_results AS r ON r.match_id = m.match_id
WHERE m.finished_at >= TIMESTAMPTZ '2026-11-08 00:00:00-04'
GROUP BY 1,2 ORDER BY 1 DESC,2;

-- 2) Ultima partida gravada por modalidade (independente de HOJE/SEMANA).
SELECT m.mode,MAX(m.finished_at AT TIME ZONE 'America/Porto_Velho') AS ultima_partida_hora_ro,
       COUNT(*) AS partidas_gravadas
FROM mm_matches m
WHERE m.season_id=1
GROUP BY m.mode ORDER BY m.mode;

-- 3) Partidas existentes no banco sem resultado de vitoria humana (sinal para auditoria).
-- Uma partida de treino com vitoria da Maquina pode legitimamente ter zero humanos vencedores.
SELECT m.match_id, m.room_code, m.mode,
       m.finished_at AT TIME ZONE 'America/Porto_Velho' AS terminou_hora_ro,
       COUNT(r.player_key) AS jogadores_registrados,
       COUNT(r.player_key) FILTER (WHERE r.won IS TRUE) AS vitorias_humanas
FROM mm_matches m
LEFT JOIN mm_match_results r ON r.match_id=m.match_id
WHERE m.finished_at>=TIMESTAMPTZ '2026-11-08 00:00:00-04'
GROUP BY m.match_id,m.room_code,m.mode,m.finished_at
HAVING COUNT(r.player_key)=0 OR COUNT(r.player_key) FILTER (WHERE r.won IS TRUE)=0
ORDER BY m.finished_at DESC;

-- 4) Snapshots finais ainda pendentes de ranking. A ausencia NAO comprova que
-- nao houve perda: snapshots antigos podem ter sido excluidos ou expirado (TTL).
SELECT s.room_code,
       s.updated_at AT TIME ZONE 'America/Porto_Velho' AS atualizado_hora_ro,
       s.expires_at AT TIME ZONE 'America/Porto_Velho' AS expira_hora_ro,
       COALESCE(s.snapshot #>> '{pendingRankingRecord,matchId}',
                s.room_code||'-'||(s.snapshot->>'createdAt')||'-'||COALESCE(s.snapshot->>'matchSerial','1')) AS match_id_calculado,
       EXISTS (SELECT 1 FROM mm_matches m
         WHERE m.match_id=COALESCE(s.snapshot #>> '{pendingRankingRecord,matchId}',
                        s.room_code||'-'||(s.snapshot->>'createdAt')||'-'||COALESCE(s.snapshot->>'matchSerial','1'))
       ) AS ja_existe_no_ranking
FROM mm_room_snapshots s
WHERE s.status='finished' AND COALESCE(s.snapshot->>'rankingRecorded','false')='false'
ORDER BY s.updated_at DESC;

-- 5) Geracao atual; nao executar DELETE/UPDATE para alterar a temporada.
SELECT meta_key,meta_value,updated_at
FROM mm_ranking_meta WHERE meta_key='ranking_generation';
