// Carga la lista real de operarios de un sector, sin tocar código.
//
//   npm run operarios                                    -> muestra los que hay
//   npm run operarios -- lecheria "Juan" "Carlos" "Nico" -> reemplaza los de lechería
//
// Los que estaban se dan de baja (activo = 0), no se borran: si alguno ya registró
// producción, sus registros tienen que seguir mostrando su nombre.
//
// Esto es un parche honesto hasta que exista el ABM de verdad. Alcanza para el piloto,
// donde la lista se carga una vez y no se toca más.

import { db } from './db.js'

const [, , sector, ...nombres] = process.argv

const listar = async () => {
  const filas = await db
    .prepare('SELECT sector, nombre, activo FROM operarios ORDER BY sector, orden, nombre')
    .all()
  let actual = null
  for (const f of filas) {
    if (f.sector !== actual) {
      actual = f.sector
      console.log(`\n  ${actual}`)
    }
    console.log(`    ${f.activo ? ' ' : '·'} ${f.nombre}${f.activo ? '' : '  (dado de baja)'}`)
  }
  console.log()
}

if (!sector) {
  console.log('Operarios cargados:')
  await listar()
  console.log('Para reemplazar los de un sector:')
  console.log('  npm run operarios -- lecheria "Juan Pérez" "Carlos Gómez"\n')
  console.log('Sectores: lecheria · queseria · saladero · maduracion · envasado · pedidos\n')
  process.exit(0)
}

const SECTORES = ['lecheria', 'yogures', 'recepcion', 'queseria', 'saladero', 'maduracion', 'envasado', 'pedidos']
if (!SECTORES.includes(sector)) {
  console.error(`Sector desconocido: "${sector}"`)
  console.error(`Tiene que ser uno de: ${SECTORES.join(', ')}`)
  process.exit(1)
}
if (!nombres.length) {
  console.error('Falta la lista de nombres.')
  console.error('  npm run operarios -- lecheria "Juan Pérez" "Carlos Gómez"')
  process.exit(1)
}

async function reemplazar() {
  // Baja, no borrado: los registros históricos tienen que seguir mostrando el nombre
  // de quien los hizo, aunque esa persona ya no trabaje más ahí.
  const bajas = (await db
    .prepare('UPDATE operarios SET activo = 0 WHERE sector = ? AND activo = 1')
    .run(sector)).changes

  const reactivar = db.prepare(
    'UPDATE operarios SET activo = 1, orden = ? WHERE sector = ? AND nombre = ?'
  )
  const insertar = db.prepare(
    'INSERT INTO operarios (nombre, sector, orden, activo) VALUES (?, ?, ?, 1)'
  )

  let nuevos = 0
  let vueltos = 0
  // for y no forEach: el callback de forEach no se puede esperar, y con el motor
  // asincronico las altas terminarian despues de que la funcion ya devolvio.
  for (const [i, nombre] of nombres.entries()) {
    // Si alguien vuelve, se reactiva el mismo registro: sus movimientos viejos siguen
    // atados a la misma persona y no aparece duplicado en los reportes.
    if ((await reactivar.run(i + 1, sector, nombre)).changes === 0) {
      await insertar.run(nombre, sector, i + 1)
      nuevos++
    } else {
      vueltos++
    }
  }
  return { bajas, nuevos, vueltos }
}

const r = await reemplazar()
console.log(`Sector "${sector}" actualizado:`)
console.log(`  ${nombres.length} operarios activos (${r.nuevos} nuevos, ${r.vueltos} reactivados)`)
if (r.bajas) console.log(`  ${r.bajas} dados de baja (sus registros históricos se conservan)`)
await listar()
