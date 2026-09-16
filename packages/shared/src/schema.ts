import { pgTable, serial, integer, varchar, timestamp, unique, index } from "drizzle-orm/pg-core";

// Estadísticas agregadas de matchup: para cada parche + lane + campeón + rival,
// cuántas partidas se jugaron y cuántas se ganaron. No se guarda ninguna
// partida individual, solo el acumulado.
export const laneMatchupStats = pgTable(
  "lane_matchup_stats",
  {
    id: serial("id").primaryKey(),
    patch: varchar("patch", { length: 16 }).notNull(),
    lane: varchar("lane", { length: 16 }).notNull(),
    championId: integer("champion_id").notNull(),
    opponentChampionId: integer("opponent_champion_id").notNull(),
    games: integer("games").notNull().default(0),
    wins: integer("wins").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.patch, table.lane, table.championId, table.opponentChampionId),
  ],
);

// Cola de jugadores (PUUIDs) pendientes de rastrear. Arranca con jugadores
// semilla de league-v4, y se va alimentando con los PUUIDs que aparecen en
// cada partida procesada. `processedAt` nulo = todavía pendiente.
export const crawlQueue = pgTable(
  "crawl_queue",
  {
    id: serial("id").primaryKey(),
    puuid: varchar("puuid", { length: 100 }).notNull().unique(),
    enqueuedAt: timestamp("enqueued_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [index("crawl_queue_pending_idx").on(table.processedAt)],
);

// Registro de qué partidas ya se sumaron a lane_matchup_stats, para no
// contar la misma partida varias veces (una partida aparece en el
// historial de sus 10 participantes).
export const processedMatches = pgTable("processed_matches", {
  matchId: varchar("match_id", { length: 32 }).primaryKey(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});
