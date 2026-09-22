// Cambios de catálogo pedidos por el cliente el 2026-09-22.
//
//   1. "Ovenac" se escribe **Obenac**, con B. Venía mal desde la transcripción del audio
//      (A2 00:47) y quedó así en la base. Cierra la pregunta A1 de 02-preguntas-abiertas.
//
//   2. Los cajones dejan de nombrarse por cliente y pasan a nombrarse por lo que
//      realmente los distingue: cuántas unidades entran.
//
//        Cajón lácteo         ->  Cajón lácteo x 18   (renombrado)
//        Cajón Sancor         ->  de baja
//        Cajón La Serenísima  ->  de baja
//        (nuevo)              ->  Cajón lácteo x 20
//
// Por qué un script y no el seed: el seed sólo corre sobre bases nuevas. Esto tiene que
// aplicarse sobre bases que ya tienen producción cargada —la de Docker, la de Supabase y
// mañana la de planta—, así que necesita existir aparte y ser repetible.
//
//   node migraciones/002-cajones-y-obenac.js               -> no toca nada, muestra qué haría
//   node migraciones/002-cajones-y-obenac.js --confirmar   -> aplica
//
// Igual que en limpiar.js, la versión corta es la inofensiva: el accidente de correrlo en
// la terminal equivocada no existe si la forma fácil no escribe.

import { db, motor } from './../server/db.js'

const confirmar = process.argv.includes('--confirmar')

// ---------------------------------------------------------------- a dónde apunta

function destino() {
  if (motor !== 'postgres') return 'SQLite (data/fabrica.db)'
  const u = new URL(process.env.DATABASE_URL)
  const local = ['localhost', '127.0.0.1', '::1', 'host.docker.internal'].includes(u.hostname)
  return `PostgreSQL en ${u.host}${u.pathname}${local ? '' : '  ← REMOTA'}`
}

// ---------------------------------------------------------------- los pasos
//
// Cada paso se pregunta primero si hace falta. Así el script se puede correr dos veces
// sin efecto, que es lo que uno quiere cuando no se acuerda si ya lo corrió contra
// Supabase.

const qMarcaPorNombre = db.prepare('SELECT id, nombre FROM marcas WHERE nombre = ?')
const qEnvasePorNombre = db.prepare('SELECT id, nombre, activo FROM envases WHERE nombre = ?')

