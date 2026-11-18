// Imprime los datos maestros de la base a la que apunte .env.local.
//
//   node --env-file-if-exists=.env.local herramientas/ver-maestros.mjs
//
// No escribe nada. Existe para contestar una pregunta que aparece cada vez que hay más
// de una base dando vueltas: ¿esta base tiene los datos reales de la fábrica, o todavía
// tiene los placeholders del seed? Mirar las pantallas no alcanza — un "Operario 1" se
// ve igual de bien que un nombre real hasta que el operario lo busca y no está.
//
// Al final cuenta la producción registrada, porque es lo que decide si los maestros se
// pueden corregir de prepo o hay que hacerlo con cuidado: una tabla sin movimientos se
// rehace, una con movimientos se edita.

import { db, motor } from '../server/db.js'

const titulo = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 56 - t.length))}`)

// Varias tablas aparecieron en migraciones, así que una base vieja puede no tenerlas.
// Preguntar y seguir es más útil que plantarse: el resto del informe igual sirve.
async function filas(sql) {
  try {
    return await db.prepare(sql).all()
  } catch {
    return null
  }
}

async function tabla(nombre, sql, pintar) {
  titulo(nombre)
  const f = await filas(sql)
  if (f === null) return console.log('  (no existe en esta base)')
  if (!f.length) return console.log('  (vacía)')
  for (const x of f) console.log('  ' + pintar(x))
  console.log(`  — ${f.length} fila${f.length === 1 ? '' : 's'}`)
}

const si = (v) => (v === true || v === 1 ? '' : '  (de baja)')

console.log(`\nDatos maestros — motor: ${motor}`)

titulo('operarios')
const ops = await filas('SELECT sector, nombre, activo, orden FROM operarios ORDER BY sector, orden, nombre')
if (!ops || !ops.length) console.log('  (vacía)')
else {
  let actual = null
  for (const o of ops) {
    if (o.sector !== actual) console.log(`\n  ${(actual = o.sector)}`)
    console.log(`    ${o.nombre}${si(o.activo)}`)
  }
  console.log(`\n  — ${ops.length} operarios`)
  const placeholders = ops.filter((o) => /^(Operario|Yogurtero|Recepción|Quesero|Salador|Armador|Envasador|Madurador) \d+$/.test(o.nombre))
  if (placeholders.length) {
    console.log(`  OJO: ${placeholders.length} son placeholders del seed, no personas de la fábrica`)
  }
}

await tabla('tambos', 'SELECT numero, nombre, activo, ocasional FROM tambos ORDER BY orden, numero',
  (t) => `${String(t.numero).padStart(3)}  ${t.nombre ?? '(SIN NOMBRE)'}${t.ocasional === true || t.ocasional === 1 ? '  ocasional' : ''}${si(t.activo)}`)

await tabla('clientes', 'SELECT nombre, activo FROM clientes ORDER BY orden, nombre',
  (c) => `${c.nombre}${si(c.activo)}`)

await tabla('marcas', 'SELECT nombre, es_propia, activo FROM marcas ORDER BY orden',
  (m) => `${m.nombre}${m.es_propia === true || m.es_propia === 1 ? '  (propia)' : ''}${si(m.activo)}`)

await tabla('productos', 'SELECT nombre, familia, presentacion, activo FROM productos ORDER BY familia, orden',
  (p) => `${p.familia.padEnd(6)} ${p.nombre}  [${p.presentacion}]${si(p.activo)}`)

await tabla('envases', 'SELECT nombre, bultos_por_pallet, unidades_por_bulto, provisorio, activo FROM envases ORDER BY orden, nombre',
  (e) => `${(e.nombre ?? '').padEnd(24)} ${e.bultos_por_pallet ?? '?'} × ${e.unidades_por_bulto ?? '?'}${e.provisorio === true || e.provisorio === 1 ? '  provisorio' : ''}${si(e.activo)}`)

// El cartel de "días de referencia" sale SOLO en los que maduran: en un cremoso, que sale
// de sal y se envasa, la columna existe pero no quiere decir nada, y mostrarla ahí hace
// ruido en la única lista donde uno está buscando lo que sí falta confirmar.
await tabla('tipos_queso', 'SELECT nombre, familia, madura, dias_provisorios, activo FROM tipos_queso ORDER BY orden',
  (q) => `${(q.nombre ?? '').padEnd(22)} ${(q.familia ?? '').padEnd(9)}${(q.madura === true || q.madura === 1) && (q.dias_provisorios === true || q.dias_provisorios === 1) ? '  días de referencia' : ''}${si(q.activo)}`)

await tabla('motivos_recepcion', 'SELECT nombre, activo FROM motivos_recepcion ORDER BY orden', (m) => `${m.nombre}${si(m.activo)}`)
await tabla('motivos_yogur', 'SELECT nombre, es_perdida, activo FROM motivos_yogur ORDER BY orden',
  (m) => `${(m.nombre ?? '').padEnd(26)}${m.es_perdida === true || m.es_perdida === 1 ? 'pérdida' : ''}${si(m.activo)}`)

await tabla('opciones_tablet', 'SELECT clave, nombre, activo FROM opciones_tablet ORDER BY orden',
  (o) => `${o.clave.padEnd(12)} ${o.activo === true || o.activo === 1 ? 'ENCENDIDA' : 'apagada'}   ${o.nombre}`)

await tabla('tablero_secciones', 'SELECT clave, nombre, visible FROM tablero_secciones ORDER BY orden',
  (s) => `${s.clave.padEnd(12)} ${s.visible === true || s.visible === 1 ? 'se muestra' : 'OCULTA    '}   ${s.nombre}`)

titulo('producción registrada')
for (const t of ['recepciones', 'registros_pallet', 'registros_yogur', 'tinas', 'pedidos']) {
  const r = await filas(`SELECT COUNT(*) n FROM ${t}`)
  console.log(`  ${t.padEnd(18)} ${r === null ? '(no existe)' : r[0].n}`)
}
console.log()
process.exit(0)
