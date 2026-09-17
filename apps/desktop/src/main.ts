import electron from "electron";
import path from "node:path";

const { app, BrowserWindow, ipcMain, Menu } = electron;
import {
  getAccountByRiotId,
  getSummonerByPuuid,
  getLeagueEntriesByPuuid,
  getRankedSoloMatchIds,
  getMatchById,
} from "@lol-draft-assistant/shared/src/riot.ts";

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
