// Backend PostgreSQL con la misma forma de API que better-sqlite3, pero asíncrona.
//
// POR QUÉ UN ADAPTADOR Y NO REESCRIBIR LAS CONSULTAS
// Hay 105 `db.prepare` y 154 llamadas a get/all/run repartidas en 51 endpoints.
// Reescribirlas a mano es 105 oportunidades de equivocarse en silencio. Traducir el
// dialecto en un solo lugar es una oportunidad, y cada regla queda documentada y
// probada una vez.
//
// Cuando las pantallas se rehagan en React, las consultas se van a escribir en
// Postgres nativo y este archivo desaparece. Mientras tanto hace que el sistema que ya
// funciona corra contra Postgres sin tocar la lógica.

import pg from 'pg'

const { Pool, types } = pg

// Por defecto pg devuelve NUMERIC como string (para no perder precisión en números
// gigantes). Acá los NUMERIC son temperaturas y kilos, que entran de sobra en un
// double, y todo el código de arriba espera números.
types.setTypeParser(types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)))
// BIGINT: los COUNT(*) vuelven como bigint y el código los compara con números.
types.setTypeParser(types.builtins.INT8, (v) => (v === null ? null : Number(v)))

// En serverless cada invocación puede ser un proceso nuevo, y cada proceso abre su
// propio pool. Diez conexiones por instancia × las instancias que el entorno decida
// levantar agota el límite de la base en minutos, y el síntoma no es un error claro:
// son timeouts intermitentes que parecen "la app anda lenta".
//
// Con una sola conexión por instancia y el pooler de la base del otro lado —Supabase
// expone uno en el puerto 6543, en modo transacción, hecho justamente para esto— el
// problema desaparece. En un servidor de verdad, que atiende ocho tablets a la vez desde
// un único proceso, el pool sí tiene sentido.
const serverless = Boolean(process.env.VERCEL ?? process.env.AWS_LAMBDA_FUNCTION_NAME)

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL ?? (serverless ? 1 : 10)),
  // Sin esto, una conexión que quedó abierta de una invocación anterior puede estar
  // muerta del otro lado y la primera consulta falla sola.
  idleTimeoutMillis: serverless ? 10_000 : 30_000,
  connectionTimeoutMillis: 10_000,
})

// Una conexión OCIOSA que se muere —Postgres que se reinicia, el firewall que corta un
// socket quieto, Docker que se actualiza— emite 'error' sobre el pool y no sobre
// ninguna consulta. Sin este listener, Node lo trata como excepción no atrapada y
// TERMINA EL PROCESO: la planta entera se queda sin sistema porque una conexión que
// nadie estaba usando se cayó sola.
//
// El pool descarta el cliente roto y abre otro cuando haga falta. Lo único que hay que
// hacer acá es dejar constancia y no morirse.
pool.on('error', (e) => {
  console.error('Conexión ociosa de PostgreSQL caída (el pool la reemplaza):', e.message)
})

// ---------------------------------------------------------------- traducción

const cache = new Map()

// Nombres de columnas booleanas. En SQLite eran 0/1 y las consultas dicen `= 1`;
// en Postgres son BOOLEAN de verdad y hay que comparar contra true/false.
//
// AGREGAR ACÁ CUALQUIER COLUMNA BOOLEANA NUEVA. Si falta, la consulta anda perfecto en
// SQLite y revienta en Postgres con "operator does not exist: boolean = integer" — o sea,
// pasa los tests locales y falla en producción. Pasó con `pasa_por_sal` y
// `madura_antes_de_envasar` el 2026-09-24.
//
// Las más largas van primero: `madura` antes que `madura_antes_de_envasar` funciona igual
// por backtracking, pero ponerlas al revés hace obvio que son dos columnas distintas.
const BOOLEANAS =
  'anulado|activo|provisorio|es_propia|se_envasa|madura_antes_de_envasar|madura|' +
  'pasa_por_sal|dias_provisorios|datos_provisorios'

