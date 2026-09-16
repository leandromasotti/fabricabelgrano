// Genera el INSERT de los datos actuales de SQLite en formato PostgreSQL.
//
//   node migraciones/migrar-desde-sqlite.js > migraciones/datos.sql
//   psql -d fabrica_belgrano -f migraciones/datos.sql
//
// No usa ningún cliente de Postgres a propósito: emite SQL de texto. Así el mismo
// archivo sirve para el Postgres de Docker, para Supabase y para cualquier otro, sin
// depender de credenciales ni de una librería más.

import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const db = new Database(process.env.DB_PATH ?? join(root, 'data', 'fabrica.db'), { readonly: true })

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Los client_id de las tablets son UUID, pero los datos de prueba y de demo tienen
// strings arbitrarios ('test-aaa', 'hoja-1757...'). La columna en Postgres es UUID
// porque es el tipo correcto, así que a los que no lo son se les deriva uno del propio
// string: determinístico, así reejecutar la migración no duplica nada.
const comoUuid = (v) => {
  if (v == null) return null
  if (UUID.test(v)) return v.toLowerCase()
  const h = createHash('md5').update(v).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

const cita = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)
const bool = (v) => (v == null ? 'NULL' : v ? 'true' : 'false')
const num = (v) => (v == null ? 'NULL' : String(v))

// Las tablas en orden de dependencia: una FK nunca apunta a algo que todavía no está.
const TABLAS = [
  { t: 'operarios', cols: { id: num, nombre: cita, sector: cita, activo: bool, orden: num } },
  { t: 'marcas', cols: { id: num, nombre: cita, es_propia: bool, activo: bool, orden: num } },
  { t: 'marcas_familias', cols: { marca_id: num, familia: cita } },
  { t: 'productos', cols: {
      id: num, nombre: cita, familia: cita, activo: bool, orden: num,
      unidades_por_bin: num, kilos_por_unidad: num, datos_provisorios: bool,
    } },
  { t: 'envases', cols: {
      id: num, nombre: cita, bultos_por_pallet: num, unidades_por_bulto: num,
      litros_por_unidad: num, provisorio: bool, activo: bool, orden: num,
    } },
  { t: 'tipos_queso', cols: {
      id: num, nombre: cita, familia: cita, se_envasa: bool, madura: bool,
      dias_minimos: num, dias_optimos: num, dias_maximos: num,
      dias_provisorios: bool, activo: bool, orden: num,
    } },
  { t: 'clientes', cols: { id: num, nombre: cita, activo: bool, orden: num } },
  { t: 'tambos', cols: { id: num, numero: num, nombre: cita, activo: bool, orden: num } },

  { t: 'recepciones', cols: {
      id: num, client_id: (v) => cita(comoUuid(v)), fecha_hora: cita, registrado_en: cita,
      origen: cita, sincronizado: cita, operario_id: num, tambo_id: num,
      litros: num, temperatura: num, remito: cita, anulado: bool, anulado_en: cita,
    } },
  { t: 'registros_pallet', cols: {
      id: num, client_id: (v) => cita(comoUuid(v)), fecha_hora: cita, origen: cita,
      sincronizado: cita, operario_id: num, marca_id: num, producto_id: num,
      envase_id: num, litros: num, anulado: bool, anulado_en: cita,
    } },
  { t: 'registros_yogur', cols: {
      id: num, client_id: (v) => cita(comoUuid(v)), fecha_hora: cita, origen: cita,
      sincronizado: cita, operario_id: num, marca_id: num, producto_id: num,
      unidades: num, kilos: num, anulado: bool, anulado_en: cita,
    } },
  { t: 'tinas', cols: {
      id: num, client_id: (v) => cita(comoUuid(v)), fecha_hora: cita, origen: cita,
      sincronizado: cita, operario_id: num, tipo_queso_id: num, cantidad: num,
      anulado: bool, anulado_en: cita,
    } },
  { t: 'movimientos_saladero', cols: {
      id: num, client_id: (v) => cita(comoUuid(v)), fecha_hora: cita, origen: cita,
      sincronizado: cita, operario_id: num, tina_id: num, tipo: cita, cantidad: num,
      anulado: bool, anulado_en: cita,
    } },
  { t: 'movimientos_maduracion', cols: {
      id: num, client_id: (v) => cita(comoUuid(v)), fecha_hora: cita, origen: cita,
      sincronizado: cita, operario_id: num, tina_id: num, tipo: cita, cantidad: num,
      dias_reales: num, anulado: bool, anulado_en: cita,
    } },
  { t: 'movimientos_envasado', cols: {
      id: num, client_id: (v) => cita(comoUuid(v)), fecha_hora: cita, origen: cita,
      sincronizado: cita, operario_id: num, tina_id: num, cantidad: num,
      anulado: bool, anulado_en: cita,
    } },
  { t: 'pedidos', cols: {
      id: num, client_id: (v) => cita(comoUuid(v)), cliente_id: num, estado: cita,
      origen: cita, creado_en: cita, armado_en: cita, armado_por: num,
      facturado_en: cita, nota: cita, anulado: bool, anulado_en: cita,
    } },
  // pedido_lineas se trata aparte: ver `lineasFusionadas`.
  { t: 'pedido_lineas', especial: 'lineas' },
  { t: 'pedido_pesos', cols: {
      id: num, client_id: (v) => cita(comoUuid(v)), linea_id: num, gramos: num,
      fecha_hora: cita, origen: cita, anulado: bool, anulado_en: cita,
    } },
]

