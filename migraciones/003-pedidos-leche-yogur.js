// Los pedidos dejan de ser sólo de queso.
//
// Hasta acá una línea de pedido ERA un queso: `tipo_queso_id NOT NULL`, y se cumplía
// pesando pieza por pieza porque cada queso pesa distinto. Leche y yogur no funcionan
// así — un cartón de 1 L es 1 L —, así que no alcanza con permitir otro producto: la
// línea tiene que poder ser de dos clases y cumplirse de dos maneras.
//
//   queso  ->  tipo_queso_id            cantidad_pedida = piezas     cumple con pesos
//   leche  ->  producto + marca + envase cantidad_pedida = bultos    cumple con cantidades
//   yogur  ->  producto + marca          cantidad_pedida = unidades  cumple con cantidades
//
// Las unidades las confirmó el cliente el 2026-09-22. La leche se pide en CAJONES y no
// en pallets ni litros, que es lo que hace que elegir "x 18" o "x 20" signifique algo:
// Alexis lo describió como "pida por ejemplo un pallet con 20 cajones solamente".
//
// Por qué una tabla nueva y no un campo `cantidad_entregada` en la línea: por lo mismo
// que los pesos son una tabla y no un total. Una fila por carga da deshacer de a una,
// cola offline con client_id idempotente y a qué hora se preparó cada cosa. Un total
// pisado en la línea pierde las tres.
//
//   node migraciones/003-pedidos-leche-yogur.js               -> muestra qué haría
//   node migraciones/003-pedidos-leche-yogur.js --confirmar   -> aplica
//
// Es aditiva: no toca ninguna fila existente. Las 87 líneas de queso que ya hay quedan
// exactamente como están, con las columnas nuevas en NULL.

import { db, motor } from './../server/db.js'

const confirmar = process.argv.includes('--confirmar')

function destino() {
  if (motor !== 'postgres') return 'SQLite (data/fabrica.db)'
  const u = new URL(process.env.DATABASE_URL)
  const local = ['localhost', '127.0.0.1', '::1', 'host.docker.internal'].includes(u.hostname)
  return `PostgreSQL en ${u.host}${u.pathname}${local ? '' : '  ← REMOTA'}`
}

// ---------------------------------------------------------------- estado actual

async function tieneColumna(tabla, columna) {
  if (motor === 'postgres') {
    const r = await db
      .prepare(
        `SELECT 1 AS hay FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = ? AND column_name = ?`,
      )
      .get(tabla, columna)
    return Boolean(r)
  }
  const cols = await db.prepare(`PRAGMA table_info(${tabla})`).all()
  return cols.some((c) => c.name === columna)
}

