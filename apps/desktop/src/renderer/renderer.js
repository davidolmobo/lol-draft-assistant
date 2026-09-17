// Este archivo corre en el navegador (Chromium) dentro de la ventana, no
// en Node. Por eso es JS normal, sin imports de nuestro código: la única
// forma de hablar con Riot es a través de `window.api`, que expuso
// preload.ts.

const form = document.getElementById("search-form");
const input = document.getElementById("riot-id-input");
const status = document.getElementById("status");
const profileSection = document.getElementById("profile");
const summaryEl = document.getElementById("summary");
const matchesEl = document.getElementById("matches");

// Data Dragon es el CDN público de Riot con iconos/imágenes por parche.
// No necesita API key. Cogemos la versión más reciente una vez al cargar.
let ddragonVersion = "14.18.1"; // fallback por si falla la petición
fetch("https://ddragon.leagueoflegends.com/api/versions.json")
  .then((res) => res.json())
  .then((versions) => {
    ddragonVersion = versions[0];
  })
  .catch(() => {
    // Si falla, seguimos con el fallback; solo afecta a que los iconos
    // puedan no ser del parche más reciente.
  });

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const riotId = input.value.trim();
  if (!riotId.includes("#")) {
    status.textContent = 'Formato esperado: "nombre#tag"';
    return;
  }

  status.textContent = "Buscando...";
  profileSection.hidden = true;

  try {
    const profile = await window.api.getPlayerProfile(riotId);
    renderProfile(profile);
    status.textContent = "";
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
  }
});

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