// ---------------------------------------------------------------------------
// FUSIÓN DE LÍNEAS DUPLICADAS
// ---------------------------------------------------------------------------
// El esquema nuevo tiene UNIQUE (pedido_id, tipo_queso_id): un queso aparece una sola
// vez por pedido. SQLite lo permitía, y hay pedidos con el mismo queso dos veces.
//
// La primera versión de esta migración usaba ON CONFLICT DO NOTHING y descartaba la
// segunda línea EN SILENCIO — se perdían piezas pedidas. Lo correcto es SUMARLAS, que
// además es lo que hace la pantalla nueva cuando se carga dos veces el mismo queso.
//
// Y hay una trampa: pedido_pesos apunta a linea_id. Si una línea se fusiona, sus
// pesadas tienen que repuntar a la que queda, o la FK se rompe.

const lineasCrudas = db.prepare(`
  SELECT id, pedido_id, tipo_queso_id, cantidad_pedida FROM pedido_lineas ORDER BY id
`).all()

const porClave = new Map()
const remapeoLinea = new Map()   // id viejo -> id que sobrevive

for (const l of lineasCrudas) {
  const clave = `${l.pedido_id}:${l.tipo_queso_id}`
  const ya = porClave.get(clave)
  if (ya) {
    ya.cantidad_pedida += l.cantidad_pedida
    remapeoLinea.set(l.id, ya.id)
  } else {
    porClave.set(clave, { ...l })
    remapeoLinea.set(l.id, l.id)
  }
}
const lineasFusionadas = [...porClave.values()]
const fusionadas = lineasCrudas.length - lineasFusionadas.length

const salida = []
salida.push('-- Datos migrados desde SQLite. Generado por migraciones/migrar-desde-sqlite.js')
salida.push(`-- ${new Date().toISOString()}`)
salida.push('')
salida.push('BEGIN;')
salida.push('')

let total = 0
for (const { t, cols, especial } of TABLAS) {
  if (especial === 'lineas') {
    salida.push(`-- pedido_lineas: ${lineasFusionadas.length} filas` +
      (fusionadas ? ` (${fusionadas} duplicada(s) fusionada(s), sumando las cantidades)` : ''))
    for (const l of lineasFusionadas) {
      salida.push(
        'INSERT INTO pedido_lineas (id, pedido_id, tipo_queso_id, cantidad_pedida) ' +
        `OVERRIDING SYSTEM VALUE VALUES (${l.id}, ${l.pedido_id}, ${l.tipo_queso_id}, ` +
        `${l.cantidad_pedida}) ON CONFLICT DO NOTHING;`
      )
    }
    salida.push('')
    total += lineasFusionadas.length
    continue
  }

  const nombres = Object.keys(cols)
  let filas
  try {
    filas = db.prepare(`SELECT ${nombres.join(', ')} FROM ${t}`).all()
  } catch (e) {
    salida.push(`-- ${t}: ${e.message}`)
    continue
  }
  // Las pesadas de una línea fusionada tienen que apuntar a la que sobrevivió.
  if (t === 'pedido_pesos') {
    for (const f of filas) f.linea_id = remapeoLinea.get(f.linea_id) ?? f.linea_id
  }
  if (!filas.length) {
    salida.push(`-- ${t}: sin datos`)
    continue
  }

  salida.push(`-- ${t}: ${filas.length} filas`)
  // OVERRIDING SYSTEM VALUE es necesario porque las claves son GENERATED ALWAYS AS
  // IDENTITY: se conservan los ids originales para que las FK sigan apuntando bien.
  for (const f of filas) {
    const valores = nombres.map((n) => cols[n](f[n]))
    salida.push(
      `INSERT INTO ${t} (${nombres.join(', ')}) OVERRIDING SYSTEM VALUE ` +
      `VALUES (${valores.join(', ')}) ON CONFLICT DO NOTHING;`
    )
  }
  salida.push('')
  total += filas.length
}

// Las secuencias quedan donde las dejó la migración: sin esto, el primer INSERT nuevo
// intentaría usar el id 1 y chocaría con todo lo importado.
salida.push('-- Reposicionar las secuencias después de importar ids explícitos')
for (const { t, cols, especial } of TABLAS) {
  if (!especial && !('id' in cols)) continue
  salida.push(
    `SELECT setval(pg_get_serial_sequence('${t}','id'), ` +
    `COALESCE((SELECT MAX(id) FROM ${t}), 1), true);`
  )
}
salida.push('')
salida.push('COMMIT;')
salida.push(`-- total: ${total} filas`)
if (fusionadas) {
  salida.push(`-- ATENCIÓN: ${fusionadas} línea(s) de pedido duplicadas se fusionaron sumando cantidades`)
}

console.log(salida.join('\n'))
