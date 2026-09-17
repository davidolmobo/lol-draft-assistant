import { db, processedMatches, laneMatchupStats, crawlQueue } from "@lol-draft-assistant/shared";
import { sql } from "drizzle-orm";
import { mkdirSync, writeFileSync } from "node:fs";

// toLocaleString("es-ES") depende de que Node tenga los datos ICU
// completos instalados, y no siempre es así en todos los entornos
// (se ha visto fallar de forma inconsistente en local). Un separador de
// miles manual es más fiable y no depende de eso.
function formatNumber(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// Genera una página HTML estática con el mismo estado que el panel de la
// app de escritorio (partidas recolectadas, partidas-jugador agregadas,
// progreso de la cola). Se publica en GitHub Pages para poder verla desde
// cualquier dispositivo, sin tener que abrir la app.
async function main() {
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

  const totalMatches = Number(matchesRow.count);
  const totalGames = Number(gamesRow.total);
  const queueDone = Number(queueRow.done);
  const queueTotal = Number(queueRow.total);
  const pct = queueTotal ? ((queueDone / queueTotal) * 100).toFixed(1) : "0";
  const updatedAt = new Date().toISOString();

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="120" />
  <title>lol-draft-assistant — estado</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0f1117; color: #e6e6e6; margin: 0; padding: 24px; }
    h1 { font-size: 1.2em; }
    .stat { font-size: 1.4em; margin: 12px 0; }
    .stat strong { color: #6fa8ff; }
    #queue-bar { margin-top: 6px; height: 10px; background: #2a2d38; border-radius: 5px; overflow: hidden; }
    #queue-bar-fill { height: 100%; width: ${pct}%; background: #3a6fd8; }
    .updated { color: #9a9a9a; font-size: 0.8em; margin-top: 20px; }
  </style>
</head>
<body>
  <h1>lol-draft-assistant — recolección de datos</h1>
  <div class="stat"><strong>${formatNumber(totalMatches)}</strong> partidas recolectadas</div>
  <div class="stat"><strong>${formatNumber(totalGames)}</strong> partidas-jugador agregadas</div>
  <div class="stat">Cola: <strong>${formatNumber(queueDone)}/${formatNumber(queueTotal)}</strong> jugadores (${pct}%)</div>
  <div id="queue-bar"><div id="queue-bar-fill"></div></div>
  <div class="updated">Actualizado: ${updatedAt} (se refresca sola cada 2 min)</div>
</body>
</html>
`;

  mkdirSync("status-dist", { recursive: true });
  writeFileSync("status-dist/index.html", html);
  console.log("Página de estado generada en status-dist/index.html");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
