// El yogur se arma en PALLETS DE CAJAS.
//
//   "Justo terminamos de hacer el sistema que directamente sale el yogur, armás la caja,
//    entonces vas armando el pallet, ya no sale el bin, sino que vas armando el pallet,
//    directamente ya lo marcás como pallet de yogurt, pero las cajas de yogurt son por 15
//    unidades, así que también lo puedo marcar como hago con la leche."
//   — Alexis, audio del 2026-11-06
//
//   "Entran 70 cajas de yogurt por pallet. De 15 unidades cada caja en la marca Lácteos
//    Belgrano que es de 1 kg la presentación, y de 16 unidades en la marca Central Lechera
//    que son de 900 gramos."
//   "El bin por el momento sigue apareciendo pero cada vez menos. Tendría que estar igual
//    la opción."
//   "Los potes van en cajas sueltas por el momento."
//   — Alexis, 2026-11-10
//
// LA MISMA LECCION QUE YA HABIAMOS APRENDIDO CON LA LECHE
//
// En server/db-sqlite.js hay un comentario de hace meses que dice, sobre las columnas
// `productos.cajas_por_pallet` y `litros_por_caja`:
//
//   "OBSOLETAS: la equivalencia dejo de ser una propiedad del producto. Un mismo tipo de
//    leche puede armarse en caja o en palangana y dar litros distintos, asi que el envase
//    es una eleccion del operario en cada pallet."
//
// Es exactamente lo que acaba de pasarle al yogur. Mientras salia siempre en bin, "cuanto
// entra" podia vivir en el producto (`unidades_por_bin`). Ahora el mismo sabor sale en
// pallet, en bin o en potes, asi que el formato pasa a elegirse en cada carga. No hace
// falta una tabla nueva: `envases` es esa tabla, solo que hasta hoy era solo de leche.
//
// POR QUE LOS FORMATOS DEL YOGUR LLEVAN MARCA
//
// Porque la caja es de 15 unidades de 1 kg en Lacteos Belgrano y de 16 de 900 g en Central
// Lechera. No es un formato con dos variantes: son dos formatos, y cruzarlos daria los
// kilos de la otra marca. `marca_id` en NULL quiere decir "lo usan todas", que es el caso
// de toda la leche y tambien el del bin.
//
// POR QUE ESTO ADEMAS MEJORA EL DATO, Y NO SOLO LA PANTALLA
//
// Un bin nadie lo cuenta: se mira y se estima, y por eso tiene el 100/75/50/25. Las cajas
// de un pallet SE CUENTAN. Donde antes habia una estimacion ahora hay una cuenta, y de
// paso se disuelve sola la diferencia que Alexis no sabia como catalogar ("diferencia
// entre el aproximado del bin y el real de cajas"): ya no hay un aproximado que conciliar.
//
// LO QUE NO SE TOCA
//
// El bin sigue existiendo y entra como un envase mas, de un solo bulto. Los potes siguen
// contandose en cajas sueltas al final de la produccion, igual que los dejo la 008.
//
//   node migraciones/009-yogur-en-pallets.js               -> muestra qué haría
//   node migraciones/009-yogur-en-pallets.js --confirmar   -> aplica

import { db, motor } from './../server/db.js'

const confirmar = process.argv.includes('--confirmar')
const pg = motor === 'postgres'

