// Punto de entrada para hosting serverless (Vercel).
//
// El archivo se llama [...ruta].js —una "catch-all route"— para que TODAS las URLs
// lleguen acá con su path original intacto: /api/registros, /lecheria.html, /app/despacho.
// Con un `api/index.js` a secas, el entorno sólo enrutaría /api y Express vería un path
// que no es el que pidió el navegador.
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
