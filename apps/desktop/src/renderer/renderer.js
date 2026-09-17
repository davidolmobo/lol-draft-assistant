// Este archivo corre en el navegador (Chromium) dentro de la ventana, no
// en Node. Por eso es JS normal, sin imports de nuestro código: la única
// forma de hablar con Riot (o con nuestra base de datos) es a través de
// `window.api`, que expuso preload.js.

const form = document.getElementById("search-form");
const input = document.getElementById("riot-id-input");
const status = document.getElementById("status");
const profileSection = document.getElementById("profile");
const summaryEl = document.getElementById("summary");
const matchesEl = document.getElementById("matches");
const laneTabs = document.getElementById("lane-tabs");
const tierListPatchEl = document.getElementById("tier-list-patch");
const tierListEl = document.getElementById("tier-list");
const collectionStatsEl = document.getElementById("collection-stats");
const queueBarFillEl = document.getElementById("queue-bar-fill");

// Panel de estado del recolector: para comprobar de un vistazo que el
// cron de GitHub Actions sigue metiendo partidas nuevas, sin tener que
// preguntar. Se refresca solo mientras la ventana esté abierta.
async function refreshCollectionStats() {
  try {
    const stats = await window.api.getCollectionStats();
    const pct = stats.queueTotal ? ((stats.queueDone / stats.queueTotal) * 100).toFixed(1) : "0";
    collectionStatsEl.innerHTML = `
      <strong>${stats.totalMatches.toLocaleString("es-ES")}</strong> partidas recolectadas ·
      <strong>${stats.totalGames.toLocaleString("es-ES")}</strong> partidas-jugador agregadas ·
      cola: ${stats.queueDone.toLocaleString("es-ES")}/${stats.queueTotal.toLocaleString("es-ES")} jugadores (${pct}%)
    `;
    queueBarFillEl.style.width = `${pct}%`;
  } catch (err) {
    collectionStatsEl.textContent = `No se pudo cargar el estado: ${err.message}`;
  }
}

refreshCollectionStats();
setInterval(refreshCollectionStats, 15_000);

document.getElementById("refresh-stats").addEventListener("click", refreshCollectionStats);

// Data Dragon es el CDN público de Riot con iconos/imágenes por parche.
// No necesita API key. Cogemos la versión más reciente una vez al cargar.
let ddragonVersion = "14.18.1"; // fallback por si falla la petición
const ddragonReady = fetch("https://ddragon.leagueoflegends.com/api/versions.json")
  .then((res) => res.json())
  .then((versions) => {
    ddragonVersion = versions[0];
  })
  .catch(() => {
    // Si falla, seguimos con el fallback; solo afecta a que los iconos
    // puedan no ser del parche más reciente.
  });

// lane_matchup_stats solo guarda el ID numérico del campeón (el que usa
// la Riot API). Data Dragon usa un nombre interno (ej. 103 -> "Ahri")
// tanto para el nombre a mostrar como para la URL del icono, así que
// construimos ese mapa una vez.
let championsById = new Map();
const championsReady = ddragonReady.then(() =>
  fetch(`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/data/en_US/champion.json`)
    .then((res) => res.json())
    .then((data) => {
      championsById = new Map(
        Object.values(data.data).map((champ) => [Number(champ.key), champ]),
      );
    })
    .catch(() => {
      // Si falla, la tier list sigue funcionando, solo mostrará el ID
      // numérico en vez del nombre.
    }),
);

// Recordar el Riot ID: al abrir la app, si hay uno guardado, se rellena
// el campo y se busca automáticamente sin que el usuario tenga que
// volver a escribirlo.
window.api.getSettings().then((settings) => {
  if (settings.riotId) {
    input.value = settings.riotId;
    searchProfile(settings.riotId);
  }
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  searchProfile(input.value.trim());
});

async function searchProfile(riotId) {
  if (!riotId || !riotId.includes("#")) {
    status.textContent = 'Formato esperado: "nombre#tag"';
    return;
  }

  status.textContent = "Buscando...";
  profileSection.hidden = true;

  try {
    const profile = await window.api.getPlayerProfile(riotId);
    await ddragonReady;
    renderProfile(profile);
    status.textContent = "";
    window.api.saveSettings({ riotId });
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
  }
}

function renderProfile(profile) {
  const iconUrl = `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/profileicon/${profile.profileIconId}.png`;

  const rankText = profile.soloQueue
    ? `${profile.soloQueue.tier} ${profile.soloQueue.rank} (${profile.soloQueue.leaguePoints} LP) — ${profile.soloQueue.wins}V ${profile.soloQueue.losses}D`
    : "Sin rango en Solo/Duo";

  summaryEl.innerHTML = `
    <img src="${iconUrl}" alt="icono de perfil" width="64" height="64" />
    <div>
      <strong>${profile.gameName}#${profile.tagLine}</strong>
      <div>Nivel ${profile.summonerLevel}</div>
      <div>${rankText}</div>
    </div>
  `;

  matchesEl.innerHTML = "";
  for (const match of profile.recentMatches) {
    const championIconUrl = `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/champion/${match.championName}.png`;
    const li = document.createElement("li");
    li.className = match.win ? "win" : "loss";
    li.innerHTML = `
      <img src="${championIconUrl}" alt="${match.championName}" width="32" height="32" />
      <span>${match.championName} (${match.lane || "?"})</span>
      <span>${match.kills}/${match.deaths}/${match.assists}</span>
      <span>${match.win ? "Victoria" : "Derrota"}</span>
    `;
    matchesEl.appendChild(li);
  }

  profileSection.hidden = false;
}

laneTabs.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-lane]");
  if (!button) return;

  for (const tab of laneTabs.querySelectorAll("button")) {
    tab.classList.toggle("active", tab === button);
  }

  // En vez de vaciar la lista y volver a llenarla (lo que colapsa y
  // expande el layout de golpe, dando sensación de parpadeo), la dejamos
  // visible pero atenuada mientras carga la nueva.
  tierListEl.classList.add("loading");
  try {
    const { patch, rows } = await window.api.getTierList(button.dataset.lane);
    await championsReady;
    tierListPatchEl.textContent = patch ? `Parche ${patch}` : "";
    renderTierList(rows);
  } catch (err) {
    tierListEl.innerHTML = `<li>Error: ${err.message}</li>`;
  } finally {
    tierListEl.classList.remove("loading");
  }
});

function renderTierList(rows) {
  tierListEl.innerHTML = "";
  for (const row of rows) {
    const champ = championsById.get(row.championId);
    const name = champ ? champ.name : `ID ${row.championId}`;
    const iconUrl = champ
      ? `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/champion/${champ.id}.png`
      : "";

    const li = document.createElement("li");
    li.innerHTML = `
      ${iconUrl ? `<img src="${iconUrl}" alt="${name}" width="28" height="28" />` : ""}
      <span>${name}</span>
      <span>${(row.winRate * 100).toFixed(1)}%</span>
      <span class="hint">${row.wins}/${row.games} partidas</span>
    `;
    tierListEl.appendChild(li);
  }
}
