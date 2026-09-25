-- Fábrica Belgrano · esquema para PostgreSQL / Supabase
-- Traducción del esquema SQLite de server/db.js
--
-- ============================================================================
-- QUÉ CAMBIA RESPECTO DE SQLITE, Y POR QUÉ IMPORTA
-- ============================================================================
--
-- 1. LAS FECHAS DEJAN DE SER TEXTO.
--    En SQLite guardábamos strings ISO y calculábamos el día con
--    date(fecha_hora, 'localtime'), que depende de la zona horaria del proceso.
--    Eso ya nos costó un bug real: el reporte por rango se comía el día de hoy
--    porque una fecha se parseaba como UTC y se formateaba como local.
--    Acá son TIMESTAMPTZ y el día se calcula con la zona declarada explícitamente.
--
-- 2. LOS BOOLEANOS SON BOOLEANOS.
--    `anulado INTEGER` pasa a BOOLEAN. Menos lugar para un 2 que nadie esperaba.
--
-- 3. LOS DECIMALES SON NUMERIC, NO FLOAT.
--    Temperatura, pH y pesos van en NUMERIC con precisión declarada. Los REAL de
--    SQLite son punto flotante, y estos números terminan en liquidaciones a tambos
--    y en facturas. Es la misma razón por la que los pesos de pedidos se guardan
--    en gramos enteros.
--
-- 4. LAS CLAVES SON IDENTITY.
--    Sin AUTOINCREMENT implícito: GENERATED ALWAYS AS IDENTITY.
--
-- 5. client_id SIGUE SIENDO LA PIEZA CENTRAL.
--    Es UNIQUE en cada tabla de registro y es lo que hace idempotente la
--    sincronización: un registro que se reenvía se descarta en vez de duplicarse.
--    Con la base en la nube eso deja de ser solo la cola de la tablet y pasa a ser
--    el mecanismo de sync entre la fábrica y Supabase.

-- ============================================================================
-- ZONA HORARIA
-- ============================================================================
-- Todo "el día" del negocio es el día en Buenos Aires. Se declara una vez y se usa
-- en todas las agregaciones, en lugar de depender de la zona del servidor.

CREATE OR REPLACE FUNCTION dia_local(ts TIMESTAMPTZ)
RETURNS DATE
LANGUAGE sql IMMUTABLE
AS $$ SELECT (ts AT TIME ZONE 'America/Argentina/Buenos_Aires')::date $$;

COMMENT ON FUNCTION dia_local IS
  'El día calendario según la zona de la fábrica. La fábrica trabaja de 8 a 16, así '
  'que ningún turno cruza la medianoche y el día calendario es el día de trabajo.';

-- ============================================================================
-- CATÁLOGOS
-- ============================================================================

CREATE TABLE operarios (
  id      INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre  TEXT    NOT NULL,
  sector  TEXT    NOT NULL,
  activo  BOOLEAN NOT NULL DEFAULT true,
  orden   INTEGER NOT NULL DEFAULT 0,
  UNIQUE (nombre, sector)
);

COMMENT ON COLUMN operarios.activo IS
  'Se da de baja, nunca se borra: los registros históricos tienen que seguir '
  'mostrando el nombre de quien los hizo.';

CREATE TABLE marcas (
  id        INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre    TEXT    NOT NULL UNIQUE,
  es_propia BOOLEAN NOT NULL DEFAULT false,
  activo    BOOLEAN NOT NULL DEFAULT true,
  orden     INTEGER NOT NULL DEFAULT 0
);

-- Qué familia de producto hace cada marca. El yogur va en dos marcas: Obenac no
-- hace yogur. Va como tabla y no como flag para que sumar una marca o una familia
-- sea una fila y no un cambio de código.
CREATE TABLE marcas_familias (
  marca_id INTEGER NOT NULL REFERENCES marcas(id),
  familia  TEXT    NOT NULL,
  PRIMARY KEY (marca_id, familia)
);

