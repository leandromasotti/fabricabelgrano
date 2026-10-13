// Yogur en potes, y el bin que no se llenó.
//
//   "Actualmente solo trabajamos con los yogures bebibles, pero cada tanto hacen yogures
//    en potes. Para los potes es solo marca Lácteos Belgrano, el embalaje es en caja por
//    24 unidades y se deben registrar la cantidad de cajas."
//
//   "Hay bines que no llegan llenos porque quizás se termina antes el yogurt y te queda
//    1/2 bin."  — Alexis, 2026-10-12
//
// DOS COSAS DISTINTAS QUE ENTRAN EN LA MISMA TABLET
//
// Un bebible se registra DE A UN BIN: el operario elige marca y sabor y listo, porque el
// bin es la unidad fisica que sale de la maquina. Un pote se registra POR CAJAS: no hay
// bin, hay una cantidad que alguien cuenta. Son dos formas de medir lo mismo —produccion
// de yogur— asi que van en la misma tabla, pero el producto tiene que decir cual de las
// dos usa. Eso es `presentacion`.
//
// EL LLENADO ES UN PORCENTAJE Y NO UNA CANTIDAD
//
// Porque el operario no cuenta: mira el bin y dice "esta por la mitad". Pedirle unidades
// seria pedirle precision que no tiene, y el numero quedaria igual de estimado pero
// disfrazado de medido. Cuatro botones (lleno, 3/4, 1/2, 1/4) es un toque y es honesto
// sobre lo que es.
//
// Las unidades y los kilos se recalculan con ese porcentaje y se siguen CONGELANDO en el
// registro, igual que hasta ahora.
//
// POR QUE NO SE LLENO: UNA LISTA, NO UN TEXTO
//
// "Es pérdida por alguna falla en el yogurt. Que hayan abierto alguna canilla mal y se
// fue al desagote" [Alexis]. Eso se repite y alguien va a querer contarlo, asi que va en
// una tabla corta y editable, mismo criterio que los motivos de recepcion (ver 006).
//
// OJO CON LA PRIMERA DE LA LISTA. "Se terminó la partida" NO es una pérdida: es el final
// normal de una produccion. Si no estuviera, el operario tendria que elegir una causa de
// perdida para el caso mas comun, y el reporte de merma contaria como perdida casi todos
// los bins incompletos de la fabrica.
//
// LO QUE NO ENTRA ACA. La reconciliacion contra las cajas reales que salen de un bin
// —"deberia dar una diferencia que la tendriamos que catalogar"— quedo para despues por
// decision del cliente. Esta columna deja el dato que si se sabe en el momento.
//
//   node migraciones/008-yogur-potes-y-llenado.js               -> muestra qué haría
//   node migraciones/008-yogur-potes-y-llenado.js --confirmar   -> aplica

import { db, motor } from './../server/db.js'

const confirmar = process.argv.includes('--confirmar')
const pg = motor === 'postgres'

// La marca que hace los potes. Si manana los hace otra, se cambia desde /app/maestros.
const MARCA_POTES = 'Lácteos Belgrano'
// Se llama `unidades_por_bulto` y NO `unidades_por_caja` por una razon concreta:
// server/db-sqlite.js tiene una migracion vieja que, si encuentra una columna llamada
// `productos.unidades_por_caja`, vuelca su contenido en `unidades_por_bin` y LA BORRA.
// Corre en cada arranque. Una columna con ese nombre se perderia sola en el proximo
// `npm start`. `bulto` ademas es el termino que ya usa el resto del sistema (ver
// envases.unidades_por_bulto).
const UNIDADES_POR_BULTO_POTE = 24

// Los sabores de pote son los mismos que los bebibles, confirmado con el cliente.
const POTES = ['Vainilla', 'Frutilla']

// Orden de aparicion en la tablet. "Se terminó la partida" primero porque es el caso
// comun y porque es el unico que NO es una perdida.
export const MOTIVOS = [
  'Se terminó la partida',
  'Falla en el yogur',
  'Se fue al desagote',
  'Problema en la máquina',
]

function destino() {
  if (!pg) return `SQLite (${process.env.DB_PATH ?? 'data/fabrica.db'})`
  const u = new URL(process.env.DATABASE_URL)
  const local = ['localhost', '127.0.0.1', '::1', 'host.docker.internal'].includes(u.hostname)
  return `PostgreSQL en ${u.host}${u.pathname}${local ? '' : '  ← REMOTA'}`
}

