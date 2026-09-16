import "./env.js";

const RIOT_API_KEY = process.env.RIOT_API_KEY;
if (!RIOT_API_KEY) {
  throw new Error("RIOT_API_KEY is not set (check packages/shared/.env)");
}

// EUW: platform routing para league-v4 (ligas/rangos),
// regional routing para match-v5 (partidas). Riot separa estos dos
// sistemas de enrutado; hardcodeado a EUW porque es donde juega el usuario.
const PLATFORM_HOST = "https://euw1.api.riotgames.com";
const REGIONAL_HOST = "https://europe.api.riotgames.com";

const RANKED_SOLO_QUEUE_ID = 420;

// La app tiene rate limit de 20 peticiones/segundo y 100 cada 2 minutos
// (verificado en el developer portal). Este limitador espacia las llamadas
// para no superar ninguna de las dos ventanas, en vez de lanzarlas todas
// de golpe y recibir errores 429.
class RateLimiter {
  private timestamps: number[] = [];

  constructor(private limits: { windowMs: number; max: number }[]) {}

  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();
      const maxWindow = Math.max(...this.limits.map((l) => l.windowMs));
      this.timestamps = this.timestamps.filter((t) => now - t < maxWindow);

      const blocking = this.limits.find(
        (limit) => this.timestamps.filter((t) => now - t < limit.windowMs).length >= limit.max,
      );

      if (!blocking) {
        this.timestamps.push(now);
        return;
      }

      const relevant = this.timestamps
        .filter((t) => now - t < blocking.windowMs)
        .sort((a, b) => a - b);
      const waitMs = blocking.windowMs - (now - relevant[0]) + 20;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

const rateLimiter = new RateLimiter([
  { windowMs: 1_000, max: 20 },
  { windowMs: 120_000, max: 100 },
]);

async function riotFetch<T>(url: string): Promise<T> {
  await rateLimiter.acquire();

  const res = await fetch(url, { headers: { "X-Riot-Token": RIOT_API_KEY! } });

  // 429 = nos hemos pasado del rate limit igualmente (ej. por llamadas
  // concurrentes de otra fuente). Riot dice cuánto esperar en este header.
  if (res.status === 429) {
    const retryAfterSeconds = Number(res.headers.get("retry-after") ?? "1");
    await new Promise((resolve) => setTimeout(resolve, (retryAfterSeconds + 1) * 1000));
    return riotFetch<T>(url);
  }

  if (!res.ok) {
    throw new Error(`Riot API error ${res.status} on ${url}`);
  }

  return res.json() as Promise<T>;
}

export interface LeagueEntry {
  puuid: string;
}

interface LeagueListDto {
  entries: LeagueEntry[];
}

export function getChallengerLeague() {
  return riotFetch<LeagueListDto>(
    `${PLATFORM_HOST}/lol/league/v4/challengerleagues/by-queue/RANKED_SOLO_5x5`,
  );
}

export function getGrandmasterLeague() {
  return riotFetch<LeagueListDto>(
    `${PLATFORM_HOST}/lol/league/v4/grandmasterleagues/by-queue/RANKED_SOLO_5x5`,
  );
}

export function getMasterLeague() {
  return riotFetch<LeagueListDto>(
    `${PLATFORM_HOST}/lol/league/v4/masterleagues/by-queue/RANKED_SOLO_5x5`,
  );
}

// Esmeralda y Diamante no tienen un único endpoint como los rangos apex:
// hay que pedir por división (I-IV) y página. Cada página trae hasta ~205
// jugadores.
export type SubApexTier = "EMERALD" | "DIAMOND";
export type Division = "I" | "II" | "III" | "IV";

export function getTierEntries(tier: SubApexTier, division: Division, page = 1) {
  return riotFetch<LeagueEntry[]>(
    `${PLATFORM_HOST}/lol/league/v4/entries/RANKED_SOLO_5x5/${tier}/${division}?page=${page}`,
  );
}

export function getRankedSoloMatchIds(puuid: string, count = 20) {
  return riotFetch<string[]>(
    `${REGIONAL_HOST}/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=${RANKED_SOLO_QUEUE_ID}&start=0&count=${count}`,
  );
}

export interface MatchParticipant {
  puuid: string;
  championId: number;
  teamId: number;
  teamPosition: "TOP" | "JUNGLE" | "MIDDLE" | "BOTTOM" | "UTILITY" | "";
  win: boolean;
}

export interface MatchDto {
  metadata: { matchId: string };
  info: {
    gameVersion: string;
    queueId: number;
    participants: MatchParticipant[];
  };
}

export function getMatchById(matchId: string) {
  return riotFetch<MatchDto>(`${REGIONAL_HOST}/lol/match/v5/matches/${matchId}`);
}

// Riot devuelve la versión completa del cliente, ej. "14.18.567.1234".
// El "parche" que nos interesa para agregar stats es solo "14.18".
export function toPatch(gameVersion: string): string {
  const [major, minor] = gameVersion.split(".");
  return `${major}.${minor}`;
}