CREATE TABLE productos (
  id                INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre            TEXT    NOT NULL,
  familia           TEXT    NOT NULL,         -- 'leche' | 'yogur'
  activo            BOOLEAN NOT NULL DEFAULT true,
  orden             INTEGER NOT NULL DEFAULT 0,
  -- Solo para yogur: el bin plástico es de 500 litros y entran ~500 sachets de 1 L,
  -- que pesan 1 kg cada uno. La cantidad VARÍA; 500 es el valor de trabajo acordado.
  unidades_por_bin  INTEGER,
  kilos_por_unidad  NUMERIC(6,3),
  datos_provisorios BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (nombre, familia)
);

-- Formatos en que se arma un pallet de leche. Los litros por pallet NO son fijos:
-- dependen del formato, y por eso el envase es una elección del operario en cada
-- pallet y no una propiedad del producto.
CREATE TABLE envases (
  id                 INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre             TEXT    NOT NULL UNIQUE,
  bultos_por_pallet  INTEGER,
  unidades_por_bulto INTEGER,
  litros_por_unidad  NUMERIC(6,3),
  provisorio         BOOLEAN NOT NULL DEFAULT true,
  activo             BOOLEAN NOT NULL DEFAULT true,
  orden              INTEGER NOT NULL DEFAULT 0,
  -- Los tres o ninguno: un formato a medias no puede calcular litros, y marcarlo
  -- confirmado sería mentir.
  CONSTRAINT envase_completo_o_vacio CHECK (
    (bultos_por_pallet IS NOT NULL AND unidades_por_bulto IS NOT NULL AND litros_por_unidad IS NOT NULL)
    OR provisorio = true
  )
);

-- Litros que da un pallet de este formato. Generada: no se puede desincronizar de
-- sus componentes, que es lo que pasaría con una columna calculada a mano.
ALTER TABLE envases ADD COLUMN litros_por_pallet INTEGER
  GENERATED ALWAYS AS (
    CASE WHEN bultos_por_pallet IS NULL OR unidades_por_bulto IS NULL OR litros_por_unidad IS NULL
         THEN NULL
         ELSE (bultos_por_pallet * unidades_por_bulto * litros_por_unidad)::INTEGER END
  ) STORED;

-- Los tres circuitos del queso, que el cliente dio el 2026-09-22. Ver
-- docs/12-circuitos-del-queso.md.
--
-- `pasa_por_sal` y `madura_antes_de_envasar` son dos preguntas INDEPENDIENTES, y juntas
-- deciden cuándo una tina queda disponible para envasar:
--
--   madura_antes_de_envasar  -> va a cámara desnudo; disponible al SALIR DE CÁMARA
--   pasa_por_sal             -> disponible al SALIR DE SAL
--   ninguna de las dos       -> de masa; disponible APENAS SE PRODUCE
--
-- `madura` NO es lo mismo que `madura_antes_de_envasar`: el cremoso y el tybo maduran,
-- pero después de envasarse, así que su maduración no bloquea el envasado. `madura` sirve
-- para el reporte de días de cámara; el otro, para el circuito.
CREATE TABLE tipos_queso (
  id                INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre            TEXT    NOT NULL UNIQUE,
  familia           TEXT    NOT NULL,         -- 'blando' | 'semiduro' | 'duro'
  se_envasa         BOOLEAN NOT NULL DEFAULT true,
  madura            BOOLEAN NOT NULL DEFAULT false,
  pasa_por_sal            BOOLEAN NOT NULL DEFAULT true,
  madura_antes_de_envasar BOOLEAN NOT NULL DEFAULT false,
  -- Tres días, no uno: un queso no pasa de "no apto" a "apto" de golpe. Con un solo
  -- umbral el sistema falla justo en los bordes, que es donde se decide.
  dias_minimos      INTEGER,
  dias_optimos      INTEGER,
  dias_maximos      INTEGER,
  dias_provisorios  BOOLEAN NOT NULL DEFAULT true,
  activo            BOOLEAN NOT NULL DEFAULT true,
  orden             INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT dias_coherentes CHECK (
    (dias_optimos IS NULL OR dias_minimos IS NULL OR dias_optimos >= dias_minimos)
    AND (dias_maximos IS NULL OR dias_optimos IS NULL OR dias_maximos >= dias_optimos)
  )
);

