import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Carga siempre packages/shared/.env por ruta absoluta, sin importar desde
// qué carpeta (apps/worker, apps/desktop, la raíz...) se lance el proceso.
const here = dirname(fileURLToPath(import.meta.url));
config({ path: join(here, "..", ".env") });