async function tieneColumna(tabla, columna) {
  if (pg) {
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
  if (pg) {
    return Boolean(
      await db.prepare("SELECT 1 AS hay FROM pg_tables WHERE schemaname='public' AND tablename=?").get(tabla),
    )
  }
  return Boolean(
    await db.prepare("SELECT 1 AS hay FROM sqlite_master WHERE type='table' AND name=?").get(tabla),
  )
}

const marcaDePotes = () =>
  db.prepare('SELECT id FROM marcas WHERE nombre = ?').get(MARCA_POTES)

const pasos = [
  {
    titulo: 'Tabla motivos_yogur',
    async hace_falta() {
      return !(await tieneTabla('motivos_yogur'))
    },
    async aplica() {
      await db.exec(
        pg
          ? `CREATE TABLE motivos_yogur (
               id     INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
               nombre TEXT    NOT NULL UNIQUE,
               -- El final normal de una produccion no es una perdida. Separarlo es lo
               -- que hace que el reporte de merma signifique algo.
               es_perdida BOOLEAN NOT NULL DEFAULT true,
               activo BOOLEAN NOT NULL DEFAULT true,
               orden  INTEGER NOT NULL DEFAULT 0
             );
             ALTER TABLE motivos_yogur ENABLE ROW LEVEL SECURITY;`
          : `CREATE TABLE IF NOT EXISTS motivos_yogur (
               id     INTEGER PRIMARY KEY,
               nombre TEXT NOT NULL UNIQUE,
               es_perdida INTEGER NOT NULL DEFAULT 1,
               activo INTEGER NOT NULL DEFAULT 1,
               orden  INTEGER NOT NULL DEFAULT 0
             );`,
      )
      return 'creada'
    },
  },

  {
    titulo: 'Motivos iniciales',
    async hace_falta() {
      if (!(await tieneTabla('motivos_yogur'))) return true
      const n = await db.prepare('SELECT COUNT(*) AS n FROM motivos_yogur').get()
      return Number(n.n) === 0
    },
    async aplica() {
      // prepare().run() y no exec(): exec manda el SQL crudo a Postgres y los booleanos
      // escritos como 0/1 revientan. Es lo que rompio la 007.
      const ins = db.prepare(
        'INSERT INTO motivos_yogur (nombre, es_perdida, activo, orden) VALUES (?, ?, 1, ?)',
      )
      for (const [i, nombre] of MOTIVOS.entries()) {
        await ins.run(nombre, nombre === 'Se terminó la partida' ? 0 : 1, i + 1)
      }
      return `${MOTIVOS.length} motivos (editables desde /app/maestros)`
    },
  },

  {
    titulo: 'productos: presentación, caja y marca propia',
    async hace_falta() {
      return !(await tieneColumna('productos', 'presentacion'))
    },
    async aplica() {
      // 'bin' por defecto: todo lo que ya existe se registra como hasta ahora.
      await db.exec(`
        ALTER TABLE productos ADD COLUMN presentacion TEXT NOT NULL DEFAULT 'bin';
        ALTER TABLE productos ADD COLUMN unidades_por_bulto INTEGER;
      `)
      // marca_id NULL = lo hacen todas las marcas de la familia, que es el caso de
      // siempre. Con valor, ese producto es de una sola marca: los potes.
      await db.exec('ALTER TABLE productos ADD COLUMN marca_id INTEGER REFERENCES marcas(id)')
      return "presentacion='bin' para todo lo que ya estaba"
    },
  },

  {
    titulo: 'registros_yogur: llenado, cajas y motivo',
    async hace_falta() {
      return !(await tieneColumna('registros_yogur', 'llenado'))
    },
    async aplica() {
      // 100 por defecto: todos los bins que ya estan cargados se registraron llenos,
      // que es lo que el sistema asumia.
      await db.exec(`
        ALTER TABLE registros_yogur ADD COLUMN llenado INTEGER NOT NULL DEFAULT 100;
        ALTER TABLE registros_yogur ADD COLUMN cajas INTEGER;
      `)
      await db.exec(
        'ALTER TABLE registros_yogur ADD COLUMN motivo_id INTEGER REFERENCES motivos_yogur(id)',
      )
      return 'llenado=100 para lo ya cargado, que es lo que se asumia'
    },
  },

  {
    titulo: 'Los dos potes de Lácteos Belgrano',
    async hace_falta() {
      if (!(await tieneColumna('productos', 'presentacion'))) return true
      const n = await db
        .prepare("SELECT COUNT(*) AS n FROM productos WHERE presentacion = 'caja'")
        .get()
      return Number(n.n) === 0
    },
    async aplica() {
      const marca = await marcaDePotes()
      if (!marca) return `NO SE PUDO: no existe la marca "${MARCA_POTES}"`
      const max = await db
        .prepare("SELECT COALESCE(MAX(orden), 0) AS n FROM productos WHERE familia = 'yogur'")
        .get()
      const ins = db.prepare(`
        INSERT INTO productos (nombre, familia, activo, orden, presentacion, unidades_por_bulto, marca_id)
        VALUES (?, 'yogur', 1, ?, 'caja', ?, ?)
      `)
      for (const [i, sabor] of POTES.entries()) {
        await ins.run(`Pote ${sabor.toLowerCase()}`, Number(max.n) + i + 1, UNIDADES_POR_BULTO_POTE, marca.id)
      }
      return `${POTES.length} potes × ${UNIDADES_POR_BULTO_POTE} u, solo ${MARCA_POTES}`
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

if (await tieneColumna('productos', 'presentacion')) {
  const p = await db
    .prepare(`
      SELECT p.nombre, p.presentacion, p.unidades_por_bin, p.unidades_por_bulto, m.nombre AS marca
        FROM productos p
        LEFT JOIN marcas m ON m.id = p.marca_id
       WHERE p.familia = 'yogur' AND p.activo = 1
       ORDER BY p.orden
    `)
    .all()
  console.log('\nYogures:')
  for (const x of p) {
    const cuanto =
      x.presentacion === 'caja'
        ? `caja × ${x.unidades_por_bulto}`
        : `bin × ${x.unidades_por_bin ?? '?'}`
    console.log(`  ${x.nombre.padEnd(16)} ${cuanto.padEnd(14)} ${x.marca ? `solo ${x.marca}` : 'todas las marcas'}`)
  }
}
if (await tieneTabla('motivos_yogur')) {
  const m = await db.prepare('SELECT nombre, es_perdida FROM motivos_yogur WHERE activo = 1 ORDER BY orden').all()
  console.log(
    `\nPor qué no se llenó: ${m.map((x) => `${x.nombre}${x.es_perdida ? '' : ' (no es pérdida)'}`).join(' · ') || 'ninguno'}\n`,
  )
}

process.exit(0)
