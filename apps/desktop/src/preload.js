// Escrito en JS plano (no TS): el proceso de preload de Electron no puede
// crear los "worker threads" que tsx/esbuild necesitan para transformar
// TypeScript sobre la marcha (sí funciona en el proceso main, que sí los
// soporta). Como este archivo es pequeño, evitamos el problema entero
// escribiéndolo directamente en JS.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getPlayerProfile: (riotId) => ipcRenderer.invoke("get-player-profile", riotId),
});
