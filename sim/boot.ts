// =============================================================================
// boot — must be the first import of every sim entry point
// =============================================================================
// server/lib/db.ts logs a warning at module load when DATABASE_URL is unset, and
// module initialisation runs before any statement in the entry file — so there
// is no way to silence it from inside main(). Setting a placeholder here, in a
// module imported ahead of the engine, keeps that one line out of a run's
// output. Nothing ever connects: the simulator installs an in-memory backend
// over the pool before the first query.
// =============================================================================

process.env.DATABASE_URL ??= 'postgres://simulator/offline';