function traducir(sql) {
  if (cache.has(sql)) return cache.get(sql)

  let s = sql

  // date(x, 'localtime')  ->  dia_local(x)::text
  //
  // El ::text es deliberado: todo el código de arriba compara y agrupa por strings
  // 'YYYY-MM-DD'. Como son ISO, el orden lexicográfico y el cronológico coinciden, así
  // que BETWEEN sigue funcionando. El costo es que no usa el índice por fecha — con
  // cientos de filas da igual, y cuando las consultas se reescriban nativas van a
  // comparar date contra date y sí lo van a usar.
  s = s.replace(/\bdate\s*\(\s*([^,()]+(?:\([^)]*\))?[^,()]*)\s*,\s*'localtime'\s*\)/gi,
    (_, expr) => `dia_local(${expr.trim()})::text`)

  // date(x, '-N days')  ->  resta de intervalo, devuelta como texto
  // El lado izquierdo de estas comparaciones ya es dia_local(...)::text, así que el
  // derecho también tiene que ser texto 'YYYY-MM-DD' para que comparen igual.
  s = s.replace(/\bdate\s*\(\s*([^,()]+)\s*,\s*'([+-]?\d+)\s+(day|days|month|months|year|years)'\s*\)/gi,
    (_, expr, n, unidad) =>
      `((${expr.trim()})::date ${n.startsWith('-') ? '-' : '+'} INTERVAL '${n.replace(/^[+-]/, '')} ${unidad}')::text`)

  // julianday(a) - julianday(b)  ->  diferencia en días
  // Se usa multiplicado por 1440 para obtener minutos, así que la unidad tiene que ser
  // el día, igual que en SQLite.
  s = s.replace(/\(\s*julianday\s*\(([^)]+(?:\([^)]*\))?[^)]*)\)\s*-\s*julianday\s*\(([^)]+)\)\s*\)/gi,
    (_, a, b) => `(EXTRACT(EPOCH FROM ((${a.trim()}) - (${b.trim()}))) / 86400.0)`)

  // Comparaciones booleanas: anulado = 0  ->  anulado = false
  s = s.replace(new RegExp(`\\b((?:\\w+\\.)?(?:${BOOLEANAS}))\\s*=\\s*([01])\\b`, 'gi'),
    (_, col, v) => `${col} = ${v === '1' ? 'true' : 'false'}`)
  // Y en los SET de los UPDATE, que el patrón de arriba ya cubre.

  // Filtro opcional: (? = '' OR col = ?)
  //
  // En SQLite todo es texto y comparar una columna con '' es inofensivo. En Postgres,
  // si `col` es un enum o un entero, ligar '' a ese tipo revienta ANTES de evaluar el
  // OR — el short-circuit no ayuda porque el bind pasa igual. Casteando la columna a
  // texto los dos lados son texto y '' simplemente no coincide con nada.
  s = s.replace(/\(\s*\?\s*=\s*''\s+OR\s+([\w.]+)\s*=\s*\?\s*\)/gi,
    (_, col) => `(? = '' OR ${col}::text = ?)`)
  s = s.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, 'INSERT INTO')
  // El OR IGNORE se convierte en ON CONFLICT DO NOTHING al final de la sentencia.
  if (/\bON CONFLICT\b/i.test(sql) === false && /INSERT\s+OR\s+IGNORE/i.test(sql)) {
    s = `${s.trimEnd().replace(/;?$/, '')} ON CONFLICT DO NOTHING`
  }

  // CAST(x AS INTEGER) existe en Postgres, pero INTEGER sobre NUMERIC redondea igual.
  // Se deja como está.

  cache.set(sql, s)
  return s
}

