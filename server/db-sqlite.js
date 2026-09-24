import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dbPath = process.env.DB_PATH ?? join(root, 'data', 'fabrica.db')

mkdirSync(dirname(dbPath), { recursive: true })

const sqlite = new Database(dbPath)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')

// La API se expone ASÍNCRONA aunque better-sqlite3 sea sincrónico. No es un capricho:
// permite que index.js tenga un solo código para los dos motores. Con SQLite las
// promesas resuelven en el acto y no cuesta nada.
// better-sqlite3 rechaza los booleanos como parametro; Postgres los exige en las
// columnas BOOLEAN. Para que index.js pueda pasar true/false y funcionar con los dos,
// aca se convierten a 1/0 al ligar. Es el mismo criterio que con las fechas: la
// diferencia de motor se absorbe en el adaptador, no en la logica de arriba.
const aSqlite = (v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v)
const ligar = (a) =>
  a.length === 1 && a[0] !== null && typeof a[0] === 'object' && !Array.isArray(a[0])
    ? [Object.fromEntries(Object.entries(a[0]).map(([k, v]) => [k, aSqlite(v)]))]
    : a.map(aSqlite)

export const db = {
  prepare(sql) {
    const st = sqlite.prepare(sql)
    return {
      get: async (...a) => st.get(...ligar(a)),
      all: async (...a) => st.all(...ligar(a)),
      run: async (...a) => st.run(...ligar(a)),
    }
  },
  exec: async (sql) => sqlite.exec(sql),
  pragma: (p) => sqlite.pragma(p),
  // SQLite no necesita un cliente aparte: la transacción es sobre la misma conexión.
  async transaccion(fn) {
    sqlite.exec('BEGIN')
    try {
      const r = await fn(db)
      sqlite.exec('COMMIT')
      return r
    } catch (e) {
      sqlite.exec('ROLLBACK')
      throw e
    }
  },
  async cerrar() { sqlite.close() },
  // Solo para el backup, que necesita el handle crudo.
  _crudo: sqlite,
}

export const motor = 'sqlite'

