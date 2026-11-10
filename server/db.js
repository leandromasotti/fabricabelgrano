// Elige el motor de base de datos.
//
//   DATABASE_URL definida  -> PostgreSQL (local en Docker, o Supabase)
//   sin DATABASE_URL       -> SQLite, como hasta ahora
//
// Los dos exponen la MISMA API asíncrona, así que index.js no sabe cuál está usando.
// Eso permite volver a SQLite con una variable de entorno si algo falla en producción,
// que es exactamente lo que uno quiere tener a mano el día que algo falla.

const usarPostgres = Boolean(process.env.DATABASE_URL)

// better-sqlite3 es una dependencia OPCIONAL (ver el comentario en package.json): se
// compila para cada versión de Node y en la nube no se usa nunca. Si falta y además no hay
// DATABASE_URL, el sistema se queda sin las dos bases, y el error crudo que sale es
// ERR_MODULE_NOT_FOUND, que no dice nada de lo que realmente pasó.
async function cargar() {
  if (usarPostgres) return import('./db-pg.js')
  try {
    return await import('./db-sqlite.js')
  } catch (e) {
    if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e
    throw new Error(
      'No hay base: DATABASE_URL no está definida y better-sqlite3 no está instalado.\n' +
        'Definí DATABASE_URL para usar PostgreSQL, o corré `npm install` para el modo SQLite\n' +
        '(better-sqlite3 es opcional y puede no haberse compilado para esta versión de Node).',
      { cause: e },
    )
  }
}

const modulo = await cargar()

export const db = modulo.db
export const motor = modulo.motor

export const ahora = () => new Date().toISOString()

export function avisarMotor() {
  if (usarPostgres) {
    // La URL lleva la contraseña: se muestra solo host y base.
    const u = new URL(process.env.DATABASE_URL)
    console.log(`Base: PostgreSQL en ${u.host}${u.pathname}`)
  } else {
    console.log('Base: SQLite (definí DATABASE_URL para usar PostgreSQL)')
  }
}
