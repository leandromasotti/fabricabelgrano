// El tybo no va a cámara de maduración.
//
//   "El queso tybo No debe aparecer en Maduracion, es un queso barra que funciona como
//    el cremoso."  — el cliente, 2026-09-24
//
// Venía con `madura = 1` y días de referencia de semiduro (25/40/65), cargados por el
// seed como punto de partida para que el sistema arrancara mostrando algo. Esos días
// nunca salieron de la fábrica, y el flag hacía que el tybo apareciera en la tablet de
// maduración esperando entrar a cámara.
//
// Ojo con los tres flags, que son tres preguntas distintas:
//
//   madura                   -> ¿aparece en la tablet de maduración?
//   madura_antes_de_envasar  -> ¿esa maduración bloquea el envasado?
//   pasa_por_sal             -> ¿va al saladero?
//
// El tybo ya tenía `madura_antes_de_envasar = 0` desde la migración 004, así que su
// circuito de envasado ya era el correcto (sal → espera envasado). Lo que faltaba era
// sacarlo de la cámara.
//
//   node migraciones/005-tybo-no-madura.js               -> muestra qué haría
//   node migraciones/005-tybo-no-madura.js --confirmar   -> aplica

import { db, motor } from './../server/db.js'

const confirmar = process.argv.includes('--confirmar')

function destino() {
  if (motor !== 'postgres') return 'SQLite (data/fabrica.db)'
  const u = new URL(process.env.DATABASE_URL)
  const local = ['localhost', '127.0.0.1', '::1', 'host.docker.internal'].includes(u.hostname)
  return `PostgreSQL en ${u.host}${u.pathname}${local ? '' : '  ← REMOTA'}`
}

const bool = (v) => v === 1 || v === true

console.log(`\nBase: ${destino()}`)
console.log(confirmar ? 'Modo: APLICANDO\n' : 'Modo: simulación (agregá --confirmar para aplicar)\n')

const tybo = await db
  .prepare(
    `SELECT id, nombre, madura, madura_antes_de_envasar, pasa_por_sal,
            dias_minimos, dias_optimos, dias_maximos
       FROM tipos_queso WHERE nombre = ?`,
  )
  .get('Tybo')

if (!tybo) {
  console.log('  No hay ningún queso llamado "Tybo" en esta base. Nada que hacer.\n')
  process.exit(0)
}

// Si ya había tinas de tybo en cámara, el cambio NO las borra: los movimientos quedan y
// el historial los sigue mostrando. Lo que cambia es que no entran más.
const enCamara = await db
  .prepare(
    `SELECT COUNT(*) AS n FROM movimientos_maduracion m
       JOIN tinas t ON t.id = m.tina_id
      WHERE t.tipo_queso_id = ? AND m.anulado = 0`,
  )
  .get(tybo.id)

if (!bool(tybo.madura)) {
  console.log('  ya estaba   el tybo no madura')
} else {
  console.log(`  ${confirmar ? 'hecho      ' : 'HARÍA      '} sacar el tybo de maduración`)
  console.log(`              madura: sí -> no · días ${tybo.dias_minimos}/${tybo.dias_optimos}/${tybo.dias_maximos} -> sin días`)
  if (Number(enCamara.n) > 0) {
    console.log(`              ⚠️  hay ${enCamara.n} movimiento(s) de cámara de tybo ya registrados:`)
    console.log('                  NO se tocan, siguen en el historial. Lo que cambia es que no entra más.')
  }
  if (confirmar) {
    // dias_provisorios = 1 porque los días que había eran de referencia, no de la
    // fábrica, y al no madurar dejan de significar algo.
    await db
      .prepare(
        `UPDATE tipos_queso
            SET madura = 0, dias_minimos = NULL, dias_optimos = NULL, dias_maximos = NULL,
                dias_provisorios = 1
          WHERE id = ?`,
      )
      .run(tybo.id)
  }
}

if (confirmar || !bool(tybo.madura)) {
  const quesos = await db
    .prepare(
      `SELECT nombre, madura, madura_antes_de_envasar, pasa_por_sal
         FROM tipos_queso WHERE activo = 1 ORDER BY orden, nombre`,
    )
    .all()
  console.log('\nQuiénes entran a la cámara de maduración:')
  for (const q of quesos) {
    if (!bool(q.madura)) continue
    console.log(
      `  ${String(q.nombre).padEnd(20)} ${bool(q.madura_antes_de_envasar) ? 'desnudo, bloquea el envasado' : 'después de envasarse'}`,
    )
  }
  console.log('\nY los que NO van a cámara:')
  console.log('  ' + quesos.filter((q) => !bool(q.madura)).map((q) => q.nombre).join(' · ') + '\n')
}

if (!confirmar && bool(tybo.madura)) console.log('\nVolvé a correrlo con --confirmar.\n')

process.exit(0)