sqlite.exec(`
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
  -- Una linea es de QUESO o de PRODUCTO (leche / yogur), nunca de las dos:
  --
  --   queso  ->  tipo_queso_id             cantidad_pedida = piezas     cumple con pesos
  --   leche  ->  producto + marca + envase  cantidad_pedida = bultos     cumple con cantidades
  --   yogur  ->  producto + marca           cantidad_pedida = unidades   cumple con cantidades
  --
  -- El queso se pesa pieza por pieza porque cada uno pesa distinto; la leche no, un
  -- carton de 1 L es 1 L. La leche se pide en CAJONES (confirmado 2026-09-22), que es lo
  -- que hace que elegir "x 18" o "x 20" signifique algo.
  CREATE TABLE IF NOT EXISTS pedido_lineas (
    id             INTEGER PRIMARY KEY,
    pedido_id      INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
    tipo_queso_id  INTEGER REFERENCES tipos_queso(id),
    producto_id    INTEGER REFERENCES productos(id),
    marca_id       INTEGER REFERENCES marcas(id),
    envase_id      INTEGER REFERENCES envases(id),
    cantidad_pedida INTEGER NOT NULL,
    CHECK (
      (tipo_queso_id IS NOT NULL AND producto_id IS NULL
       AND marca_id IS NULL AND envase_id IS NULL)
      OR
      (tipo_queso_id IS NULL AND producto_id IS NOT NULL AND marca_id IS NOT NULL)
    )
  );

  CREATE INDEX IF NOT EXISTS idx_lineas_pedido ON pedido_lineas(pedido_id);

  -- Un producto no se repite dentro del mismo pedido: si se carga dos veces se suma en
  -- la linea que ya existe. Va como indice parcial porque solo aplica a las lineas de
  -- producto. COALESCE sobre envase_id porque NULL nunca es igual a NULL, y sin eso dos
  -- lineas de yogur del mismo sabor y marca no chocarian.
  CREATE UNIQUE INDEX IF NOT EXISTS pedido_lineas_producto_uk
      ON pedido_lineas (pedido_id, producto_id, marca_id, COALESCE(envase_id, 0))
   WHERE producto_id IS NOT NULL;

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

  -- Lo que el armador preparo de una linea de leche o yogur. Una fila por carga y no un
  -- total en la linea, por lo mismo que los pesos son filas: deshacer de a una, cola
  -- offline idempotente por client_id, y a que hora se preparo cada cosa.
  CREATE TABLE IF NOT EXISTS pedido_cantidades (
    id        INTEGER PRIMARY KEY,
    client_id TEXT NOT NULL UNIQUE,
    linea_id  INTEGER NOT NULL REFERENCES pedido_lineas(id) ON DELETE CASCADE,
    cantidad  INTEGER NOT NULL,
    fecha_hora TEXT NOT NULL,
    origen    TEXT NOT NULL DEFAULT 'online',
    anulado   INTEGER NOT NULL DEFAULT 0,
    anulado_en TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_cantidades_linea ON pedido_cantidades(linea_id);

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

  -- Formatos en que se arma un pallet de leche. Un pallet es homogeneo: una marca, un
  -- tipo de leche, un envase. Pero el envase varia entre pallets, y por eso los litros
  -- por pallet NO son fijos — que era justamente el detalle que faltaba.
  --
  -- litros del pallet = bultos_por_pallet x unidades_por_bulto x litros_por_unidad
  CREATE TABLE IF NOT EXISTS envases (
    id                 INTEGER PRIMARY KEY,
    nombre             TEXT NOT NULL,
    bultos_por_pallet  INTEGER,
    unidades_por_bulto INTEGER,
    litros_por_unidad  REAL,
    -- 1 mientras los numeros sean estimados. La pantalla lo dice y el operario ve que
    -- ese formato todavia no esta confirmado.
    provisorio         INTEGER NOT NULL DEFAULT 1,
    activo             INTEGER NOT NULL DEFAULT 1,
    orden              INTEGER NOT NULL DEFAULT 0
  );

  -- Yogur. Se registra CAJA POR CAJA, no por pallet: es otra tablet y otro flujo.
  CREATE TABLE IF NOT EXISTS registros_yogur (
    id           INTEGER PRIMARY KEY,
    client_id    TEXT NOT NULL UNIQUE,
    fecha_hora   TEXT NOT NULL,
    origen       TEXT NOT NULL DEFAULT 'online',
    sincronizado TEXT,
    operario_id  INTEGER NOT NULL REFERENCES operarios(id),
    marca_id     INTEGER NOT NULL REFERENCES marcas(id),
    producto_id  INTEGER NOT NULL REFERENCES productos(id),
    -- Unidades de la caja y kilos equivalentes, CONGELADOS igual que los litros del
    -- pallet: si manana cambia el tamano de la caja, lo viejo no se reescribe.
    unidades     INTEGER NOT NULL,
    kilos        REAL,
    anulado      INTEGER NOT NULL DEFAULT 0,
    anulado_en   TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_yogur_fecha ON registros_yogur(fecha_hora);

  -- Que familia de producto hace cada marca. El yogur se produce en dos marcas y
  -- Obenac no lo hace; la leche la hacen las tres.
  --
  -- Va como tabla y no como un flag "hace_yogur" porque la regla real es "esta marca
  -- hace estas familias": si manana Obenac arranca con yogur, o aparece una cuarta
  -- marca que solo hace yogur, es una fila y no un cambio de codigo.
  -- Tambos: los proveedores de leche cruda. La fabrica los identifica por numero
  -- (se ven el 2, 4, 5, 6, 14 y 15 en la planilla).
  CREATE TABLE IF NOT EXISTS tambos (
    id     INTEGER PRIMARY KEY,
    numero INTEGER NOT NULL UNIQUE,
    nombre TEXT,
    activo INTEGER NOT NULL DEFAULT 1,
    orden  INTEGER NOT NULL DEFAULT 0
  );

  -- Recepcion de leche cruda. Es el inicio real del circuito: hasta ahora el sistema
  -- sabia cuantas piezas salian, pero no de cuanta leche.
  --
  -- Hoy el caudalimetro imprime un ticket y alguien lo tipea (no tiene salida de datos
  -- todavia; la fabrica esta trabajando en automatizarlo). Cuando la tenga, esta misma
  -- tabla recibe los datos sin cambios y la pantalla queda como respaldo.
  CREATE TABLE IF NOT EXISTS recepciones (
    id           INTEGER PRIMARY KEY,
    client_id    TEXT NOT NULL UNIQUE,
    -- Cuando ENTRO la leche. Es lo que importa para el pago y para el reporte diario.
    fecha_hora   TEXT NOT NULL,
    -- Cuando se cargo al sistema. Hoy suelen coincidir, pero si algun dia se cargan
    -- tickets atrasados la diferencia deja de ser cero y conviene poder verla.
    registrado_en TEXT NOT NULL,
    origen       TEXT NOT NULL DEFAULT 'online',
    sincronizado TEXT,
    operario_id  INTEGER NOT NULL REFERENCES operarios(id),
    tambo_id     INTEGER NOT NULL REFERENCES tambos(id),
    litros       INTEGER NOT NULL,
    -- La leche tiene que llegar fria: es un control de calidad, no un adorno.
    temperatura  REAL,
    -- Numero de remito del ticket. Opcional: los papelitos se guardan igual, y pedirlo
    -- en la tablet agregaria tipeo al unico momento en que hay que ser rapido.
    remito       TEXT,
    anulado      INTEGER NOT NULL DEFAULT 0,
    anulado_en   TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_recepciones_fecha ON recepciones(fecha_hora);
  CREATE INDEX IF NOT EXISTS idx_recepciones_tambo ON recepciones(tambo_id);

  CREATE TABLE IF NOT EXISTS marcas_familias (
    marca_id INTEGER NOT NULL REFERENCES marcas(id),
    familia  TEXT NOT NULL,
    PRIMARY KEY (marca_id, familia)
  );

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
  sqlite.prepare(`PRAGMA table_info(${tabla})`).all().map((c) => c.name)

function agregarColumna(tabla, nombre, definicion) {
  if (!columnasDe(tabla).includes(nombre)) {
    sqlite.exec(`ALTER TABLE ${tabla} ADD COLUMN ${nombre} ${definicion}`)
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
// Los dos ejes del circuito (2026-09-22). Ver docs/12-circuitos-del-queso.md.
//
//   madura_antes_de_envasar -> va a camara DESNUDO: disponible al salir de camara
//   pasa_por_sal            -> disponible al salir de sal
//   ninguna de las dos      -> de masa: disponible apenas se produce
//
// `madura` NO es lo mismo que `madura_antes_de_envasar`: el cremoso madura, pero despues
// de envasarse. Los defaults reproducen el comportamiento viejo.
agregarColumna('tipos_queso', 'pasa_por_sal', 'INTEGER NOT NULL DEFAULT 1')
agregarColumna('tipos_queso', 'madura_antes_de_envasar', 'INTEGER NOT NULL DEFAULT 0')

// Equivalencia de un pallet en litros, confirmada por el cliente (2026-09-13):
// 70 cajas de 12 litros = 840 litros por pallet.
//
// Va por PRODUCTO y no como constante global aunque hoy los tres valores sean
// iguales: el dia que la Largavida venga en otra caja, es un cambio de dato y no de
// codigo. Cuesta lo mismo ahora.
// OBSOLETAS: la equivalencia dejo de ser una propiedad del producto.
// Un mismo tipo de leche puede armarse en caja o en palangana y dar litros distintos,
// asi que el envase es una eleccion del operario en cada pallet (tabla `envases`).
// Se conservan solo para la migracion de los registros que ya existian.
agregarColumna('productos', 'cajas_por_pallet', 'INTEGER NOT NULL DEFAULT 70')
agregarColumna('productos', 'litros_por_caja', 'INTEGER NOT NULL DEFAULT 12')

// Yogur: el sachet se trabaja por kilos. El peso queda en NULL hasta que la fabrica
// lo confirme; mostrar un peso inventado seria peor que no mostrar nada.
agregarColumna('productos', 'kilos_por_unidad', 'REAL')
agregarColumna('productos', 'unidades_por_bin', 'INTEGER')

// El recipiente del yogur se llama BIN PLASTICO y tiene 500 litros de capacidad: por
// eso entran ~500 sachets de 1 litro. Se llamaba "caja" por una lectura mia del
// primer relevamiento; usar el nombre real importa porque es lo que el operario ve en
// la tablet y lo que dice cuando algo no cuadra.
if (columnasDe('productos').includes('unidades_por_caja')) {
  const viejos = sqlite.prepare('SELECT id, unidades_por_caja FROM productos WHERE unidades_por_caja IS NOT NULL').all()
  const pasar = sqlite.prepare('UPDATE productos SET unidades_por_bin = ? WHERE id = ? AND unidades_por_bin IS NULL')
  for (const f of viejos) pasar.run(f.unidades_por_caja, f.id)
  db.exec('ALTER TABLE productos DROP COLUMN unidades_por_caja')
  console.log('  columna unidades_por_caja renombrada a unidades_por_bin')
}
agregarColumna('productos', 'datos_provisorios', 'INTEGER NOT NULL DEFAULT 1')

// Los litros se CONGELAN en cada registro, no se calculan al mostrarlos.
//
// Si el ano que viene cambia el tamano de la caja y el calculo fuera en vivo, todos
// los pallets historicos se recalcularian con el numero nuevo: los reportes del ano
// pasado cambiarian solos y dejarian de coincidir con lo que se facturo. El registro
// guarda la equivalencia que era cierta el dia que se armo.
// Preferencias de las pantallas de planta. Viven en la base y no en cada tablet: son
// ocho equipos amurados y tocarlos uno por uno garantiza que queden desparejos.
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS opciones_tablet (
    clave       TEXT PRIMARY KEY,
    nombre      TEXT NOT NULL,
    descripcion TEXT,
    activo      INTEGER NOT NULL DEFAULT 0,
    orden       INTEGER NOT NULL DEFAULT 0
  );
`)

