import {
  db,
  crawlQueue,
  processedMatches,
  laneMatchupStats,
  getRankedSoloMatchIds,
  getMatchById,
  toPatch,
  type MatchDto,
} from "@lol-draft-assistant/shared";
import { eq, isNull, asc, inArray, sql } from "drizzle-orm";

// Presupuesto de tiempo por ejecución. GitHub Actions mataría el job si nos
// pasamos de su propio timeout; paramos antes por nuestra cuenta para que
// el estado en la BD (crawl_queue / processed_matches) quede siempre
// consistente en vez de cortado a mitad de una partida.
//
// El límite real de velocidad es el rate limit de Riot (100 peticiones/2min),
// no la frecuencia con la que arranca este script. Por eso interesa que
// cada ejecución dure mucho (satura ese límite un buen rato) en vez de
// lanzar muchas ejecuciones cortas: así hace falta que el cron de GitHub
// acierte con mucha menos frecuencia, que es donde está el punto débil
// real (ver .github/workflows/collect.yml).
const RUNTIME_BUDGET_MS = 25 * 60 * 1000;
const MATCHES_PER_PLAYER = 20;

const deadline = Date.now() + RUNTIME_BUDGET_MS;
const timeLeft = () => deadline - Date.now();

async function main() {
  let playersProcessed = 0;
  let matchesProcessed = 0;

  while (timeLeft() > 0) {
    const [player] = await db
      .select()
      .from(crawlQueue)
      .where(isNull(crawlQueue.processedAt))
      .orderBy(asc(crawlQueue.enqueuedAt))
      .limit(1);

    if (!player) {
      console.log("Cola vacía, nada más que procesar.");
      break;
    }

    matchesProcessed += await processPlayer(player.puuid);
    await db.update(crawlQueue).set({ processedAt: new Date() }).where(eq(crawlQueue.id, player.id));
    playersProcessed++;

    if (playersProcessed % 20 === 0) {
      console.log(`... ${playersProcessed} jugadores, ${matchesProcessed} partidas nuevas`);
    }
  }

  console.log(`Terminado: ${playersProcessed} jugadores procesados, ${matchesProcessed} partidas nuevas.`);
  process.exit(0);
}

async function processPlayer(puuid: string): Promise<number> {
  let matchIds: string[];
  try {
    matchIds = await getRankedSoloMatchIds(puuid, MATCHES_PER_PLAYER);
  } catch (err) {
    console.error(`Error obteniendo partidas de ${puuid}:`, (err as Error).message);
    return 0;
  }
  if (matchIds.length === 0) return 0;

  // Un solo viaje a la BD para saber cuáles de estas partidas ya
  // conocíamos, en vez de una consulta por partida.
  const existing = await db
    .select({ matchId: processedMatches.matchId })
    .from(processedMatches)
    .where(inArray(processedMatches.matchId, matchIds));
  const alreadyKnown = new Set(existing.map((row) => row.matchId));
  const newMatchIds = matchIds.filter((id) => !alreadyKnown.has(id));
  if (newMatchIds.length === 0) return 0;

  const matches: MatchDto[] = [];
  for (const matchId of newMatchIds) {
    if (timeLeft() <= 0) break;
    try {
      matches.push(await getMatchById(matchId));
    } catch (err) {
      console.error(`Error obteniendo partida ${matchId}:`, (err as Error).message);
    }
  }
  if (matches.length === 0) return 0;

  await saveMatches(matches);
  return matches.length;
}

interface MatchupTotal {
  patch: string;
  lane: "TOP" | "JUNGLE" | "MIDDLE" | "BOTTOM" | "UTILITY";
  championId: number;
  opponentChampionId: number;
  games: number;
  wins: number;
}

// Antes esto escribía partida por partida (~13 consultas a la BD por
// cada una). Ahora junta TODAS las partidas nuevas encontradas para este
// jugador y las manda en un puñado fijo de consultas (4 en total, sin
// importar si son 1 o 20 partidas), reduciendo mucho el tiempo perdido en
// idas y vueltas de red hacia Neon.
async function saveMatches(matches: MatchDto[]) {
  // Varias partidas pueden aportar al mismo matchup (mismo campeón, lane,
  // rival y parche): se suman en memoria antes de tocar la BD, para que
  // el upsert final sea una sola fila por combinación, no una por partida.
  const matchupTotals = new Map<string, MatchupTotal>();
  const newPuuids = new Set<string>();

  for (const match of matches) {
    const patch = toPatch(match.info.gameVersion);
    const participants = match.info.participants.filter((p) => p.teamPosition);

    for (const participant of participants) {
      newPuuids.add(participant.puuid);

      const opponent = participants.find(
        (other) => other.teamId !== participant.teamId && other.teamPosition === participant.teamPosition,
      );
      if (!opponent) continue;

      const key = `${patch}|${participant.teamPosition}|${participant.championId}|${opponent.championId}`;
      const totals = matchupTotals.get(key);
      if (totals) {
        totals.games += 1;
        totals.wins += participant.win ? 1 : 0;
      } else {
        matchupTotals.set(key, {
          patch,
          lane: participant.teamPosition,
          championId: participant.championId,
          opponentChampionId: opponent.championId,
          games: 1,
          wins: participant.win ? 1 : 0,
        });
      }
    }
  }

  await db
    .insert(processedMatches)
    .values(matches.map((m) => ({ matchId: m.metadata.matchId })))
    .onConflictDoNothing();

  await db
    .insert(crawlQueue)
    .values([...newPuuids].map((puuid) => ({ puuid })))
    .onConflictDoNothing();

  const matchupRows = [...matchupTotals.values()];
  if (matchupRows.length > 0) {
    // "excluded" es la fila que se intentó insertar (la de este lote); al
    // ser un solo INSERT con varias filas, cada conflicto suma su propio
    // valor a lo que ya hubiera en la tabla.
    await db
      .insert(laneMatchupStats)
      .values(matchupRows)
      .onConflictDoUpdate({
        target: [
          laneMatchupStats.patch,
          laneMatchupStats.lane,
          laneMatchupStats.championId,
          laneMatchupStats.opponentChampionId,
        ],
        set: {
          games: sql`${laneMatchupStats.games} + excluded.games`,
          wins: sql`${laneMatchupStats.wins} + excluded.wins`,
          updatedAt: new Date(),
        },
      });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
