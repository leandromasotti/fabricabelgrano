// Los datos maestros reales de la fábrica, en una base que arrancó con los placeholders.
//
//   node migraciones/010-maestros-reales.js               -> muestra qué haría
//   node migraciones/010-maestros-reales.js --confirmar   -> aplica
//
// QUÉ PASÓ
//
// El seed carga cada tabla SOLO si está vacía. La base de la planta se creó vacía el
// 2026-11-16, así que recibió exactamente lo que estaba escrito en el código: dieciséis
// operarios llamados "Operario 1", "Quesero 2", "Madurador 1", y seis tambos con número
// y sin nombre. Las listas reales —treinta y tres personas y dieciséis tambos— se habían
// cargado a mano desde /app/maestros durante dos meses, pero vivían en la base de
// Supabase, que no se migró y que además ya no existe.
//
// De ahí salen estas listas: del backup db_cluster-24-10-2026@00-44-28, que es la última
// copia que queda de esa base. El extracto crudo está en
// `instalacion en servidor/maestros-en-la-nube.txt`.
//
// POR QUÉ UNA MIGRACIÓN Y NO SOLO ARREGLAR EL SEED
//
// El seed también se arregla (ya no trae placeholders), pero eso sirve para la PRÓXIMA
// base que se cree. La que está instalada en la planta ya tiene las tablas llenas, y el
// seed no pisa una tabla que no está vacía — por diseño, porque pisar lo que el encargado
// cargó a mano sería peor. Para una base que ya existe hace falta esto.
//
// LO QUE NO TRAE, A PROPÓSITO
//
//   - CLIENTES. En la nube también eran "Cliente 1".."Cliente 5": la lista real nunca
//     se cargó en ningún lado. La tablet de pedidos no sirve hasta que exista.
//   - RECEPCIÓN. En la nube ese sector quedó con "Prueba alexis" y "Recepción 2". No hay
//     nombres reales que traer, así que los placeholders de recepción se dejan en pie:
//     sin ningún operario el sector no puede registrar nada, y eso es peor.
//   - LOS DÍAS DE MADURACIÓN COMO CONFIRMADOS. En la nube figuran con
//     dias_provisorios = 0, o sea "esto lo dictó la fábrica". Pero los números son
//     idénticos, dígito por dígito, a los valores de referencia que trae el seed: nadie
//     cambió ninguno. Lo más probable es que alguien haya destildado la casilla sin que
//     el maestro quesero dictara nada. Entre mostrar "días de referencia" de más y
//     afirmar que un dato está confirmado cuando no lo está, se elige lo primero.

import { db, motor } from './../server/db.js'

const confirmar = process.argv.includes('--confirmar')

function destino() {
  if (motor !== 'postgres') return `SQLite (${process.env.DB_PATH ?? 'data/fabrica.db'})`
  const u = new URL(process.env.DATABASE_URL)
  const local = ['localhost', '127.0.0.1', '::1', 'host.docker.internal'].includes(u.hostname)
  return `PostgreSQL en ${u.host}${u.pathname}${local ? '' : '  ← REMOTA'}`
}

// ------------------------------------------------------------------ las listas

// Las personas, por sector y en el orden en que estaban en la tablet. Son nombres de
// pila porque así los cargó la fábrica: el operario se busca a sí mismo en una lista de
// seis, no en un padrón.
//
// Hay nombres repetidos entre sectores (VALENTIN está en cinco) y eso está bien: son
// filas distintas, con UNIQUE (nombre, sector). Si dos personas del MISMO sector se
// llamaran igual, ahí sí habría que distinguirlas, y se hace desde /app/maestros.
const operarios = [
  ['lecheria', ['POCO', 'JULIAN', 'EMILIO', 'FRANCO', 'JAVIER', 'GASTON']],
  ['yogures', ['JULIAN', 'GASTON', 'FRANCO', 'AGUSTIN']],
  ['queseria', ['CRISTIAN', 'PABLO', 'VALENTIN', 'JUAN PABLO', 'SEBASTIAN', 'EDUARDO']],
  ['saladero', ['SEBASTIAN', 'VALENTIN', 'JUAN PABLO', 'CRISTIAN', 'PABLO', 'EDUARDO']],
  ['maduracion', ['EDUARDO', 'VALENTIN', 'SEBASTIAN', 'AGUSTIN', 'JUAN PABLO', 'CRISTIAN', 'PABLO']],
  ['envasado', ['ALEJANDRO', 'VALENTIN']],
  ['pedidos', ['AGUSTIN', 'VALENTIN']],
]

