import {
  db,
  crawlQueue,
  getChallengerLeague,
  getGrandmasterLeague,
  getMasterLeague,
  getTierEntries,
  type Division,
} from "@lol-draft-assistant/shared";

const DIVISIONS: Division[] = ["I", "II", "III", "IV"];

// Siembra inicial de la cola: los rangos apex (Challenger/GM/Master) traen
// todos sus jugadores en una sola llamada. Esmeralda y Diamante hay que
// pedirlos división por división; de momento solo la página 1 de cada
// división (~200 jugadores por división), suficiente para arrancar el
// encadenado por partidas.
async function main() {
  const puuids = new Set<string>();

  const [challenger, grandmaster, master] = await Promise.all([
    getChallengerLeague(),
    getGrandmasterLeague(),
    getMasterLeague(),
  ]);
  for (const entry of [...challenger.entries, ...grandmaster.entries, ...master.entries]) {
    puuids.add(entry.puuid);
  }

  for (const tier of ["DIAMOND", "EMERALD"] as const) {
    for (const division of DIVISIONS) {
      const entries = await getTierEntries(tier, division, 1);
      for (const entry of entries) puuids.add(entry.puuid);
      console.log(`${tier} ${division}: ${entries.length} jugadores`);
    }
  }

  console.log(`Total de PUUIDs únicos a encolar: ${puuids.size}`);

  // Insertar de una en una fila sería miles de viajes de ida y vuelta a
  // Neon (lentísimo). En su lugar, se insertan en lotes de 500 filas por
  // consulta.
  const puuidList = [...puuids];
  const BATCH_SIZE = 500;
  for (let i = 0; i < puuidList.length; i += BATCH_SIZE) {
    const batch = puuidList.slice(i, i + BATCH_SIZE).map((puuid) => ({ puuid }));
    await db.insert(crawlQueue).values(batch).onConflictDoNothing();
    console.log(`Insertados ${Math.min(i + BATCH_SIZE, puuidList.length)}/${puuidList.length}`);
  }

  console.log("Cola sembrada.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
