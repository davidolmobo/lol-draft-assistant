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
import { eq, isNull, asc, sql } from "drizzle-orm";

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

  let processedCount = 0;

  for (const matchId of matchIds) {
    if (timeLeft() <= 0) break;

    const [existing] = await db
      .select({ matchId: processedMatches.matchId })
      .from(processedMatches)
      .where(eq(processedMatches.matchId, matchId));
    if (existing) continue;

    let match: MatchDto;
    try {
      match = await getMatchById(matchId);
    } catch (err) {
      console.error(`Error obteniendo partida ${matchId}:`, (err as Error).message);
      continue;
    }

    await recordMatch(match);
    await db.insert(processedMatches).values({ matchId }).onConflictDoNothing();

    const newPuuids = match.info.participants.map((p) => ({ puuid: p.puuid }));
    await db.insert(crawlQueue).values(newPuuids).onConflictDoNothing();

    processedCount++;
  }

  return processedCount;
}

async function recordMatch(match: MatchDto) {
  const patch = toPatch(match.info.gameVersion);
  // Filtra participantes sin lane asignada (partidas raras, remakes, etc).
  const participants = match.info.participants.filter((p) => p.teamPosition);

  for (const participant of participants) {
    const opponent = participants.find(
      (other) => other.teamId !== participant.teamId && other.teamPosition === participant.teamPosition,
    );
    if (!opponent) continue;

    await db
      .insert(laneMatchupStats)
      .values({
        patch,
        lane: participant.teamPosition,
        championId: participant.championId,
        opponentChampionId: opponent.championId,
        games: 1,
        wins: participant.win ? 1 : 0,
      })
      .onConflictDoUpdate({
        target: [
          laneMatchupStats.patch,
          laneMatchupStats.lane,
          laneMatchupStats.championId,
          laneMatchupStats.opponentChampionId,
        ],
        set: {
          games: sql`${laneMatchupStats.games} + 1`,
          wins: sql`${laneMatchupStats.wins} + ${participant.win ? 1 : 0}`,
          updatedAt: new Date(),
        },
      });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