// Que muestra el tablero LED. El sistema se implementa por sectores y no todos
// arrancan juntos: una seccion en cero no dice "no se produjo", dice "esto no anda".
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS tablero_secciones (
    clave       TEXT PRIMARY KEY,
    nombre      TEXT NOT NULL,
    descripcion TEXT,
    visible     INTEGER NOT NULL DEFAULT 1,
    orden       INTEGER NOT NULL DEFAULT 0
  );
`)

agregarColumna('registros_pallet', 'litros', 'INTEGER')
// Cuantos bultos entraron REALMENTE en el pallet y con cuantas unidades cada uno.
// NULL en los registros viejos: se armaron antes de que existiera la distincion y no
// hay forma de saber si fueron completos. Se dejan como estan en vez de inventarles
// el formato de hoy, que es justo el error que ya cometimos una vez con los litros.
agregarColumna('registros_pallet', 'bultos', 'INTEGER')
agregarColumna('registros_pallet', 'unidades_por_bulto', 'INTEGER')
agregarColumna('registros_pallet', 'envase_id', 'INTEGER REFERENCES envases(id)')

// Relleno de los pallets ANTERIORES a que existieran los envases.
//
// La condicion es `envase_id IS NULL`, no `litros IS NULL`, y la diferencia importa:
// desde que el envase existe, un pallet con litros en nulo NO es un dato faltante, es
// un pallet armado en un formato cuya equivalencia todavia no se conoce (las
// palanganas). Rellenar esos con el valor del producto les inventaba 840 L en cada
// arranque del servidor, en silencio.
//
// Esos se completan solos cuando alguien carga el formato en /envases.html.
const legado = sqlite
  .prepare('SELECT COUNT(*) n FROM registros_pallet WHERE envase_id IS NULL AND litros IS NULL')
  .get().n
if (legado) {
  sqlite.prepare(`
    UPDATE registros_pallet
       SET litros = (
         SELECT p.cajas_por_pallet * p.litros_por_caja
           FROM productos p WHERE p.id = registros_pallet.producto_id
       )
     WHERE envase_id IS NULL AND litros IS NULL
  `).run()
  console.log(`  ${legado} pallets previos a los envases completados en litros`)
}

export const ahora = () => new Date().toISOString()