// Los parámetros: better-sqlite3 acepta posicionales (?) y con nombre (@nombre).
// Postgres solo acepta $1, $2...
function parametrizar(sql, args) {
  const conNombre = args.length === 1 && args[0] !== null && typeof args[0] === 'object' &&
                    !Array.isArray(args[0]) && !(args[0] instanceof Date)

  if (conNombre) {
    const obj = args[0]
    const valores = []
    // Cada aparición de @nombre recibe su PROPIO $n, aunque el nombre se repita. Un
    // placeholder compartido parece más prolijo, pero Postgres deduce un solo tipo por
    // parámetro: `unidades` se usa como entero en una columna y multiplicando un
    // NUMERIC en otra, y compartirlo falla con "inconsistent types deduced".
    const texto = sql.replace(/@(\w+)/g, (_, nombre) => {
      valores.push(obj[nombre] === undefined ? null : obj[nombre])
      return `$${valores.length}`
    })
    // Una consulta puede mezclar @nombre con ? (no pasa hoy, pero si pasara sería un
    // error silencioso feo).
    if (texto.includes('?')) {
      throw new Error('consulta con @nombre y ? mezclados: ' + sql.slice(0, 80))
    }
    return { texto, valores }
  }

  let i = 0
  const texto = sql.replace(/\?/g, () => `$${++i}`)
  return { texto, valores: args.slice(0, i) }
}

// ---------------------------------------------------------------- API

function sentencia(sqlOriginal, ejecutor) {
  const sql = traducir(sqlOriginal)
  const esInsert = /^\s*INSERT\b/i.test(sql)
  // better-sqlite3 devuelve lastInsertRowid; en Postgres hay que pedirlo.
  const conRetorno =
    esInsert && !/\bRETURNING\b/i.test(sql) ? `${sql.trimEnd().replace(/;$/, '')} RETURNING id` : sql

  // No todas las tablas tienen columna `id`: marcas_familias es clave compuesta. En vez
  // de mantener una lista a mano —que se desactualiza en cuanto alguien agrega una
  // tabla— se intenta con RETURNING y, si la columna no existe, se recuerda para esa
  // sentencia y no se vuelve a intentar. El error ocurre una vez y se corrige solo.
  let sinColumnaId = false

  const correr = async (args, usarRetorno) => {
    const conId = usarRetorno && !sinColumnaId
    const { texto, valores } = parametrizar(conId ? conRetorno : sql, args)
    try {
      return await ejecutor(texto, valores)
    } catch (e) {
      if (conId && e.code === '42703') {
        sinColumnaId = true
        const reintento = parametrizar(sql, args)
        return ejecutor(reintento.texto, reintento.valores)
      }
      // El SQL traducido es lo que hay que mirar cuando algo falla, no el original.
      e.message = `${e.message}
  SQL: ${texto.replace(/\s+/g, ' ').slice(0, 300)}`
      throw e
    }
  }

  return {
    async get(...args) {
      const r = await correr(args, false)
      return r.rows[0]
    },
    async all(...args) {
      const r = await correr(args, false)
      return r.rows
    },
    async run(...args) {
      const r = await correr(args, esInsert)
      return {
        changes: r.rowCount,
        lastInsertRowid: esInsert ? r.rows?.[0]?.id : undefined,
      }
    },
  }
}

export const db = {
  prepare: (sql) => sentencia(sql, (texto, valores) => pool.query(texto, valores)),
  exec: async (sql) => { await pool.query(sql) },
  pragma: () => {},   // no aplica

  // Transacción real: todas las sentencias de dentro van por el mismo cliente.
  async transaccion(fn) {
    const cliente = await pool.connect()
    try {
      await cliente.query('BEGIN')
      const dbTx = {
        prepare: (sql) => sentencia(sql, (texto, valores) => cliente.query(texto, valores)),
        exec: async (sql) => { await cliente.query(sql) },
      }
      const r = await fn(dbTx)
      await cliente.query('COMMIT')
      return r
    } catch (e) {
      await cliente.query('ROLLBACK')
      throw e
    } finally {
      cliente.release()
    }
  },

  async cerrar() { await pool.end() },
}

export const motor = 'postgres'