async function tieneTabla(tabla) {
  if (motor === 'postgres') {
    const r = await db
      .prepare(`SELECT 1 AS hay FROM pg_tables WHERE schemaname = 'public' AND tablename = ?`)
      .get(tabla)
    return Boolean(r)
  }
  const r = await db
    .prepare(`SELECT 1 AS hay FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(tabla)
  return Boolean(r)
}

// ---------------------------------------------------------------- los pasos

const pasos = [
  {
    titulo: 'pedido_lineas: columnas de leche y yogur',
    async hace_falta() {
      return !(await tieneColumna('pedido_lineas', 'producto_id'))
    },
    async aplica() {
      if (motor === 'postgres') {
        // Aditivo y en una transacción. Nada de lo que ya está se toca: las líneas de
        // queso se quedan con las tres columnas nuevas en NULL.
        await db.exec(`
          BEGIN;

          ALTER TABLE pedido_lineas ALTER COLUMN tipo_queso_id DROP NOT NULL;
          ALTER TABLE pedido_lineas ADD COLUMN producto_id INTEGER REFERENCES productos(id);
          ALTER TABLE pedido_lineas ADD COLUMN marca_id    INTEGER REFERENCES marcas(id);
          ALTER TABLE pedido_lineas ADD COLUMN envase_id   INTEGER REFERENCES envases(id);

          -- Una línea es de queso O de producto, nunca de las dos ni de ninguna. Sin esto
          -- una línea a medio llenar se guarda igual y revienta recién al mostrarla.
          ALTER TABLE pedido_lineas ADD CONSTRAINT pedido_lineas_una_clase CHECK (
            (tipo_queso_id IS NOT NULL AND producto_id IS NULL
             AND marca_id IS NULL AND envase_id IS NULL)
            OR
            (tipo_queso_id IS NULL AND producto_id IS NOT NULL AND marca_id IS NOT NULL)
          );

          COMMIT;
        `)
        return 'producto_id, marca_id, envase_id + CHECK de clase'
      }

      // SQLite no sabe sacar un NOT NULL, así que la tabla se rehace. Se copia primero y
      // se borra después, dentro de una transacción: si algo falla no queda a medias.
      await db.exec(`
        PRAGMA foreign_keys=off;
        BEGIN;
        CREATE TABLE pedido_lineas_nueva (
          id              INTEGER PRIMARY KEY,
          pedido_id       INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
          tipo_queso_id   INTEGER REFERENCES tipos_queso(id),
          producto_id     INTEGER REFERENCES productos(id),
          marca_id        INTEGER REFERENCES marcas(id),
          envase_id       INTEGER REFERENCES envases(id),
          cantidad_pedida INTEGER NOT NULL,
          CHECK (
            (tipo_queso_id IS NOT NULL AND producto_id IS NULL
             AND marca_id IS NULL AND envase_id IS NULL)
            OR
            (tipo_queso_id IS NULL AND producto_id IS NOT NULL AND marca_id IS NOT NULL)
          )
        );
        INSERT INTO pedido_lineas_nueva (id, pedido_id, tipo_queso_id, cantidad_pedida)
          SELECT id, pedido_id, tipo_queso_id, cantidad_pedida FROM pedido_lineas;
        DROP TABLE pedido_lineas;
        ALTER TABLE pedido_lineas_nueva RENAME TO pedido_lineas;
        CREATE INDEX IF NOT EXISTS idx_lineas_pedido ON pedido_lineas(pedido_id);
        COMMIT;
        PRAGMA foreign_keys=on;
      `)
      return 'tabla rehecha con las columnas nuevas'
    },
  },

  {
    titulo: 'pedido_lineas: un producto no se repite dentro del mismo pedido',
    async hace_falta() {
      const r =
        motor === 'postgres'
          ? await db
              .prepare(`SELECT 1 AS hay FROM pg_indexes WHERE indexname = 'pedido_lineas_producto_uk'`)
              .get()
          : await db
              .prepare(`SELECT 1 AS hay FROM sqlite_master WHERE type = 'index' AND name = ?`)
              .get('pedido_lineas_producto_uk')
      return !r
    },
    async aplica() {
      // El equivalente al UNIQUE (pedido_id, tipo_queso_id) que ya tenían los quesos: si
      // el mismo producto se carga dos veces se suma en la línea que ya existe, para que
      // nadie tenga que ir dos veces a buscar lo mismo a la cámara.
      //
      // COALESCE sobre envase_id porque en SQL NULL nunca es igual a NULL, y sin eso dos
      // líneas de yogur del mismo sabor y marca (que no llevan envase) no chocarían.
      // Los dos motores soportan índices parciales y por expresión, así que la misma
      // sentencia sirve para ambos. El IF NOT EXISTS es de SQLite; Postgres también lo
      // acepta.
      await db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS pedido_lineas_producto_uk
            ON pedido_lineas (pedido_id, producto_id, marca_id, COALESCE(envase_id, 0))
         WHERE producto_id IS NOT NULL;
      `)
      return 'índice único parcial creado'
    },
  },

  {
    titulo: 'Tabla pedido_cantidades',
    async hace_falta() {
      return !(await tieneTabla('pedido_cantidades'))
    },
    async aplica() {
      if (motor === 'postgres') {
        await db.exec(`
          CREATE TABLE pedido_cantidades (
            id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            client_id  UUID        NOT NULL UNIQUE,
            linea_id   INTEGER     NOT NULL REFERENCES pedido_lineas(id) ON DELETE CASCADE,
            cantidad   INTEGER     NOT NULL CHECK (cantidad BETWEEN 1 AND 100000),
            fecha_hora TIMESTAMPTZ NOT NULL,
            origen     origen_registro NOT NULL DEFAULT 'online',
            anulado    BOOLEAN     NOT NULL DEFAULT false,
            anulado_en TIMESTAMPTZ
          );
          CREATE INDEX ON pedido_cantidades (linea_id);
          ALTER TABLE pedido_cantidades ENABLE ROW LEVEL SECURITY;
        `)
        return 'creada, con RLS como el resto'
      }
      await db.exec(`
        CREATE TABLE IF NOT EXISTS pedido_cantidades (
          id         INTEGER PRIMARY KEY,
          client_id  TEXT NOT NULL UNIQUE,
          linea_id   INTEGER NOT NULL REFERENCES pedido_lineas(id) ON DELETE CASCADE,
          cantidad   INTEGER NOT NULL,
          fecha_hora TEXT NOT NULL,
          origen     TEXT NOT NULL DEFAULT 'online',
          anulado    INTEGER NOT NULL DEFAULT 0,
          anulado_en TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_cantidades_linea ON pedido_cantidades(linea_id);
      `)
      return 'creada'
    },
  },
]

// ---------------------------------------------------------------- correr

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

// Que nada se haya perdido es lo único que importa de una migración sobre datos reales.
const n = await db
  .prepare(
    `SELECT (SELECT COUNT(*) FROM pedidos)        AS pedidos,
            (SELECT COUNT(*) FROM pedido_lineas)  AS lineas,
            (SELECT COUNT(*) FROM pedido_pesos)   AS pesos`,
  )
  .get()
console.log(`\nDatos: ${n.pedidos} pedidos · ${n.lineas} líneas · ${n.pesos} pesos\n`)

process.exit(0)
