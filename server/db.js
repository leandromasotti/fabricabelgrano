// Elige el motor de base de datos.
//
//   DATABASE_URL definida  -> PostgreSQL (local en Docker, o Supabase)
//   sin DATABASE_URL       -> SQLite, como hasta ahora
//
// Los dos exponen la MISMA API asíncrona, así que index.js no sabe cuál está usando.
// Eso permite volver a SQLite con una variable de entorno si algo falla en producción,
// que es exactamente lo que uno quiere tener a mano el día que algo falla.

const usarPostgres = Boolean(process.env.DATABASE_URL)

const modulo = usarPostgres ? await import('./db-pg.js') : await import('./db-sqlite.js')

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
