import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dbPath = process.env.DB_PATH ?? join(root, 'data', 'fabrica.db')

mkdirSync(dirname(dbPath), { recursive: true })

export const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS operarios (
    id      INTEGER PRIMARY KEY,
    nombre  TEXT NOT NULL,
    sector  TEXT NOT NULL,
    activo  INTEGER NOT NULL DEFAULT 1,
    orden   INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS marcas (
    id         INTEGER PRIMARY KEY,
    nombre     TEXT NOT NULL,
    es_propia  INTEGER NOT NULL DEFAULT 0,
    activo     INTEGER NOT NULL DEFAULT 1,
    orden      INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS productos (
    id      INTEGER PRIMARY KEY,
    nombre  TEXT NOT NULL,
    familia TEXT NOT NULL,
    activo  INTEGER NOT NULL DEFAULT 1,
    orden   INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS registros_pallet (
    id           INTEGER PRIMARY KEY,
    -- id generado por la tablet. UNIQUE = la sincronizacion offline es idempotente:
    -- si un registro se reenvia, se descarta en vez de duplicarse.
    client_id    TEXT NOT NULL UNIQUE,
    fecha_hora   TEXT NOT NULL,
    -- 'online'  = la hora la puso el servidor
    -- 'offline' = la puso la tablet (corregida con el offset) y se sincronizo despues
    origen       TEXT NOT NULL DEFAULT 'online',
    sincronizado TEXT,
    operario_id  INTEGER NOT NULL REFERENCES operarios(id),
    marca_id     INTEGER NOT NULL REFERENCES marcas(id),
    producto_id  INTEGER NOT NULL REFERENCES productos(id),
    -- nunca se borra un registro: se marca anulado
    anulado      INTEGER NOT NULL DEFAULT 0,
    anulado_en   TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_registros_fecha ON registros_pallet(fecha_hora);

  CREATE TABLE IF NOT EXISTS tipos_queso (
    id               INTEGER PRIMARY KEY,
    nombre           TEXT NOT NULL,
    familia          TEXT NOT NULL,   -- blando | semiduro | duro
    se_envasa        INTEGER NOT NULL DEFAULT 1,
    dias_maduracion  INTEGER,         -- NULL = todavia no lo sabemos (pregunta C2)
    activo           INTEGER NOT NULL DEFAULT 1,
    orden            INTEGER NOT NULL DEFAULT 0
  );

  -- La tina es la unidad de produccion, confirmada en el audio 3:
  -- "el maestro quesero hace la tina", "pone la tina de sardo".
  -- Modelar por tina deja abierta la pregunta B2: si algun dia hace falta trazar la
  -- pieza individual, las piezas cuelgan de la tina sin rehacer esto.
  CREATE TABLE IF NOT EXISTS tinas (
    id            INTEGER PRIMARY KEY,
    client_id     TEXT NOT NULL UNIQUE,
    fecha_hora    TEXT NOT NULL,    -- fin de corte y prensado; se usa para el control de pH
    origen        TEXT NOT NULL DEFAULT 'online',
    sincronizado  TEXT,
    operario_id   INTEGER NOT NULL REFERENCES operarios(id),
    tipo_queso_id INTEGER NOT NULL REFERENCES tipos_queso(id),
    cantidad      INTEGER NOT NULL, -- variable por tina: 117 / 120 / 124 segun el rinde
    anulado       INTEGER NOT NULL DEFAULT 0,
    anulado_en    TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_tinas_fecha ON tinas(fecha_hora);

  -- Entradas y salidas de sal como eventos con cantidad, no como estados de la tina.
  -- Asi soporta que una tina entre entera y salga en tandas, sin asumir cual de las dos.
  CREATE TABLE IF NOT EXISTS movimientos_saladero (
    id            INTEGER PRIMARY KEY,
    client_id     TEXT NOT NULL UNIQUE,
    fecha_hora    TEXT NOT NULL,
    origen        TEXT NOT NULL DEFAULT 'online',
    sincronizado  TEXT,
    operario_id   INTEGER NOT NULL REFERENCES operarios(id),
    tina_id       INTEGER NOT NULL REFERENCES tinas(id),
    tipo          TEXT NOT NULL CHECK (tipo IN ('entrada', 'salida')),
    cantidad      INTEGER NOT NULL,
    anulado       INTEGER NOT NULL DEFAULT 0,
    anulado_en    TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_mov_tina ON movimientos_saladero(tina_id);

  CREATE TABLE IF NOT EXISTS clientes (
    id     INTEGER PRIMARY KEY,
    nombre TEXT NOT NULL,
    activo INTEGER NOT NULL DEFAULT 1,
    orden  INTEGER NOT NULL DEFAULT 0
  );

  -- Un pedido nace por dos vias: lo arma el operario en la tablet, o se lo manda el
  -- encargado. Las dos estan en el audio 6: "el puede armar el pedido o recibir el
  -- pedido de Andres" [A6 01:02].
  CREATE TABLE IF NOT EXISTS pedidos (
    id          INTEGER PRIMARY KEY,
    client_id   TEXT NOT NULL UNIQUE,
    cliente_id  INTEGER NOT NULL REFERENCES clientes(id),
    -- pendiente: esperando que lo armen | armando: en curso | listo: pesado y cerrado
    -- facturado: el encargado ya lo facturo
    estado      TEXT NOT NULL DEFAULT 'pendiente'
                CHECK (estado IN ('pendiente', 'armando', 'listo', 'facturado')),
    origen      TEXT NOT NULL DEFAULT 'encargado' CHECK (origen IN ('encargado', 'tablet')),
    creado_en   TEXT NOT NULL,
    armado_en   TEXT,
    armado_por  INTEGER REFERENCES operarios(id),
    facturado_en TEXT,
    nota        TEXT,
    anulado     INTEGER NOT NULL DEFAULT 0,
    anulado_en  TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_pedidos_estado ON pedidos(estado);

  -- El cliente pide PIEZAS ("3 pategras") pero cada queso pesa distinto, asi que se
  -- pesan todos [A6 00:12]. Guardamos las dos cosas: cantidad pedida en piezas, y el
  -- peso real de cada pieza entregada. Si se termina facturando por pieza y no por
  -- kilo (pregunta A2 sin responder), los pesos sobran pero no molestan; al reves
  -- habria que rehacer todo.
  CREATE TABLE IF NOT EXISTS pedido_lineas (
    id             INTEGER PRIMARY KEY,
    pedido_id      INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
    tipo_queso_id  INTEGER NOT NULL REFERENCES tipos_queso(id),
    cantidad_pedida INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_lineas_pedido ON pedido_lineas(pedido_id);

  -- Una fila por pieza pesada. En GRAMOS y entero: los kilos con decimales en punto
  -- flotante acumulan error al sumar, y este numero termina en una factura.
  CREATE TABLE IF NOT EXISTS pedido_pesos (
    id        INTEGER PRIMARY KEY,
    client_id TEXT NOT NULL UNIQUE,
    linea_id  INTEGER NOT NULL REFERENCES pedido_lineas(id) ON DELETE CASCADE,
    gramos    INTEGER NOT NULL,
    fecha_hora TEXT NOT NULL,
    origen    TEXT NOT NULL DEFAULT 'online',
    anulado   INTEGER NOT NULL DEFAULT 0,
    anulado_en TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_pesos_linea ON pedido_pesos(linea_id);

  -- Envasado. El queso sale del saladero "desnudo", espera en la camara de desnudo y
  -- de ahi se envasa; envasado equivale a "listo para vender, en la camara de
  -- preparacion de pedidos" [A4 00:29-01:09].
  --
  -- Lo disponible para envasar sale de restar: lo que salio de sal menos lo ya
  -- envasado. Mismo criterio que el saladero: eventos que se suman, no un estado
  -- guardado en la tina.
  CREATE TABLE IF NOT EXISTS movimientos_envasado (
    id           INTEGER PRIMARY KEY,
    client_id    TEXT NOT NULL UNIQUE,
    fecha_hora   TEXT NOT NULL,
    origen       TEXT NOT NULL DEFAULT 'online',
    sincronizado TEXT,
    operario_id  INTEGER NOT NULL REFERENCES operarios(id),
    tina_id      INTEGER NOT NULL REFERENCES tinas(id),
    cantidad     INTEGER NOT NULL,
    anulado      INTEGER NOT NULL DEFAULT 0,
    anulado_en   TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_envasado_tina ON movimientos_envasado(tina_id);

  -- Maduracion. Se registra la ENTRADA a la camara, no la produccion: el audio dice
  -- "se cuando entraron, se cuantos dias tienen los pategras de maduracion" [A5 00:43].
  -- La diferencia importa: entre producir y madurar hay saladero, y contar esos dias
  -- como maduracion haria que el sistema declare apto un queso que todavia esta verde.
  CREATE TABLE IF NOT EXISTS movimientos_maduracion (
    id           INTEGER PRIMARY KEY,
    client_id    TEXT NOT NULL UNIQUE,
    fecha_hora   TEXT NOT NULL,
    origen       TEXT NOT NULL DEFAULT 'online',
    sincronizado TEXT,
    operario_id  INTEGER NOT NULL REFERENCES operarios(id),
    tina_id      INTEGER NOT NULL REFERENCES tinas(id),
    tipo         TEXT NOT NULL CHECK (tipo IN ('entrada', 'salida')),
    cantidad     INTEGER NOT NULL,
    -- Dias que efectivamente estuvo, calculados al salir. Guardarlo cerrado evita
    -- recalcularlo despues y permite comparar lo REAL contra lo teorico.
    dias_reales  INTEGER,
    anulado      INTEGER NOT NULL DEFAULT 0,
    anulado_en   TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_maduracion_tina ON movimientos_maduracion(tina_id);
`)

// Migracion de columnas nuevas sobre bases que ya existen. SQLite no tiene
// "ADD COLUMN IF NOT EXISTS", asi que se consulta el esquema antes de tocar nada.
const columnasDe = (tabla) =>
  db.prepare(`PRAGMA table_info(${tabla})`).all().map((c) => c.name)

function agregarColumna(tabla, nombre, definicion) {
  if (!columnasDe(tabla).includes(nombre)) {
    db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${nombre} ${definicion}`)
  }
}

// madura: si el queso pasa o no por camara de maduracion.
// Los tres dias definen cuatro estados en pantalla (falta / apto / optimo / pasado);
// un solo numero solo puede decir si o no, y falla justo en los bordes.
// dias_provisorios: los valores son de referencia hasta que el maestro quesero los
// confirme. La pantalla lo dice explicitamente - un numero inventado que se presenta
// como cierto quema la credibilidad de todo el sistema.
agregarColumna('tipos_queso', 'madura', 'INTEGER NOT NULL DEFAULT 0')
agregarColumna('tipos_queso', 'dias_minimos', 'INTEGER')
agregarColumna('tipos_queso', 'dias_optimos', 'INTEGER')
agregarColumna('tipos_queso', 'dias_maximos', 'INTEGER')
agregarColumna('tipos_queso', 'dias_provisorios', 'INTEGER NOT NULL DEFAULT 1')

// Equivalencia de un pallet en litros, confirmada por el cliente (2026-09-13):
// 70 cajas de 12 litros = 840 litros por pallet.
//
// Va por PRODUCTO y no como constante global aunque hoy los tres valores sean
// iguales: el dia que la Largavida venga en otra caja, es un cambio de dato y no de
// codigo. Cuesta lo mismo ahora.
agregarColumna('productos', 'cajas_por_pallet', 'INTEGER NOT NULL DEFAULT 70')
agregarColumna('productos', 'litros_por_caja', 'INTEGER NOT NULL DEFAULT 12')

// Los litros se CONGELAN en cada registro, no se calculan al mostrarlos.
//
// Si el ano que viene cambia el tamano de la caja y el calculo fuera en vivo, todos
// los pallets historicos se recalcularian con el numero nuevo: los reportes del ano
// pasado cambiarian solos y dejarian de coincidir con lo que se facturo. El registro
// guarda la equivalencia que era cierta el dia que se armo.
agregarColumna('registros_pallet', 'litros', 'INTEGER')

// Los pallets ya cargados quedaron sin litros: se completan una sola vez con la
// equivalencia vigente de su producto.
const pendientes = db
  .prepare('SELECT COUNT(*) n FROM registros_pallet WHERE litros IS NULL')
  .get().n
if (pendientes) {
  db.prepare(`
    UPDATE registros_pallet
       SET litros = (
         SELECT p.cajas_por_pallet * p.litros_por_caja
           FROM productos p WHERE p.id = registros_pallet.producto_id
       )
     WHERE litros IS NULL
  `).run()
  console.log(`  ${pendientes} pallets completados con su equivalencia en litros`)
}

export const ahora = () => new Date().toISOString()
