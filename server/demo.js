// Genera produccion de ejemplo para ver los reportes con volumen realista.
// NO correr contra la base de la fabrica: es solo para desarrollo y demos.
//   npm run demo            -> 30 dias
//   npm run demo -- 60      -> 60 dias

import { db, ahora } from './db.js'
import { randomUUID } from 'node:crypto'

const DIAS = Number(process.argv[2] ?? 30)

const operarios = await db.prepare('SELECT id, sector FROM operarios').all()
const porSector = (s) => operarios.filter((o) => o.sector === s)
const quesos = await db.prepare('SELECT id, nombre FROM tipos_queso').all()
const marcas = await db.prepare('SELECT id FROM marcas').all()
const productos = await db.prepare('SELECT id FROM productos').all()

if (!quesos.length || !porSector('queseria').length) {
  console.error('Falta el seed. Corré: npm run seed')
  process.exit(1)
}

const azar = (a) => a[Math.floor(Math.random() * a.length)]
const entre = (min, max) => min + Math.floor(Math.random() * (max - min + 1))

// Rinde base por queso, para que la variacion se parezca a la real: cada tina
// sale cerca del valor tipico pero nunca igual [A3 00:24].
const rindeBase = new Map(quesos.map((q) => [q.id, entre(60, 140)]))

const insTina = db.prepare(`
  INSERT INTO tinas (client_id, fecha_hora, origen, operario_id, tipo_queso_id, cantidad)
  VALUES (?, ?, 'online', ?, ?, ?)
`)
const insMov = db.prepare(`
  INSERT INTO movimientos_saladero (client_id, fecha_hora, origen, operario_id, tina_id, tipo, cantidad)
  VALUES (?, ?, 'online', ?, ?, ?, ?)
`)
const insPallet = db.prepare(`
  INSERT INTO registros_pallet (client_id, fecha_hora, origen, operario_id, marca_id, producto_id)
  VALUES (?, ?, 'online', ?, ?, ?)
`)

const iso = (d) => d.toISOString()

async function generar() {
  let tinas = 0
  let piezas = 0
  let pallets = 0

  for (let d = DIAS - 1; d >= 0; d--) {
    const dia = new Date()
    dia.setDate(dia.getDate() - d)
    if (dia.getDay() === 0) continue // domingo no se produce

    // --- queseria: 3 a 7 tinas por dia, entre las 6 y las 13 ---
    for (let i = 0; i < entre(3, 7); i++) {
      const queso = azar(quesos)
      const base = rindeBase.get(queso.id)
      const cantidad = Math.max(1, base + entre(-6, 6)) // la variacion del rinde
      const prod = new Date(dia)
      prod.setHours(entre(6, 13), entre(0, 59), 0, 0)

      const info = await insTina.run(randomUUID(), iso(prod), azar(porSector('queseria')).id, queso.id, cantidad)
      tinas++
      piezas += cantidad

      // --- saladero: casi todas entran el mismo dia, 2 a 6 h despues ---
      if (Math.random() < 0.9) {
        const entrada = new Date(prod.getTime() + entre(120, 360) * 60000)
        await insMov.run(randomUUID(), iso(entrada), azar(porSector('saladero')).id, info.lastInsertRowid, 'entrada', cantidad)

        // y salen uno a tres dias despues, salvo las que siguen adentro
        if (d > 3 && Math.random() < 0.85) {
          const salida = new Date(entrada.getTime() + entre(1, 3) * 864e5)
          await insMov.run(randomUUID(), iso(salida), azar(porSector('saladero')).id, info.lastInsertRowid, 'salida', cantidad)
        }
      }
    }

    // --- lecheria: 8 a 20 pallets por dia ---
    for (let i = 0; i < entre(8, 20); i++) {
      const p = new Date(dia)
      p.setHours(entre(5, 17), entre(0, 59), 0, 0)
      await insPallet.run(randomUUID(), iso(p), azar(porSector('lecheria')).id, azar(marcas).id, azar(productos).id)
      pallets++
    }
  }
  return { tinas, piezas, pallets }
}

const r = await generar()
console.log(`Demo generada sobre ${DIAS} días:`)
console.log(`  tinas:   ${r.tinas}`)
console.log(`  piezas:  ${r.piezas}`)
console.log(`  pallets: ${r.pallets}`)
console.log(`  (${ahora()})`)