const pasos = [
  {
    titulo: 'Marca "Ovenac" -> "Obenac"',
    async hace_falta() {
      return Boolean(await qMarcaPorNombre.get('Ovenac'))
    },
    async aplica() {
      // Renombrar y no crear una marca nueva es lo correcto: es la misma marca, con la
      // misma producción colgando. Crear otra partiría el historial en dos.
      const r = await db.prepare('UPDATE marcas SET nombre = ? WHERE nombre = ?').run('Obenac', 'Ovenac')
      return `${r.changes} marca renombrada`
    },
  },

  {
    titulo: 'Cajón lácteo -> Cajón lácteo x 18',
    async hace_falta() {
      return Boolean(await qEnvasePorNombre.get('Cajón lácteo'))
    },
    async aplica() {
      // También renombre, no alta. Todo lo ya registrado con este formato era 40 × 18, así
      // que el nombre nuevo sigue siendo verdadero sobre el pasado. Esto importa porque
      // registros_pallet congela bultos y litros pero el NOMBRE lo trae con un join en
      // vivo: renombrar reescribe cómo se lee la historia, y por eso sólo vale cuando el
      // nombre nuevo describe lo mismo.
      const r = await db
        .prepare('UPDATE envases SET nombre = ?, orden = 2 WHERE nombre = ?')
        .run('Cajón lácteo x 18', 'Cajón lácteo')
      return `${r.changes} formato renombrado`
    },
  },

  {
    titulo: 'Baja de Cajón Sancor y Cajón La Serenísima',
    async hace_falta() {
      for (const n of ['Cajón Sancor', 'Cajón La Serenísima']) {
        const e = await qEnvasePorNombre.get(n)
        if (e && (e.activo === 1 || e.activo === true)) return true
      }
      return false
    },
    async aplica() {
      // Baja, NUNCA borrado. En Supabase ya hay un pallet registrado como "Cajón Sancor";
      // borrar la fila lo dejaría sin nombre (y la clave foránea lo impediría igual). La
      // baja lo saca de la tablet y lo deja en la historia, que es la regla de toda la
      // aplicación.
      let n = 0
      for (const nombre of ['Cajón Sancor', 'Cajón La Serenísima']) {
        const r = await db.prepare('UPDATE envases SET activo = 0 WHERE nombre = ?').run(nombre)
        n += r.changes
      }
      return `${n} formatos dados de baja`
    },
  },

  {
    titulo: 'Alta de Cajón lácteo x 20',
    async hace_falta() {
      return !(await qEnvasePorNombre.get('Cajón lácteo x 20'))
    },
    async aplica() {
      // provisorio = 1 a propósito. Los 40 bultos por pallet son deducción, no dato:
      // Alexis dijo que el cajón x 20 existe "porque en un solo pallet meten más litros",
      // lo que implica el mismo pallet de 40 cajones con más unidades adentro — 800 L en
      // vez de 720. Se confirma desde /app/envases destildando "provisorio".
      //
      // (Hoy ese flag sólo se ve en /app/envases; en la tablet el 800 sale sin marca. Ver
      // la nota en seed.js.)
      const r = await db
        .prepare(
          // `true` y no `1`: la traducción a Postgres cubre las comparaciones (activo = 1)
          // pero no un literal suelto en el VALUES, y ahí `activo` es BOOLEAN de verdad.
          // Los dos motores aceptan `true`. Los parámetros sí pueden ir 0/1 porque viajan
          // como texto y Postgres los castea.
          `INSERT INTO envases (nombre, bultos_por_pallet, unidades_por_bulto, litros_por_unidad, provisorio, activo, orden)
           VALUES (@nombre, @bultos, @unidades, @litros, @provisorio, true, @orden)`,
        )
        .run({
          nombre: 'Cajón lácteo x 20',
          bultos: 40,
          unidades: 20,
          litros: 1,
          provisorio: 1,
          orden: 3,
        })
      return `${r.changes} formato creado (40 × 20 = 800 L, provisorio)`
    },
  },

  {
    titulo: 'Orden de la lista en la tablet',
    async hace_falta() {
      // El x 18 es el caso frecuente ("por lo general son casi todos los cajones por 18"),
      // así que va antes que el x 20.
      const esperado = [
        ['Caja 12 × 1 L', 1],
        ['Cajón lácteo x 18', 2],
        ['Cajón lácteo x 20', 3],
        ['Palangana 30', 4],
        ['Bandejón de colores', 5],
      ]
      for (const [nombre, orden] of esperado) {
        const e = await db.prepare('SELECT orden FROM envases WHERE nombre = ?').get(nombre)
        if (e && e.orden !== orden) return true
      }
      return false
    },
    async aplica() {
      const esperado = [
        ['Caja 12 × 1 L', 1],
        ['Cajón lácteo x 18', 2],
        ['Cajón lácteo x 20', 3],
        ['Palangana 30', 4],
        ['Bandejón de colores', 5],
      ]
      let n = 0
      for (const [nombre, orden] of esperado) {
        const r = await db.prepare('UPDATE envases SET orden = ? WHERE nombre = ?').run(orden, nombre)
        n += r.changes
      }
      return `${n} formatos reordenados`
    },
  },
]

// ---------------------------------------------------------------- correr

console.log(`\nBase: ${destino()}`)
console.log(confirmar ? 'Modo: APLICANDO\n' : 'Modo: simulación (agregá --confirmar para aplicar)\n')

let pendientes = 0
for (const paso of pasos) {
  const falta = await paso.hace_falta()
  if (!falta) {
    console.log(`  ya estaba   ${paso.titulo}`)
    continue
  }
  pendientes++
  if (!confirmar) {
    console.log(`  HARÍA       ${paso.titulo}`)
    continue
  }
  const detalle = await paso.aplica()
  console.log(`  hecho       ${paso.titulo}  (${detalle})`)
}

if (!pendientes) {
  console.log('\nNo había nada que hacer: la base ya estaba al día.')
} else if (!confirmar) {
  console.log(`\n${pendientes} paso(s) pendiente(s). Volvé a correrlo con --confirmar.`)
} else {
  console.log(`\n${pendientes} paso(s) aplicado(s).`)
}

// Cómo quedó, siempre: es la única forma de que quien lo corre vea el resultado sin
// tener que abrir otra herramienta.
console.log('\nFormatos activos:')
const activos = await db
  .prepare(
    `SELECT nombre, bultos_por_pallet AS b, unidades_por_bulto AS u, provisorio
       FROM envases WHERE activo = 1 ORDER BY orden, id`,
  )
  .all()
for (const e of activos) {
  const litros = e.b && e.u ? ` = ${e.b * e.u} L` : ''
  const prov = e.provisorio === 1 || e.provisorio === true ? '  (provisorio)' : ''
  console.log(`  ${String(e.nombre).padEnd(22)} ${e.b ?? '?'} × ${e.u ?? '?'}${litros}${prov}`)
}

const marcas = await db.prepare('SELECT nombre FROM marcas WHERE activo = 1 ORDER BY orden').all()
console.log(`\nMarcas activas: ${marcas.map((m) => m.nombre).join(', ')}\n`)

process.exit(0)