// Los formatos del yogur. `marca` en null = lo usan todas.
//
// El BIN va provisorio a proposito: los 500 sachets siempre fueron "aproximadamente 500",
// y eso es literalmente lo que `provisorio` significa en esta tabla. Los pallets no: 70 ×
// 15 son numeros contados.
const FORMATOS = [
  { nombre: 'Pallet 70 cajas × 15', marca: 'Lácteos Belgrano', bultos: 70, unidades: 15, porUnidad: 1, provisorio: false, orden: 11 },
  { nombre: 'Pallet 70 cajas × 16', marca: 'Central Lechera', bultos: 70, unidades: 16, porUnidad: 0.9, provisorio: false, orden: 12 },
  { nombre: 'Bin 500', marca: null, bultos: 1, unidades: 500, porUnidad: 1, provisorio: true, orden: 13 },
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

const pasos = [
  {
    titulo: 'envases: familia, marca y unidad',
    async hace_falta() {
      return !(await tieneColumna('envases', 'familia'))
    },
    async aplica() {
      // El DEFAULT deja a todos los formatos que ya existen como de leche y en litros,
      // que es lo que son. Ninguna fila necesita backfill.
      //
      // db.exec y no prepare(): este DDL ya esta escrito por motor y no tiene parametros
      // ni comparaciones booleanas que traducir. La regla al reves —un UPDATE con
      // `columna = 1` por exec— es la que nos mordio en la 007 y en la 008.
      await db.exec(`
        ALTER TABLE envases ADD COLUMN familia TEXT NOT NULL DEFAULT 'leche';
        ALTER TABLE envases ADD COLUMN unidad TEXT NOT NULL DEFAULT 'L';
      `)
      await db.exec('ALTER TABLE envases ADD COLUMN marca_id INTEGER REFERENCES marcas(id)')
      return "familia='leche' y unidad='L' para los formatos que ya estaban"
    },
  },

  {
    titulo: 'registros_yogur: formato, bultos y unidades por bulto',
    async hace_falta() {
      return !(await tieneColumna('registros_yogur', 'envase_id'))
    },
    async aplica() {
      // Quedan en NULL para las cargas viejas, y esta bien que asi sea: son bins que se
      // registraron antes de que el formato existiera. Rellenarlas con el formato de hoy
      // seria inventarles un dato — exactamente el error que ya cometimos una vez con los
      // litros de los pallets de leche.
      await db.exec(`
        ALTER TABLE registros_yogur ADD COLUMN bultos INTEGER;
        ALTER TABLE registros_yogur ADD COLUMN unidades_por_bulto INTEGER;
      `)
      await db.exec(
        'ALTER TABLE registros_yogur ADD COLUMN envase_id INTEGER REFERENCES envases(id)',
      )
      return 'las cargas anteriores quedan sin formato, que es lo que eran'
    },
  },

  {
    titulo: 'Los formatos del yogur',
    async hace_falta() {
      if (!(await tieneColumna('envases', 'familia'))) return true
      const n = await db.prepare("SELECT COUNT(*) AS n FROM envases WHERE familia = 'yogur'").get()
      return Number(n.n) === 0
    },
    async aplica() {
      const buscarMarca = db.prepare('SELECT id FROM marcas WHERE nombre = ?')
      const hechos = []
      for (const f of FORMATOS) {
        const m = f.marca ? await buscarMarca.get(f.marca) : null
        if (f.marca && !m) return `NO SE PUDO: no existe la marca "${f.marca}"`
        // Los booleanos van como LITERAL en el SQL y no como 0/1 ni como parametro
        // ligado: el traductor de dialecto reescribe las COMPARACIONES booleanas, no los
        // literales de un VALUES. Un 0/1 acá llega a Postgres como integer contra una
        // columna boolean y corta con 42804. Ya nos pasó tres veces.
        await db
          .prepare(
            `INSERT INTO envases
               (nombre, bultos_por_pallet, unidades_por_bulto, litros_por_unidad,
                provisorio, activo, orden, familia, unidad, marca_id)
             VALUES (?, ?, ?, ?, ${f.provisorio ? 'true' : 'false'}, true, ?, 'yogur', 'kg', ?)`,
          )
          .run(f.nombre, f.bultos, f.unidades, f.porUnidad, f.orden, m?.id ?? null)
        hechos.push(`${f.nombre} = ${Math.round(f.bultos * f.unidades * f.porUnidad)} kg`)
      }
      return hechos.join(' · ')
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

// Lo que quedo cargado, por nombre y no por id: son los formatos con los que se va a
// liquidar produccion, no filas anonimas.
if (await tieneColumna('envases', 'familia')) {
  const e = await db
    .prepare(`
      SELECT e.nombre, e.familia, e.unidad, e.bultos_por_pallet AS b, e.unidades_por_bulto AS u,
             e.litros_por_unidad AS p, e.provisorio, m.nombre AS marca
        FROM envases e
        LEFT JOIN marcas m ON m.id = e.marca_id
       WHERE e.activo = 1
       ORDER BY e.familia, e.orden, e.nombre
    `)
    .all()
  console.log('\nFormatos activos:')
  for (const x of e) {
    const total = x.b && x.u && x.p ? `${Math.round(x.b * x.u * x.p).toLocaleString('es-AR')} ${x.unidad}` : 'a confirmar'
    console.log(
      `  [${x.familia.padEnd(5)}] ${x.nombre.padEnd(22)} ${String(`${x.b ?? '?'} × ${x.u ?? '?'}`).padEnd(10)} ` +
        `${total.padEnd(12)} ${x.marca ? `solo ${x.marca}` : 'todas las marcas'}${x.provisorio ? '  (provisorio)' : ''}`,
    )
  }
  console.log('')
}

process.exit(0)
