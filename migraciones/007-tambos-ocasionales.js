// Tambos habituales y tambos excepcionales.
//
//   "Vamos a tener los tambos que habitualmente hacen las entregas y tambos que hacen
//    entregas esporádicamente o excepcionales. En la pantalla principal se mostrarán los
//    habituales y en la sección de Otros Tambos se podrá seleccionar alguno de la otra
//    lista. En el caso que tengan que agregar otro tambo, deberían darlo de alta. Un
//    tambo que se da de alta, por defecto debería ser de los excepcionales ya que la
//    lista de los tambos usados diariamente ya está cargada."
//   — acordado con Alexis, 2026-10-13
//
// QUE RESUELVE
//
// Hasta ahora "ocasional" no era un dato: era un efecto secundario de dar el tambo de
// BAJA. Eso hacia que `activo` significara dos cosas incompatibles —"no trabajamos mas
// con este" y "entrega de vez en cuando"— y obligaba a crear la procedencia antes de que
// llegara el camion. Con una columna propia cada cosa significa una sola cosa:
//
//   activo = 0   -> ya no entrega, no se muestra en ningun lado
//   ocasional = 0 -> entrega todos los dias, va en la planilla principal
//   ocasional = 1 -> entrega de vez en cuando, va en "Otros tambos"
//
// Y DE PASO SACA UNA ADIVINANZA
//
// El rojo de "falta cargar este tambo" se deducia: entregó al menos 3 de los ultimos 14
// dias. Esa heuristica existia solo porque no habia forma de saber quien entrega todos
// los dias — sin ella, una planilla con 15 tambos y 9 entregas mostraba 6 casilleros en
// rojo todos los dias, y un rojo que siempre esta no avisa de nada. Ahora esta declarado,
// asi que la adivinanza se va: en la planilla principal estan los habituales, y todo lo
// que esta ahi se espera.
//
// LOS QUE HOY ESTAN DE BAJA
//
// Son los que se venian usando como ocasionales (Menendez y compañía): no estan de baja
// porque dejaran de entregar, sino porque era la unica forma de sacarlos de la planilla
// diaria. Se los reactiva como excepcionales. Si alguno de verdad ya no entrega, se lo da
// de baja desde /app/maestros, que ahora si quiere decir eso y nada mas.
//
// El backfill va en el MISMO paso que la columna a proposito. Si fuera un paso aparte que
// mira "hay algun tambo con activo = 0", volver a correr la migracion despues de que
// Alexis diera de baja un tambo de verdad se lo reactivaria. Atado a que la columna no
// exista, corre una sola vez en la vida de la base.
//
//   node migraciones/007-tambos-ocasionales.js               -> muestra qué haría
//   node migraciones/007-tambos-ocasionales.js --confirmar   -> aplica

import { db, motor } from './../server/db.js'

const confirmar = process.argv.includes('--confirmar')

function destino() {
  // DB_PATH y no 'data/fabrica.db' a secas: esta linea existe para que nadie migre la
  // base equivocada, y si la que dice no es la que toca no sirve para nada.
  if (motor !== 'postgres') return `SQLite (${process.env.DB_PATH ?? 'data/fabrica.db'})`
  const u = new URL(process.env.DATABASE_URL)
  const local = ['localhost', '127.0.0.1', '::1', 'host.docker.internal'].includes(u.hostname)
  return `PostgreSQL en ${u.host}${u.pathname}${local ? '' : '  ← REMOTA'}`
}

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

const pasos = [
  {
    titulo: 'tambos: habitual o excepcional',
    async hace_falta() {
      return !(await tieneColumna('tambos', 'ocasional'))
    },
    async aplica() {
      // El default deja a todos los que ya estaban como habituales, que es lo correcto:
      // la lista de los que entregan todos los dias ya está cargada.
      await db.exec(
        motor === 'postgres'
          ? 'ALTER TABLE tambos ADD COLUMN ocasional BOOLEAN NOT NULL DEFAULT false'
          : 'ALTER TABLE tambos ADD COLUMN ocasional INTEGER NOT NULL DEFAULT 0',
      )
      const deBaja = await db.prepare('SELECT numero, nombre FROM tambos WHERE activo = 0').all()
      await db.exec('UPDATE tambos SET ocasional = 1, activo = 1 WHERE activo = 0')
      return deBaja.length
        ? `${deBaja.length} reactivado(s) como excepcional(es): ` +
          deBaja.map((t) => t.nombre ?? t.numero).join(', ')
        : 'ninguno de baja para reclasificar'
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
    // Lo que va a tocar, antes de tocarlo: son datos de la fábrica, no filas anónimas.
    const deBaja = await db.prepare('SELECT numero, nombre FROM tambos WHERE activo = 0').all()
    console.log(
      deBaja.length
        ? `              y reactivaría como excepcionales: ${deBaja.map((t) => (t.nombre ? `${t.numero} ${t.nombre}` : t.numero)).join(', ')}`
        : '              (no hay tambos de baja para reclasificar)',
    )
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

if (await tieneColumna('tambos', 'ocasional')) {
  const t = await db.prepare('SELECT numero, nombre, ocasional, activo FROM tambos ORDER BY numero').all()
  const nombrar = (x) => (x.nombre ? `${x.numero} ${x.nombre}` : String(x.numero))
  console.log(`\nHabituales:   ${t.filter((x) => x.activo && !x.ocasional).map(nombrar).join(' · ') || 'ninguno'}`)
  console.log(`Excepcionales: ${t.filter((x) => x.activo && x.ocasional).map(nombrar).join(' · ') || 'ninguno'}`)
  console.log(`De baja:       ${t.filter((x) => !x.activo).map(nombrar).join(' · ') || 'ninguno'}\n`)
}

process.exit(0)