CREATE TABLE clientes (
  id     INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre TEXT    NOT NULL UNIQUE,
  activo BOOLEAN NOT NULL DEFAULT true,
  orden  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE tambos (
  id     INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  numero INTEGER NOT NULL UNIQUE,
  nombre TEXT,
  activo BOOLEAN NOT NULL DEFAULT true,
  orden  INTEGER NOT NULL DEFAULT 0
);

-- Por qué puede quedar observada una entrega de leche cruda: cortada, con olor, aguada.
--
-- Va como tabla y no como lista fija en el código porque la conoce la fábrica, no
-- nosotros. Y va como catálogo en vez de texto libre porque es lo que permite contar
-- ("¿qué tambo nos manda leche cortada seguido?"): tres operarios escribiendo "cortada",
-- "Cortada" y "venía cortada" son tres cosas distintas para una consulta.
CREATE TABLE motivos_recepcion (
  id     INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre TEXT    NOT NULL UNIQUE,
  activo BOOLEAN NOT NULL DEFAULT true,
  orden  INTEGER NOT NULL DEFAULT 0
);

-- ============================================================================
-- COLUMNAS COMUNES A TODO REGISTRO DE PLANTA
-- ============================================================================
-- Todas las tablas de registro repiten el mismo bloque:
--
--   client_id     UUID generado en la tablet, UNIQUE  -> idempotencia
--   fecha_hora    cuándo ocurrió el hecho
--   origen        'online' | 'offline'                -> confiabilidad de la hora
--   sincronizado  cuándo llegó al servidor
--   anulado       nunca se borra, se marca
--
-- No se factoriza en una tabla padre a propósito: la herencia de tablas en Postgres
-- complica las claves foráneas y los índices, y acá el costo de repetir cinco
-- columnas es menor que el de la indirección.

CREATE TYPE origen_registro AS ENUM ('online', 'offline');

COMMENT ON TYPE origen_registro IS
  '"offline" significa que la hora la puso la tablet (corregida con su desfasaje '
  'medido) porque no había red. No es un detalle técnico: cambia cuánto confiar en '
  'ese timestamp.';

-- ============================================================================
-- RECEPCIÓN DE LECHE CRUDA
-- ============================================================================

CREATE TABLE recepciones (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id     UUID        NOT NULL UNIQUE,
  fecha_hora    TIMESTAMPTZ NOT NULL,
  registrado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  origen        origen_registro NOT NULL DEFAULT 'online',
  sincronizado  TIMESTAMPTZ,
  operario_id   INTEGER     NOT NULL REFERENCES operarios(id),
  tambo_id      INTEGER     NOT NULL REFERENCES tambos(id),
  litros        INTEGER     NOT NULL,
  temperatura   NUMERIC(4,1),
  remito        TEXT,
  -- Qué tuvo de raro esta entrega. Las dos opcionales y casi siempre vacías: la leche
  -- que llega bien es la enorme mayoría. Por eso se cargan DESPUÉS de registrar, y el
  -- camino normal no paga ningún paso extra.
  motivo_id     INTEGER     REFERENCES motivos_recepcion(id),
  observacion   TEXT,
  anulado       BOOLEAN     NOT NULL DEFAULT false,
  anulado_en    TIMESTAMPTZ,
  -- El rango no es validación de tipo: atrapa el cero de más o de menos antes de
  -- que entre en una liquidación a un tambo.
  CONSTRAINT litros_razonables CHECK (litros BETWEEN 50 AND 60000),
  CONSTRAINT temperatura_razonable CHECK (temperatura IS NULL OR temperatura BETWEEN 0 AND 40)
);

CREATE INDEX ON recepciones (dia_local(fecha_hora));
CREATE INDEX ON recepciones (tambo_id);

-- ============================================================================
-- LECHERÍA
-- ============================================================================

CREATE TABLE registros_pallet (
  id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id    UUID        NOT NULL UNIQUE,
  fecha_hora   TIMESTAMPTZ NOT NULL,
  origen       origen_registro NOT NULL DEFAULT 'online',
  sincronizado TIMESTAMPTZ,
  operario_id  INTEGER     NOT NULL REFERENCES operarios(id),
  marca_id     INTEGER     NOT NULL REFERENCES marcas(id),
  producto_id  INTEGER     NOT NULL REFERENCES productos(id),
  envase_id    INTEGER     NOT NULL REFERENCES envases(id),
  -- Cuántos bultos (cajones, cajas, palanganas) entraron REALMENTE en este pallet y
  -- con cuántas unidades cada uno.
  --
  -- Se copian del formato en el alta y no se leen de él al mostrar, igual que `litros`.
  -- Un pallet no siempre es el formato completo: al final de la producción se arma uno
  -- con 20 cajones sueltos, y hay clientes que piden los cajones por 20 unidades en vez
  -- de 18 para meter más litros en el mismo camión. Guardarlo acá hace que el registro
  -- se explique solo — "15 × 18" — en vez de depender de un formato que alguien puede
  -- editar el mes que viene.
  bultos             INTEGER CHECK (bultos IS NULL OR bultos > 0),
  unidades_por_bulto INTEGER CHECK (unidades_por_bulto IS NULL OR unidades_por_bulto > 0),
  -- Congelado en el alta, no calculado al mostrar: si cambia el formato, los pallets
  -- históricos conservan la equivalencia que era cierta el día que se armaron.
  -- NULL es legítimo: el formato todavía no tiene sus números cargados.
  litros       INTEGER,
  anulado      BOOLEAN     NOT NULL DEFAULT false,
  anulado_en   TIMESTAMPTZ
);

CREATE INDEX ON registros_pallet (dia_local(fecha_hora));

CREATE TABLE registros_yogur (
  id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id    UUID        NOT NULL UNIQUE,
  fecha_hora   TIMESTAMPTZ NOT NULL,
  origen       origen_registro NOT NULL DEFAULT 'online',
  sincronizado TIMESTAMPTZ,
  operario_id  INTEGER     NOT NULL REFERENCES operarios(id),
  marca_id     INTEGER     NOT NULL REFERENCES marcas(id),
  producto_id  INTEGER     NOT NULL REFERENCES productos(id),
  unidades     INTEGER     NOT NULL CHECK (unidades > 0),
  kilos        NUMERIC(8,2),
  anulado      BOOLEAN     NOT NULL DEFAULT false,
  anulado_en   TIMESTAMPTZ
);

CREATE INDEX ON registros_yogur (dia_local(fecha_hora));

-- ============================================================================
-- QUESERÍA
-- ============================================================================

-- La tina es la unidad de producción, confirmada literal en el audio 3.
-- Modelar por tina deja abierta la pregunta B2: si algún día hace falta trazar la
-- pieza individual, las piezas cuelgan de la tina sin rehacer el esquema.
CREATE TABLE tinas (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id     UUID        NOT NULL UNIQUE,
  -- Fin de corte y prensado. Se usa para el control de pH, así que es un dato de
  -- proceso y no un metadato de auditoría.
  fecha_hora    TIMESTAMPTZ NOT NULL,
  origen        origen_registro NOT NULL DEFAULT 'online',
  sincronizado  TIMESTAMPTZ,
  operario_id   INTEGER     NOT NULL REFERENCES operarios(id),
  tipo_queso_id INTEGER     NOT NULL REFERENCES tipos_queso(id),
  -- Variable por tina: 117 / 120 / 124 según la altura de la masa. El sistema no
  -- puede asumir un rendimiento fijo.
  cantidad      INTEGER     NOT NULL CHECK (cantidad > 0),
  anulado       BOOLEAN     NOT NULL DEFAULT false,
  anulado_en    TIMESTAMPTZ
);

CREATE INDEX ON tinas (dia_local(fecha_hora));

-- ============================================================================
-- MOVIMIENTOS ENTRE ETAPAS
-- ============================================================================
-- Saladero, maduración y envasado son eventos que se suman, no estados guardados en
-- la tina. Así una tina puede entrar entera y salir en tandas sin que haya que
-- decidirlo de antemano.

CREATE TYPE tipo_movimiento AS ENUM ('entrada', 'salida');

CREATE TABLE movimientos_saladero (
  id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id    UUID        NOT NULL UNIQUE,
  fecha_hora   TIMESTAMPTZ NOT NULL,
  origen       origen_registro NOT NULL DEFAULT 'online',
  sincronizado TIMESTAMPTZ,
  operario_id  INTEGER     NOT NULL REFERENCES operarios(id),
  tina_id      INTEGER     NOT NULL REFERENCES tinas(id),
  tipo         tipo_movimiento NOT NULL,
  cantidad     INTEGER     NOT NULL CHECK (cantidad > 0),
  anulado      BOOLEAN     NOT NULL DEFAULT false,
  anulado_en   TIMESTAMPTZ
);

CREATE INDEX ON movimientos_saladero (tina_id);

-- El reloj de maduración arranca al ENTRAR a la cámara, no al producir: entre
-- producir y madurar hay saladero, y contar esos días declararía apto un queso verde.
CREATE TABLE movimientos_maduracion (
  id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id    UUID        NOT NULL UNIQUE,
  fecha_hora   TIMESTAMPTZ NOT NULL,
  origen       origen_registro NOT NULL DEFAULT 'online',
  sincronizado TIMESTAMPTZ,
  operario_id  INTEGER     NOT NULL REFERENCES operarios(id),
  tina_id      INTEGER     NOT NULL REFERENCES tinas(id),
  tipo         tipo_movimiento NOT NULL,
  cantidad     INTEGER     NOT NULL CHECK (cantidad > 0),
  -- Congelado al salir. Permite comparar lo REAL contra el número teórico y, con el
  -- tiempo, saber cuánto madura cada queso en esa cámara y en esa época del año.
  dias_reales  INTEGER,
  anulado      BOOLEAN     NOT NULL DEFAULT false,
  anulado_en   TIMESTAMPTZ
);

CREATE INDEX ON movimientos_maduracion (tina_id);

CREATE TABLE movimientos_envasado (
  id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id    UUID        NOT NULL UNIQUE,
  fecha_hora   TIMESTAMPTZ NOT NULL,
  origen       origen_registro NOT NULL DEFAULT 'online',
  sincronizado TIMESTAMPTZ,
  operario_id  INTEGER     NOT NULL REFERENCES operarios(id),
  tina_id      INTEGER     NOT NULL REFERENCES tinas(id),
  cantidad     INTEGER     NOT NULL CHECK (cantidad > 0),
  anulado      BOOLEAN     NOT NULL DEFAULT false,
  anulado_en   TIMESTAMPTZ
);

CREATE INDEX ON movimientos_envasado (tina_id);

-- ============================================================================
-- PEDIDOS
-- ============================================================================

CREATE TYPE estado_pedido AS ENUM ('pendiente', 'armando', 'listo', 'facturado');
CREATE TYPE origen_pedido AS ENUM ('encargado', 'tablet');

CREATE TABLE pedidos (
  id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id    UUID          NOT NULL UNIQUE,
  cliente_id   INTEGER       NOT NULL REFERENCES clientes(id),
  estado       estado_pedido NOT NULL DEFAULT 'pendiente',
  origen       origen_pedido NOT NULL DEFAULT 'encargado',
  creado_en    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  armado_en    TIMESTAMPTZ,
  armado_por   INTEGER       REFERENCES operarios(id),
  facturado_en TIMESTAMPTZ,
  nota         TEXT,
  anulado      BOOLEAN       NOT NULL DEFAULT false,
  anulado_en   TIMESTAMPTZ
);

CREATE INDEX ON pedidos (estado) WHERE anulado = false;

-- Una línea de pedido es de QUESO o de PRODUCTO (leche / yogur), nunca de las dos.
--
-- Son dos negocios distintos metidos en la misma tabla porque son la misma cosa para el
-- cliente —un renglón de su pedido— pero se cumplen de manera distinta:
--
--   queso  ->  tipo_queso_id             cantidad_pedida = piezas     cumple con pesos
--   leche  ->  producto + marca + envase  cantidad_pedida = bultos     cumple con cantidades
--   yogur  ->  producto + marca           cantidad_pedida = unidades   cumple con cantidades
--
-- El queso se pesa pieza por pieza porque cada uno pesa distinto. La leche no: un cartón
-- de 1 L es 1 L, y lo que puede variar es cuántos bultos se llegaron a preparar.
--
-- La leche se pide en CAJONES (confirmado 2026-09-22), no en pallets ni en litros. Es lo
-- que hace que elegir "Cajón lácteo x 18" o "x 20" signifique algo: el cliente que pide
-- x 20 mete más litros en el mismo camión.
CREATE TABLE pedido_lineas (
  id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pedido_id       INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  tipo_queso_id   INTEGER REFERENCES tipos_queso(id),
  producto_id     INTEGER REFERENCES productos(id),
  marca_id        INTEGER REFERENCES marcas(id),
  envase_id       INTEGER REFERENCES envases(id),
  cantidad_pedida INTEGER NOT NULL CHECK (cantidad_pedida > 0),
  CONSTRAINT pedido_lineas_una_clase CHECK (
    (tipo_queso_id IS NOT NULL AND producto_id IS NULL
     AND marca_id IS NULL AND envase_id IS NULL)
    OR
    (tipo_queso_id IS NULL AND producto_id IS NOT NULL AND marca_id IS NOT NULL)
  ),
  UNIQUE (pedido_id, tipo_queso_id)
);

COMMENT ON CONSTRAINT pedido_lineas_pedido_id_tipo_queso_id_key ON pedido_lineas IS
  'Un queso aparece una sola vez por pedido: si se carga dos veces se suma en la '
  'línea existente. Nadie tiene que buscar dos veces el mismo queso en la cámara.';

-- Lo mismo para leche y yogur. Va como índice parcial y no como UNIQUE de tabla porque
-- sólo aplica a las líneas de producto. COALESCE sobre envase_id porque NULL nunca es
-- igual a NULL: sin eso, dos líneas de yogur del mismo sabor y marca no chocarían.
CREATE UNIQUE INDEX pedido_lineas_producto_uk
    ON pedido_lineas (pedido_id, producto_id, marca_id, COALESCE(envase_id, 0))
 WHERE producto_id IS NOT NULL;

-- Una fila por pieza pesada. EN GRAMOS ENTEROS: sumar decimales en punto flotante
-- acumula error, y este número termina en una factura.
CREATE TABLE pedido_pesos (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id  UUID        NOT NULL UNIQUE,
  linea_id   INTEGER     NOT NULL REFERENCES pedido_lineas(id) ON DELETE CASCADE,
  gramos     INTEGER     NOT NULL CHECK (gramos BETWEEN 1 AND 200000),
  fecha_hora TIMESTAMPTZ NOT NULL,
  origen     origen_registro NOT NULL DEFAULT 'online',
  anulado    BOOLEAN     NOT NULL DEFAULT false,
  anulado_en TIMESTAMPTZ
);

CREATE INDEX ON pedido_pesos (linea_id);

-- Lo que el armador preparó de una línea de leche o yogur. Una fila por carga y no un
-- total en la línea, por lo mismo que los pesos son filas: da deshacer de a una, cola
-- offline idempotente por client_id, y a qué hora se preparó cada cosa. Un total pisado
-- pierde las tres.
--
-- Existe porque el armador puede entregar menos de lo pedido —"a lo último de la
-- producción puede pedir un pallet con 20 cajones solamente"— y la factura tiene que
-- salir por lo que salió del depósito, no por lo que se pidió.
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

-- ============================================================================
-- SEGURIDAD (Supabase)
-- ============================================================================
-- Sin RLS, la clave anónima de Supabase deja leer y escribir TODO desde cualquier
-- navegador. Se habilita en todas las tablas por defecto y las políticas se definen
-- según los roles reales, que todavía no están decididos.
--
-- Mientras tanto: RLS activo y sin políticas = nadie entra con la clave anónima, y
-- solo el service_role (el backend de la fábrica) puede escribir. Es el default
-- seguro: se abre a propósito, no por olvido.

ALTER TABLE operarios              ENABLE ROW LEVEL SECURITY;
ALTER TABLE marcas                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE marcas_familias        ENABLE ROW LEVEL SECURITY;
ALTER TABLE productos              ENABLE ROW LEVEL SECURITY;
ALTER TABLE envases                ENABLE ROW LEVEL SECURITY;
ALTER TABLE tipos_queso            ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE tambos                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE motivos_recepcion      ENABLE ROW LEVEL SECURITY;
ALTER TABLE recepciones            ENABLE ROW LEVEL SECURITY;
ALTER TABLE registros_pallet       ENABLE ROW LEVEL SECURITY;
ALTER TABLE registros_yogur        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tinas                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimientos_saladero   ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimientos_maduracion ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimientos_envasado   ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos                ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedido_lineas          ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedido_pesos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedido_cantidades      ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------- opciones de tablet

-- Preferencias de las pantallas de planta.
--
-- Viven en la base y no en cada tablet porque son ocho equipos amurados en sectores
-- distintos: cambiar algo yendo máquina por máquina garantiza que queden desparejas y
-- que nadie sepa cuál quedó sin tocar.
CREATE TABLE opciones_tablet (
  clave       TEXT    PRIMARY KEY,
  nombre      TEXT    NOT NULL,
  descripcion TEXT,
  activo      BOOLEAN NOT NULL DEFAULT false,
  orden       INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE opciones_tablet ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------- tablero LED

-- Qué muestra la pantalla de planta.
--
-- El sistema se implementa por sectores y no todos arrancan juntos: mientras lechería
-- ya carga y quesería todavía no, una sección del tablero en cero no dice "no se
-- produjo", dice "esto no anda". Un tablero con tres números reales vale más que uno
-- con seis donde la mitad son ceros que nadie sabe interpretar.
--
-- No hay columna `orden`: los bloques tienen formas muy distintas —una fila de cifras,
-- cinco tarjetas iguales, una lista— y reordenarlos no es mover cajas. Prometerlo en el
-- esquema sería prometer algo que el layout no puede cumplir.
CREATE TABLE tablero_secciones (
  clave       TEXT    PRIMARY KEY,
  nombre      TEXT    NOT NULL,
  descripcion TEXT,
  visible     BOOLEAN NOT NULL DEFAULT true,
  -- El orden en que aparecen en la PANTALLA, para que la lista de configuración se lea
  -- igual que el tablero. No es editable: los bloques tienen formas muy distintas —una
  -- fila de cifras, cinco tarjetas iguales, una lista— y reordenarlos no es mover cajas.
  orden       INTEGER NOT NULL DEFAULT 0
);

-- RLS como en todas las demás: activada y sin políticas, que es el default seguro.
ALTER TABLE tablero_secciones ENABLE ROW LEVEL SECURITY;
