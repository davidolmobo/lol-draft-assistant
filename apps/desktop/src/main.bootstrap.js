// Electron necesita un punto de entrada en JS plano. Este archivo solo
// activa el soporte de TypeScript (el mismo que usa el worker) y le pasa
// el control al main.ts real, que es donde está toda la lógica.
require("tsx/cjs");
require("./main.ts");
