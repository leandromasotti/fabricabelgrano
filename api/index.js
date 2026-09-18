// Punto de entrada para hosting serverless (Vercel).
//
// TODAS las URLs llegan acá con su path original intacto —/api/registros,
// /lecheria.html, /app/despacho— porque el rewrite de vercel.json apunta a un destino
// FIJO (/api) y el entorno le pasa a la función la URL que pidió el navegador.
//
// El primer intento usaba una catch-all [...ruta].js con destino /api/$1. Falló en
// silencio para todo lo que tuviera más de un segmento: /app/despacho reescribía a
// /api/app/despacho y eso ya no resolvía. Un destino de un solo segmento no tiene
// esa ambigüedad.
//
// Así el sistema entero —API, tablets, tablero y escritorio— pasa por el mismo Express
// que corre en la fábrica. No hay dos comportamientos que mantener sincronizados, y la
// clave de acceso protege todo por igual en vez de dejar el HTML abierto.
//
// El import es dinámico porque server/index.js abre el pool de la base al cargarse:
// hacerlo dentro del handler deja que el entorno reporte un error de conexión como un
// 500 normal en vez de matar la función al inicializarse.

let app

export default async function handler(req, res) {
  if (!app) ({ app } = await import('../server/index.js'))
  return app(req, res)
}
