-- =============================================================================
-- v2.0.0 — read-only check that every v2.0.0 migration has landed
-- =============================================================================
-- Changes nothing. Run it before the migrations (expect MISSING rows) and after
-- them (expect every row to say ok):
--
--   ssh hetzner "docker exec -i a8ws9g5d9w9j1rhz2lfx73k2 psql -U postgres -d postgres" \
--     < db/migrations/verify-v2.0.0.sql
--
-- See docs/infrastructure/V2_LAUNCH_CHECKLIST.md for the full procedure.
-- =============================================================================

WITH expected_columns(migration, table_name, column_name) AS (
  VALUES
    ('epic14', 'game_states',         'stocks_sold_this_turn'),
    ('epic14', 'game_states',         'chains_bought_this_turn'),
    ('epic15', 'game_rooms',          'host_user_id'),
    ('epic15', 'game_rooms',          'turn_order_mode'),
    ('epic16', 'game_results',        'source_room_id'),
    ('epic16', 'game_result_players', 'result_id'),
    ('epic18', 'game_states',         'end_declared_by'),
    ('epic18', 'game_states',         'end_condition_round'),
    ('epic18', 'game_states_public',  'end_declared_by'),
    ('epic17', 'game_players',        'power_cards'),
    ('epic17', 'game_states',         'active_power_card'),
    ('epic17', 'game_states',         'tiles_placed_this_turn'),
    ('epic17', 'game_players_public', 'power_cards'),
    ('epic17', 'game_states_public',  'tile_bag_count'),
    ('epic17', 'game_states_public',  'stocks_sold_this_turn')
),
column_checks AS (
  SELECT e.migration,
         e.table_name || '.' || e.column_name AS item,
         CASE WHEN c.column_name IS NULL THEN 'MISSING' ELSE 'ok' END AS status
    FROM expected_columns e
    LEFT JOIN information_schema.columns c
           ON c.table_schema = 'public'
          AND c.table_name = e.table_name
          AND c.column_name = e.column_name
),
other_checks AS (
  -- Epic 18 widens Epic 16's constraint; without 'declared' every finished
  -- game's statistics row is silently lost.
  SELECT 'epic18' AS migration,
         'game_results.valid_end_reason allows declared' AS item,
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_constraint
            WHERE conname = 'valid_end_reason'
              AND pg_get_constraintdef(oid) LIKE '%declared%'
         ) THEN 'ok' ELSE 'MISSING' END AS status
  UNION ALL
  -- Epic 15 backfills the host from seat 0; rooms with players but no host
  -- would leave nobody able to start or edit them.
  SELECT 'epic15',
         'every room with players has a host',
         CASE
           WHEN NOT EXISTS (
             SELECT 1 FROM information_schema.columns
              WHERE table_name = 'game_rooms' AND column_name = 'host_user_id'
           ) THEN 'MISSING'
           WHEN EXISTS (
             SELECT 1 FROM game_rooms gr
              WHERE gr.status IN ('waiting', 'playing')
                AND (to_jsonb(gr) ->> 'host_user_id') IS NULL
                AND EXISTS (SELECT 1 FROM game_players gp
                             WHERE gp.room_id = gr.id AND gp.user_id IS NOT NULL)
           ) THEN 'CHECK: re-run the epic15 file'
           ELSE 'ok'
         END
)
SELECT migration, item, status FROM column_checks
UNION ALL
SELECT migration, item, status FROM other_checks
ORDER BY status DESC, migration, item;
