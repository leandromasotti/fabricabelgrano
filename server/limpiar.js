// Vacía la producción registrada y deja los catálogos intactos.
//
// Es para arrancar el piloto de cero, con los operarios, marcas, quesos y formatos ya
// configurados pero sin un solo pallet ni una sola tina de las pruebas.
//
//   npm run limpiar               -> NO borra nada: muestra qué borraría
//   npm run limpiar -- --confirmar-> borra
//
// El modo por defecto es la simulación a propósito. Este es exactamente el script que
// uno no quiere haber ejecutado sin querer, y "me equivoqué de terminal" es un accidente
// real. Que la versión corta sea inofensiva hace que el accidente no exista.

import { db, motor } from './db.js'

// Se vacían en este orden por las claves foráneas: primero lo que cuelga de algo.
// Con Postgres alcanzaría TRUNCATE CASCADE, pero un orden explícito documenta el
// modelo y funciona igual en los dos motores.
const MOVIMIENTOS = [
  'pedido_pesos',
  'pedido_lineas',
  'pedidos',
  'movimientos_envasado',
  'movimientos_maduracion',
  'movimientos_saladero',
  'tinas',
  'registros_pallet',
  'registros_yogur',
  'recepciones',
]

// Lo que NO se toca. Está enumerado y no deducido: si mañana alguien agrega una tabla,
// que el script la ignore es mejor que que la borre por defecto.
const CATALOGOS = [
  'operarios',
  'marcas',
  'marcas_familias',
  'productos',
  'tipos_queso',
  'envases',
  'clientes',
  'tambos',
]

const confirmar = process.argv.includes('--confirmar')

// Vaciar una base que no está en esta máquina —Supabase, un VPS— es una operación
// distinta y merece una llave distinta. No alcanza con --confirmar: hay que escribir el
// host, de modo que sea imposible hacerlo sin haber mirado a dónde apunta DATABASE_URL.
const remota = process.argv.find((a) => a.startsWith('--remota='))?.slice(9)

// ---------------------------------------------------------------- guardas

// Solo local. La URL de una base administrada —Supabase, un VPS, cualquier host que no
// sea esta máquina— no tiene por qué pasar nunca por acá.
function esLocal() {
  if (motor !== 'postgres') return true // SQLite es un archivo de esta máquina
  const host = new URL(process.env.DATABASE_URL).hostname
  return ['localhost', '127.0.0.1', '::1', 'host.docker.internal'].includes(host)
}

if (!esLocal()) {
  const host = new URL(process.env.DATABASE_URL).hostname
  if (remota !== host) {
    console.error(`DATABASE_URL apunta a una base REMOTA: ${host}`)
    console.error('')
    console.error('Para vaciarla hay que nombrarla, además de confirmar:')
    console.error(`  npm run limpiar -- --confirmar --remota=${host}`)
    console.error('')
    console.error('El host se escribe a mano a propósito: es la diferencia entre vaciar')
    console.error('la base de pruebas y vaciar la de producción por tener mal el .env.')
    process.exit(1)
  }
  console.log(`⚠  Base REMOTA: ${host}`)
}

// ---------------------------------------------------------------- contar

async function contar(tablas) {
  const filas = []
  for (const t of tablas) {
    const { n } = await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()
    filas.push({ tabla: t, filas: Number(n) })
  }
  return filas
}

const aBorrar = await contar(MOVIMIENTOS)
const aConservar = await contar(CATALOGOS)
const total = aBorrar.reduce((n, f) => n + f.filas, 0)

const linea = ({ tabla, filas }) => `  ${tabla.padEnd(24)} ${String(filas).padStart(7)}`

console.log(`Base: ${motor}${motor === 'postgres' ? ` (${new URL(process.env.DATABASE_URL).pathname.slice(1)})` : ''}`)
console.log('\nSE BORRA:')
console.log(aBorrar.map(linea).join('\n'))
console.log(`  ${'TOTAL'.padEnd(24)} ${String(total).padStart(7)}`)
console.log('\nSE CONSERVA:')
console.log(aConservar.map(linea).join('\n'))

if (!confirmar) {
  console.log('\nNo se borró nada. Para hacerlo de verdad:')
  console.log('  npm run limpiar -- --confirmar')
  await db.cerrar()
  process.exit(0)
}

if (total === 0) {
  console.log('\nNo hay nada que borrar.')
  await db.cerrar()
  process.exit(0)
}

// ---------------------------------------------------------------- borrar

// Todo dentro de una transacción: o queda vacío del todo, o queda como estaba. Un
// vaciado a medias —pedidos sin sus líneas, tinas sin sus movimientos— deja la base en
// un estado que ninguna pantalla sabe mostrar.
await db.transaccion(async (tx) => {
  for (const t of MOVIMIENTOS) await tx.prepare(`DELETE FROM ${t}`).run()
})

// Los id vuelven a empezar en 1. No es cosmético: durante el piloto se habla de "la
// tina 3" mirando la pantalla, y que el primer registro del primer día sea el 412 es
// una fricción gratuita.
if (motor === 'postgres') {
  for (const t of MOVIMIENTOS) {
    await db.exec(`ALTER TABLE ${t} ALTER COLUMN id RESTART WITH 1`)
  }
} else {
  // En SQLite los AUTOINCREMENT viven en sqlite_sequence, que solo existe si alguna
  // tabla la usa; si no está, no hay contador que reiniciar.
  const hay = await db
    .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'")
    .get()
  if (Number(hay.n) > 0) {
    for (const t of MOVIMIENTOS) {
      await db.prepare('DELETE FROM sqlite_sequence WHERE name = ?').run(t)
    }
  }
}

const quedaron = (await contar(MOVIMIENTOS)).reduce((n, f) => n + f.filas, 0)
console.log(`\nListo: ${total} registros borrados, ${quedaron} quedaron.`)
console.log('Los catálogos siguen cargados. La producción arranca de cero.')

await db.cerrar()