// Los que puso el seed para que el sistema arrancara mostrando algo. No son personas.
// Se los reconoce por la forma del nombre, que es justamente la que nadie tiene.
const ESPLACEHOLDER =
  /^(Operario|Yogurtero|Quesero|Salador|Armador|Envasador|Madurador|Recepción) \d+$/

// Los tambos, con el número que la fábrica les da en la planilla.
//
// OJO: el 11 y el 12 se llaman los dos "CERR H". Así estaban cargados. Dos renglones con
// el mismo texto en la pantalla de recepción es una elección a ciegas para el operario,
// así que convendría distinguirlos desde /app/maestros — pero inventarles un nombre acá
// sería peor que copiar lo que la fábrica escribió.
//
// MENENDEZ va como ocasional, que es como estaba: entrega de vez en cuando y aparece en
// "Otros tambos", no en la planilla diaria.
const tambos = [
  { numero: 2, nombre: 'SUSANA', orden: 1, ocasional: 0 },
  { numero: 4, nombre: 'MURUAGA', orden: 2, ocasional: 0 },
  { numero: 5, nombre: 'LA LUISA', orden: 3, ocasional: 0 },
  { numero: 9, nombre: 'MENENDEZ', orden: 4, ocasional: 1 },
  { numero: 10, nombre: 'TUMMER', orden: 5, ocasional: 0 },
  { numero: 7, nombre: 'ALCHIDAI', orden: 6, ocasional: 0 },
  { numero: 1, nombre: 'FINNEGAN', orden: 7, ocasional: 0 },
  { numero: 8, nombre: 'CESA', orden: 8, ocasional: 0 },
  { numero: 11, nombre: 'CERR H', orden: 9, ocasional: 0 },
  { numero: 12, nombre: 'CERR H', orden: 10, ocasional: 0 },
  { numero: 6, nombre: 'CERRILLO B', orden: 11, ocasional: 0 },
  { numero: 14, nombre: 'GROSSI', orden: 12, ocasional: 0 },
  { numero: 13, nombre: 'JULIVER', orden: 13, ocasional: 0 },
  { numero: 15, nombre: 'KIRO', orden: 14, ocasional: 0 },
  { numero: 3, nombre: 'WEIS FASON', orden: 15, ocasional: 0 },
  { numero: 20, nombre: 'YATASTO', orden: 16, ocasional: 0 },
]

// Las preferencias de pantalla que la fábrica ya había elegido una vez.
const seccionesOcultas = ['recepcion', 'pedidos', 'alertas']
const envasesDeBaja = ['Palangana 30', 'Bandejón de colores']

// ------------------------------------------------------- de quién hay registros

// Un operario que ya registró algo NO se borra: sus registros tienen que seguir
// mostrando quién los hizo. Uno que nunca registró nada sí, y conviene, porque un
// "Operario 1" dado de baja igual aparece en /app/maestros y confunde.
const DONDE_FIRMAN = [
  ['recepciones', 'operario_id'],
  ['registros_pallet', 'operario_id'],
  ['registros_yogur', 'operario_id'],
  ['tinas', 'operario_id'],
  ['movimientos_saladero', 'operario_id'],
  ['movimientos_maduracion', 'operario_id'],
  ['movimientos_envasado', 'operario_id'],
  ['pedidos', 'armado_por'],
]

async function conRegistros() {
  const ids = new Set()
  for (const [tabla, col] of DONDE_FIRMAN) {
    try {
      const f = await db
        .prepare(`SELECT DISTINCT ${col} AS id FROM ${tabla} WHERE ${col} IS NOT NULL`)
        .all()
      for (const x of f) ids.add(Number(x.id))
    } catch {
      // La tabla puede no existir en una base vieja. Que falte una no invalida el resto.
    }
  }
  return ids
}

