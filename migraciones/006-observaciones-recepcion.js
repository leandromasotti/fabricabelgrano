// Observaciones al recibir la leche del tambo.
//
//   "Necesitamos poder registrar al momento de la entrada de leche del tambo, poder
//    ponerle una observacion, por ejemplo puede entrar una leche del tambo, y que este
//    cortada, hoy no tenemos donde guardar esa informacion."  — el cliente, 2026-09-25
//
// POR QUE NO ES SOLO UN CAMPO DE TEXTO
//
// "Cortada" no es una nota cualquiera: es un evento de calidad que se repite, que afecta
// lo que se le paga al tambo y que alguien va a querer contar ("¿que tambo nos manda
// leche cortada seguido?"). Un texto libre no se puede contar —"cortada", "Cortada",
// "venia cortada" son tres cosas distintas para una consulta— y ademas obliga a teclear
// con guantes cada vez.
//
// Por eso son DOS cosas:
//
//   motivo_id    -> de una lista corta y configurable. Un toque. Se puede contar.
//   observacion  -> texto libre, opcional, para lo que no entra en la lista.
//
// Y van DESPUES de registrar, no antes: el 95% de las entregas no tiene nada que
// observar y no puede pagar un paso extra. Mismo criterio que el "No fue un pallet
// completo" de lecheria.
//
// LOS MOTIVOS SEMBRADOS SON UN PUNTO DE PARTIDA, NO UN DATO DE LA FABRICA. Solo
// "cortada" salio del cliente; el resto son los problemas habituales de la leche cruda.
// Se editan desde /app/maestros sin tocar codigo.
//
//   node migraciones/006-observaciones-recepcion.js               -> muestra qué haría
//   node migraciones/006-observaciones-recepcion.js --confirmar   -> aplica

import { db, motor } from './../server/db.js'

const confirmar = process.argv.includes('--confirmar')

function destino() {
  if (motor !== 'postgres') return 'SQLite (data/fabrica.db)'
  const u = new URL(process.env.DATABASE_URL)
  const local = ['localhost', '127.0.0.1', '::1', 'host.docker.internal'].includes(u.hostname)
  return `PostgreSQL en ${u.host}${u.pathname}${local ? '' : '  ← REMOTA'}`
}

// El orden importa: es el orden en que aparecen los botones en la tablet, y arriba va lo
// que mas se toca. "Cortada" primero porque es el que nombro el cliente.
export const MOTIVOS = [
  'Cortada',
  'Con olor',
  'Temperatura alta',
  'Aguada',
  'Con sedimento',
  'Remito no coincide',
]

async function tieneColumna(tabla, columna) {
  if (motor === 'postgres') {
    const r = await db
      .prepare(
        `SELECT 1 AS hay FROM information_schema.columns
          WHERE table_schema='public' AND table_name=? AND column_name=?`,
      )
      .get(tabla, columna)
    return Boolean(r)
  }
  const cols = await db.prepare(`PRAGMA table_info(${tabla})`).all()
  return cols.some((c) => c.name === columna)
}

async function tieneTabla(tabla) {
  if (motor === 'postgres') {
    return Boolean(
      await db.prepare(`SELECT 1 AS hay FROM pg_tables WHERE schemaname='public' AND tablename=?`).get(tabla),
    )
  }
  return Boolean(
    await db.prepare(`SELECT 1 AS hay FROM sqlite_master WHERE type='table' AND name=?`).get(tabla),
  )
}

const pasos = [
  {
    titulo: 'Tabla motivos_recepcion',
    async hace_falta() {
      return !(await tieneTabla('motivos_recepcion'))
    },
    async aplica() {
      if (motor === 'postgres') {
        await db.exec(`
          CREATE TABLE motivos_recepcion (
            id     INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            nombre TEXT    NOT NULL UNIQUE,
            activo BOOLEAN NOT NULL DEFAULT true,
            orden  INTEGER NOT NULL DEFAULT 0
          );
          ALTER TABLE motivos_recepcion ENABLE ROW LEVEL SECURITY;
        `)
      } else {
        await db.exec(`
          CREATE TABLE IF NOT EXISTS motivos_recepcion (
            id     INTEGER PRIMARY KEY,
            nombre TEXT NOT NULL UNIQUE,
            activo INTEGER NOT NULL DEFAULT 1,
            orden  INTEGER NOT NULL DEFAULT 0
          );
        `)
      }
      return 'creada'
    },
  },

  {
    titulo: 'Motivos iniciales',
    async hace_falta() {
      if (!(await tieneTabla('motivos_recepcion'))) return true
      const n = await db.prepare('SELECT COUNT(*) AS n FROM motivos_recepcion').get()
      return Number(n.n) === 0
    },
    async aplica() {
      // Solo si la tabla está vacía: si el encargado ya editó la lista, no se pisa.
      const ins = db.prepare('INSERT INTO motivos_recepcion (nombre, activo, orden) VALUES (?, true, ?)')
      for (const [i, nombre] of MOTIVOS.entries()) await ins.run(nombre, i + 1)
      return `${MOTIVOS.length} motivos (editables desde /app/maestros)`
    },
  },

  {
    titulo: 'recepciones: motivo y observación',
    async hace_falta() {
      return !(await tieneColumna('recepciones', 'observacion'))
    },
    async aplica() {
      const t = motor === 'postgres' ? 'TEXT' : 'TEXT'
      await db.exec(`
        ALTER TABLE recepciones ADD COLUMN motivo_id INTEGER REFERENCES motivos_recepcion(id);
        ALTER TABLE recepciones ADD COLUMN observacion ${t};
      `)
      return 'motivo_id + observacion, las dos opcionales'
    },
  },
]

console.log(`\nBase: ${destino()}`)
console.log(confirmar ? 'Modo: APLICANDO\n' : 'Modo: simulación (agregá --confirmar para aplicar)\n')

let pendientes = 0
for (const paso of pasos) {
  if (!(await paso.hace_falta())) {
    console.log(`  ya estaba   ${paso.titulo}`)
    continue
  }
  pendientes++
  if (!confirmar) {
    console.log(`  HARÍA       ${paso.titulo}`)
    continue
  }
  console.log(`  hecho       ${paso.titulo}  (${await paso.aplica()})`)
}

console.log(
  !pendientes
    ? '\nNo había nada que hacer: la base ya estaba al día.'
    : confirmar
      ? `\n${pendientes} paso(s) aplicado(s).`
      : `\n${pendientes} paso(s) pendiente(s). Volvé a correrlo con --confirmar.`,
)

if (await tieneTabla('motivos_recepcion')) {
  const m = await db.prepare('SELECT nombre FROM motivos_recepcion WHERE activo = 1 ORDER BY orden').all()
  console.log(`\nMotivos: ${m.map((x) => x.nombre).join(' · ') || 'ninguno'}\n`)
}

process.exit(0)
