import electron from "electron";
import path from "node:path";
import fs from "node:fs";

const { app, BrowserWindow, ipcMain, Menu } = electron;
import {
  getAccountByRiotId,
  getSummonerByPuuid,
  getLeagueEntriesByPuuid,
  getRankedSoloMatchIds,
  getMatchById,
  db,
  laneMatchupStats,
  processedMatches,
  crawlQueue,
} from "@lol-draft-assistant/shared";
import { sql, eq } from "drizzle-orm";

function createWindow() {
  const win = new BrowserWindow({
    width: 480,
    height: 720,
    webPreferences: {
      // contextIsolation + preload es la forma segura de dar a la página
      // (renderer) acceso a funciones concretas, sin exponerle Node.js
      // ni la API key directamente.
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error("Error cargando el preload", preloadPath, error);
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

// --- Configuración persistente (ej. el último Riot ID buscado) ---
// Se guarda como JSON en la carpeta de datos de la app (fuera del
// proyecto), no en el código ni en git.
const settingsPath = path.join(app.getPath("userData"), "settings.json");

function readSettings(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  } catch {
    return {};
  }
}

function writeSettings(settings: Record<string, unknown>) {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

ipcMain.handle("get-settings", () => readSettings());
ipcMain.handle("save-settings", (_event: unknown, settings: Record<string, unknown>) => {
  writeSettings({ ...readSettings(), ...settings });
});

Menu.setApplicationMenu(null);
app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Toda llamada a la Riot API vive aquí, en el proceso main (donde está la
// API key). El renderer nunca la ve: solo pide "get-player-profile" por
// IPC y recibe el resultado ya construido.
ipcMain.handle("get-player-profile", async (_event: unknown, riotId: string) => {
  const [gameName, tagLine] = riotId.split("#").map((s) => s.trim());
  if (!gameName || !tagLine) {
    throw new Error('Formato esperado: "nombre#tag"');
  }

  const account = await getAccountByRiotId(gameName, tagLine);

  const [summoner, leagueEntries, matchIds] = await Promise.all([
    getSummonerByPuuid(account.puuid),
    getLeagueEntriesByPuuid(account.puuid),
    getRankedSoloMatchIds(account.puuid, 10),
  ]);

  const matches = await Promise.all(matchIds.map((matchId) => getMatchById(matchId)));
  const recentMatches = matches.map((match) => {
    const me = match.info.participants.find((p) => p.puuid === account.puuid)!;
    return {
      championName: me.championName,
      win: me.win,
      kills: me.kills,
      deaths: me.deaths,
      assists: me.assists,
      lane: me.teamPosition,
    };
  });

  const soloQueue = leagueEntries.find((entry) => entry.queueType === "RANKED_SOLO_5x5") ?? null;

  return {
    gameName: account.gameName,
    tagLine: account.tagLine,
    profileIconId: summoner.profileIconId,
    summonerLevel: summoner.summonerLevel,
    soloQueue,
    recentMatches,
  };
});

// Boceto de tier list: suma lane_matchup_stats por campeón+lane (todos los
// rivales juntos) para sacar un winrate general. MIN_GAMES filtra
// combinaciones con muy pocas partidas, que con tan poco volumen todavía
// serían solo ruido (100% con 1 partida no dice nada).
const MIN_GAMES_FOR_TIER_LIST = 15;
// Techo generoso: en la práctica nunca hay más de ~70-100 campeones
// jugando el mismo rol, así que esto nunca debería recortar de verdad.
const TIER_LIST_LIMIT = 150;

ipcMain.handle("get-tier-list", async (_event: unknown, lane: string) => {
  const rows = await db
    .select({
      championId: laneMatchupStats.championId,
      games: sql<number>`sum(${laneMatchupStats.games})`,
      wins: sql<number>`sum(${laneMatchupStats.wins})`,
    })
    .from(laneMatchupStats)
    .where(eq(laneMatchupStats.lane, lane))
    .groupBy(laneMatchupStats.championId)
    .having(sql`sum(${laneMatchupStats.games}) >= ${MIN_GAMES_FOR_TIER_LIST}`)
    .limit(TIER_LIST_LIMIT);

  // Ordenar por winrate puro castiga a los campeones con muchas partidas:
  // uno con 55% en 500 partidas es un dato mucho más fiable que uno con
  // 100% en 3, pero un sort ingenuo pondría el segundo primero. El límite
  // inferior de Wilson (mismo truco que usa Reddit para ordenar
  // comentarios) "desconfía" de las muestras pequeñas y las empuja hacia
  // abajo hasta que hay suficientes partidas para confiar en el número —
  // así se parece más a cómo ordena OP.GG.
  const scored = rows.map((row) => {
    const games = Number(row.games);
    const wins = Number(row.wins);
    return {
      championId: row.championId,
      games,
      wins,
      winRate: wins / games,
      score: wilsonLowerBound(wins, games),
    };
  });
  scored.sort((a, b) => b.score - a.score);

  return scored;
});

// z=1.96 corresponde a un intervalo de confianza del 95%.
function wilsonLowerBound(wins: number, games: number, z = 1.96): number {
  if (games === 0) return 0;
  const p = wins / games;
  const denominator = 1 + (z * z) / games;
  const centre = p + (z * z) / (2 * games);
  const margin = z * Math.sqrt((p * (1 - p)) / games + (z * z) / (4 * games * games));
  return (centre - margin) / denominator;
}

// Panel de estado: para ver de un vistazo si el recolector (el cron de
// GitHub Actions) sigue metiendo partidas nuevas, sin tener que consultar
// la base de datos a mano.
ipcMain.handle("get-collection-stats", async () => {
  const [[matchesRow], [gamesRow], [queueRow]] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(processedMatches),
    db.select({ total: sql<number>`coalesce(sum(${laneMatchupStats.games}), 0)` }).from(laneMatchupStats),
    db
      .select({
        total: sql<number>`count(*)`,
        done: sql<number>`count(*) filter (where ${crawlQueue.processedAt} is not null)`,
      })
      .from(crawlQueue),
  ]);

  return {
    totalMatches: Number(matchesRow.count),
    totalGames: Number(gamesRow.total),
    queueDone: Number(queueRow.done),
    queueTotal: Number(queueRow.total),
  };
});