const existeOperario = (nombre, sector) =>
  db.prepare('SELECT id FROM operarios WHERE nombre = ? AND sector = ?').get(nombre, sector)

// Los placeholders que siguen activos, sin contar los de recepción, que se quedan.
async function placeholdersVivos() {
  const todos = await db.prepare('SELECT id, nombre, sector FROM operarios WHERE activo = 1').all()
  return todos.filter((o) => ESPLACEHOLDER.test(o.nombre) && o.sector !== 'recepcion')
}

async function faltantes() {
  const faltan = []
  for (const [sector, nombres] of operarios) {
    for (const nombre of nombres) {
      if (!(await existeOperario(nombre, sector))) faltan.push(`${sector}/${nombre}`)
    }
  }
  return faltan
}

// ------------------------------------------------------------------- los pasos

const pasos = [
  {
    titulo: 'operarios: las personas reales de la fábrica',
    async hace_falta() {
      return (await faltantes()).length > 0 || (await placeholdersVivos()).length > 0
    },
    async detalle() {
      const faltan = await faltantes()
      const sobran = await placeholdersVivos()
      return `daría de alta ${faltan.length} persona(s) y sacaría ${sobran.length} placeholder(s)`
    },
    async aplica() {
      let altas = 0
      const insertar = db.prepare('INSERT INTO operarios (nombre, sector, orden) VALUES (?, ?, ?)')
      for (const [sector, nombres] of operarios) {
        for (const [i, nombre] of nombres.entries()) {
          const ya = await existeOperario(nombre, sector)
          if (ya) {
            // Ya estaba: se reactiva y se le fija el orden, sin tocar el id.
            await db.prepare('UPDATE operarios SET activo = 1, orden = ? WHERE id = ?').run(i + 1, ya.id)
          } else {
            await insertar.run(nombre, sector, i + 1)
            altas++
          }
        }
      }

      // Los placeholders. Se borran los que nunca firmaron nada; el resto queda de baja.
      const firmaron = await conRegistros()
      let borrados = 0
      let bajas = 0
      for (const o of await placeholdersVivos()) {
        if (firmaron.has(Number(o.id))) {
          await db.prepare('UPDATE operarios SET activo = 0 WHERE id = ?').run(o.id)
          bajas++
        } else {
          await db.prepare('DELETE FROM operarios WHERE id = ?').run(o.id)
          borrados++
        }
      }
      return `+${altas} persona(s) · ${borrados} placeholder(s) borrado(s) · ${bajas} dado(s) de baja por tener registros`
    },
  },

  {
    titulo: 'tambos: número y nombre, como en la planilla',
    async hace_falta() {
      for (const t of tambos) {
        const f = await db.prepare('SELECT nombre FROM tambos WHERE numero = ?').get(t.numero)
        if (!f || f.nombre !== t.nombre) return true
      }
      return false
    },
    async detalle() {
      let nuevos = 0
      let renombra = 0
      for (const t of tambos) {
        const f = await db.prepare('SELECT nombre FROM tambos WHERE numero = ?').get(t.numero)
        if (!f) nuevos++
        else if (f.nombre !== t.nombre) renombra++
      }
      return `daría de alta ${nuevos} y le pondría nombre a ${renombra}`
    },
    async aplica() {
      let nuevos = 0
      let actualizados = 0
      for (const t of tambos) {
        const f = await db.prepare('SELECT id FROM tambos WHERE numero = ?').get(t.numero)
        if (f) {
          await db
            .prepare('UPDATE tambos SET nombre = ?, orden = ?, ocasional = ?, activo = 1 WHERE id = ?')
            .run(t.nombre, t.orden, t.ocasional, f.id)
          actualizados++
        } else {
          await db
            .prepare('INSERT INTO tambos (numero, nombre, orden, ocasional) VALUES (?, ?, ?, ?)')
            .run(t.numero, t.nombre, t.orden, t.ocasional)
          nuevos++
        }
      }
      return `+${nuevos} nuevo(s) · ${actualizados} actualizado(s)`
    },
  },

  {
    titulo: 'pantallas: las preferencias que la fábrica ya había elegido',
    async hace_falta() {
      // `visible` va SIEMPRE por parámetro: no está en la lista de columnas booleanas que
      // traduce db-pg.js, así que un `visible = 1` literal llega crudo a Postgres y
      // revienta con "operator does not exist: boolean = integer". En SQLite andaría, que
      // es exactamente lo que hace que ese error aparezca recién en la planta.
      const marcadores = seccionesOcultas.map(() => '?').join(',')
      const s = await db
        .prepare(`SELECT COUNT(*) n FROM tablero_secciones WHERE clave IN (${marcadores}) AND visible = ?`)
        .get(...seccionesOcultas, true)
      if (Number(s.n) > 0) return true

      const h = await db.prepare('SELECT activo FROM opciones_tablet WHERE clave = ?').get('historial')
      if (h && !(h.activo === true || h.activo === 1)) return true

      const e = await db
        .prepare(`SELECT COUNT(*) n FROM envases WHERE nombre IN (${envasesDeBaja.map(() => '?').join(',')}) AND activo = 1`)
        .get(...envasesDeBaja)
      if (Number(e.n) > 0) return true

      const x = await db.prepare('SELECT provisorio FROM envases WHERE nombre = ?').get('Cajón lácteo x 20')
      return Boolean(x && (x.provisorio === true || x.provisorio === 1))
    },
    async detalle() {
      return (
        'ocultaría recepción/pedidos/alertas del tablero LED, encendería el historial en ' +
        'las tablets, daría de baja Palangana 30 y Bandejón, y confirmaría el cajón x 20'
      )
    },
    async aplica() {
      const hecho = []
      const cambio = (r) => Boolean(r?.rowCount || r?.changes)

      for (const clave of seccionesOcultas) {
        const r = await db.prepare('UPDATE tablero_secciones SET visible = ? WHERE clave = ?').run(false, clave)
        if (cambio(r)) hecho.push(`tablero: ${clave} oculta`)
      }
      if (cambio(await db.prepare('UPDATE opciones_tablet SET activo = 1 WHERE clave = ?').run('historial'))) {
        hecho.push('historial encendido')
      }
      for (const nombre of envasesDeBaja) {
        if (cambio(await db.prepare('UPDATE envases SET activo = 0 WHERE nombre = ?').run(nombre))) {
          hecho.push(`baja: ${nombre}`)
        }
      }
      if (cambio(await db.prepare('UPDATE envases SET provisorio = 0 WHERE nombre = ?').run('Cajón lácteo x 20'))) {
        hecho.push('cajón x 20 confirmado')
      }
      return hecho.join(' · ') || 'nada que cambiar'
    },
  },
]

// --------------------------------------------------------------------- correr

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
    console.log(`              ${await paso.detalle()}`)
    continue
  }
  console.log(`  hecho       ${paso.titulo}`)
  console.log(`              ${await paso.aplica()}`)
}

console.log(
  !pendientes
    ? '\nNo había nada que hacer: la base ya estaba al día.'
    : confirmar
      ? `\n${pendientes} paso(s) aplicado(s).`
      : `\n${pendientes} paso(s) pendiente(s). Volvé a correrlo con --confirmar.`,
)

console.log(`
Esto la migración NO lo resuelve, y queda pendiente:
  - CLIENTES: siguen siendo "Cliente 1".."Cliente 5". La lista real nunca se cargó, ni
    acá ni en la nube. La tablet de pedidos no sirve hasta que exista.
  - RECEPCIÓN: el sector sigue con placeholders, porque en la nube tampoco había nombres
    reales. Se cargan con:  npm run operarios -- recepcion "Nombre" "Otro"
  - LA MARCA: el código dice "Obenac" y en la nube figuraba "Obenak". Definilo con Alexis
    y corregilo desde /app/maestros; es una sola fila.
  - Los tambos 11 y 12 se llaman los dos "CERR H".
`)
process.exit(0)
