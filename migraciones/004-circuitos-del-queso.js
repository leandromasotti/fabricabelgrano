// Los tres circuitos reales del queso, y la limpieza de catálogo que vino con ellos.
//
// Contexto completo en docs/12-circuitos-del-queso.md. Resumen:
//
// El código tenía UN eje —`madura`— y lo usaba para decidir cuándo un queso queda
// disponible para envasar. El cliente describió que en realidad son dos preguntas
// independientes:
//
//   ¿pasa por saladero?              -> las muzzarellas y el "por salut sin sal", no
//   ¿madura ANTES de envasarse?      -> sólo los 7 que van a cámara desnudos
//
// La distinción fina: Cremoso, Tybo y Provoleta SÍ maduran, pero DESPUÉS de envasarse.
// Con el modelo viejo (`madura = 1` -> exige salida de cámara) esos tres no aparecían
// nunca en la lista de envasado, porque esperaban una salida de cámara que en su circuito
// no ocurre. Era un bug latente que sólo se iba a ver el día del piloto de quesería.
//
// Además, del mismo intercambio con el cliente (2026-09-24):
//   - "Cremoso procesado" es un queso nuevo, del grupo de las muzzarellas
//   - "Mar del Plata" ES el Pategrás: el mismo queso con otro nombre
//   - Ricota y Cheddar no se están produciendo: van a baja
//
//   node migraciones/004-circuitos-del-queso.js               -> muestra qué haría
//   node migraciones/004-circuitos-del-queso.js --confirmar   -> aplica

import { db, motor } from './../server/db.js'

const confirmar = process.argv.includes('--confirmar')

function destino() {
  if (motor !== 'postgres') return 'SQLite (data/fabrica.db)'
  const u = new URL(process.env.DATABASE_URL)
  const local = ['localhost', '127.0.0.1', '::1', 'host.docker.internal'].includes(u.hostname)
  return `PostgreSQL en ${u.host}${u.pathname}${local ? '' : '  ← REMOTA'}`
}

// ---------------------------------------------------------------- los circuitos
//
// Fuente: mensajes de Alexis Giuliatti del 22/9 21:16–21:19, más las respuestas del 24/9.

const CIRCUITOS = {
  // Van a cámara de maduración SIN envasar antes. Maduran desnudos, y por eso su
  // maduración bloquea el envasado.
  maduraDesnudo: {
    pasa_por_sal: 1,
    madura_antes_de_envasar: 1,
    quesos: ['Sardo', 'Reggianito', 'Parmesano', 'Provolone', 'Pategrás', 'Fontina', 'Gouda'],
  },
  // Se salan y de ahí esperan envasado. Algunos maduran, pero después de envasarse, así
  // que su maduración NO bloquea nada.
  salYEspera: {
    pasa_por_sal: 1,
    madura_antes_de_envasar: 0,
    quesos: ['Cremoso', 'Cremoso Extra', 'Por Salut', 'Provoleta', 'Tybo'],
  },
  // A base de masa: se envasan en el momento de elaboración, sin pasar por sal.
  // "Por Salut sin sal" no es de masa pero comparte lo único que importa acá: no pasa
  // por saladero, así que está disponible apenas se produce.
  sinSal: {
    pasa_por_sal: 0,
    madura_antes_de_envasar: 0,
    quesos: ['Mozzarella cilindro', 'Mozzarella barra', 'Cremoso procesado', 'Por Salut sin sal'],
  },
}

// Los que no se están produciendo. Baja, nunca borrado: Cheddar tiene 9 tinas y Mar del
// Plata 7, y esa producción tiene que seguir mostrando su nombre en el historial.
const DAR_DE_BAJA = [
  ['Cheddar en barra', 'no se está produciendo (2026-09-24)'],
  ['Ricota', 'no se está produciendo (2026-09-24)'],
  // Mar del Plata es el MISMO queso que Pategrás, con otro nombre. Se da de baja para que
  // no haya dos botones para lo mismo en la tablet. Su historial queda bajo su nombre: no
  // se reasigna a Pategrás porque eso sería reescribir 7 tinas de producción ya
  // registrada, y es una decisión del cliente, no del código.
  ['Mar del Plata', 'es el mismo queso que Pategrás (2026-09-24)'],
]

const bool = (v) => (v === 1 || v === true)

// Los pasos 3 y 4 dependen de las columnas que crea el paso 1. En la SIMULACIÓN el paso 1
// no corrió, así que preguntar por esas columnas revienta. Con esto la simulación puede
// decir "haría esto" sin tocar nada, que es exactamente para lo que existe.
async function hayColumnasDeCircuito() {
  if (motor === 'postgres') {
    const r = await db
      .prepare(
        `SELECT 1 AS hay FROM information_schema.columns
          WHERE table_schema='public' AND table_name='tipos_queso' AND column_name='pasa_por_sal'`,
      )
      .get()
    return Boolean(r)
  }
  const cols = await db.prepare('PRAGMA table_info(tipos_queso)').all()
  return cols.some((c) => c.name === 'pasa_por_sal')
}

const pasos = [
  {
    titulo: 'tipos_queso: los dos ejes del circuito',
    async hace_falta() {
      if (motor === 'postgres') {
        const r = await db
          .prepare(
            `SELECT 1 AS hay FROM information_schema.columns
              WHERE table_schema='public' AND table_name='tipos_queso' AND column_name='pasa_por_sal'`,
          )
          .get()
        return !r
      }
      const cols = await db.prepare('PRAGMA table_info(tipos_queso)').all()
      return !cols.some((c) => c.name === 'pasa_por_sal')
    },
    async aplica() {
      // Los defaults reproducen el comportamiento viejo, así que agregarlas no cambia
      // nada por sí solo: lo que cambia es el paso siguiente, que las completa.
      const t = motor === 'postgres' ? 'BOOLEAN' : 'INTEGER'
      const si = motor === 'postgres' ? 'true' : '1'
      const no = motor === 'postgres' ? 'false' : '0'
      await db.exec(`
        ALTER TABLE tipos_queso ADD COLUMN pasa_por_sal ${t} NOT NULL DEFAULT ${si};
        ALTER TABLE tipos_queso ADD COLUMN madura_antes_de_envasar ${t} NOT NULL DEFAULT ${no};
      `)
      return 'pasa_por_sal + madura_antes_de_envasar'
    },
  },

  {
    titulo: 'Alta de Cremoso procesado',
    async hace_falta() {
      return !(await db.prepare('SELECT id FROM tipos_queso WHERE nombre = ?').get('Cremoso procesado'))
    },
    async aplica() {
      // Familia 'blando' y sin días de maduración, igual que las muzzarellas: el cliente
      // lo describió como "un queso nuevo, con similares características a la muzzarella".
      const orden = (await db.prepare('SELECT COALESCE(MAX(orden), 0) AS n FROM tipos_queso').get()).n
      await db
        .prepare(
          `INSERT INTO tipos_queso (nombre, familia, se_envasa, madura, activo, orden)
           VALUES (@nombre, @familia, true, false, true, @orden)`,
        )
        .run({ nombre: 'Cremoso procesado', familia: 'blando', orden: Number(orden) + 1 })
      return 'blando, se envasa, no madura'
    },
  },

  {
    titulo: 'Asignar el circuito a cada queso',
    async hace_falta() {
      if (!(await hayColumnasDeCircuito())) return true
      for (const c of Object.values(CIRCUITOS)) {
        for (const n of c.quesos) {
          const q = await db
            .prepare('SELECT pasa_por_sal, madura_antes_de_envasar FROM tipos_queso WHERE nombre = ?')
            .get(n)
          if (!q) continue
          if (bool(q.pasa_por_sal) !== bool(c.pasa_por_sal)) return true
          if (bool(q.madura_antes_de_envasar) !== bool(c.madura_antes_de_envasar)) return true
        }
      }
      return false
    },
    async aplica() {
      let n = 0
      const faltantes = []
      for (const c of Object.values(CIRCUITOS)) {
        for (const nombre of c.quesos) {
          const r = await db
            .prepare(
              'UPDATE tipos_queso SET pasa_por_sal = ?, madura_antes_de_envasar = ? WHERE nombre = ?',
            )
            .run(c.pasa_por_sal, c.madura_antes_de_envasar, nombre)
          if (r.changes) n += r.changes
          else faltantes.push(nombre)
        }
      }
      // Que un queso de la lista del cliente no exista en el catálogo es un dato, no un
      // detalle: significa que falta darlo de alta.
      return `${n} quesos asignados${faltantes.length ? ` · NO ENCONTRADOS: ${faltantes.join(', ')}` : ''}`
    },
  },

  {
    titulo: 'Baja de los que no se están produciendo',
    async hace_falta() {
      for (const [nombre] of DAR_DE_BAJA) {
        const q = await db.prepare('SELECT activo FROM tipos_queso WHERE nombre = ?').get(nombre)
        if (q && bool(q.activo)) return true
      }
      return false
    },
    async aplica() {
      const hechos = []
      for (const [nombre, motivo] of DAR_DE_BAJA) {
        const r = await db.prepare('UPDATE tipos_queso SET activo = 0 WHERE nombre = ?').run(nombre)
        if (r.changes) hechos.push(`${nombre} (${motivo})`)
      }
      return hechos.join(' · ') || 'ninguno'
    },
  },
]

// ---------------------------------------------------------------- correr

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
    continue
  }
  console.log(`  hecho       ${paso.titulo}\n              ${await paso.aplica()}`)
}

console.log(
  !pendientes
    ? '\nNo había nada que hacer: la base ya estaba al día.'
    : confirmar
      ? `\n${pendientes} paso(s) aplicado(s).`
      : `\n${pendientes} paso(s) pendiente(s). Volvé a correrlo con --confirmar.`,
)

// Cómo queda el circuito de cada queso activo. Es la única forma de ver de un vistazo si
// algo quedó en un camino que no le corresponde.
if (!(await hayColumnasDeCircuito())) {
  console.log('\n(el resumen de circuitos se ve después de aplicar)\n')
  process.exit(0)
}
const quesos = await db
  .prepare(
    `SELECT nombre, se_envasa, madura, pasa_por_sal, madura_antes_de_envasar
       FROM tipos_queso WHERE activo = 1 ORDER BY familia, orden, nombre`,
  )
  .all()
console.log('\nCircuito de cada queso activo:')
for (const q of quesos) {
  const camino = bool(q.madura_antes_de_envasar)
    ? 'sal → cámara → envasado'
    : bool(q.pasa_por_sal)
      ? 'sal → espera envasado'
      : 'envasado directo (sin sal)'
  const nota = bool(q.madura) && !bool(q.madura_antes_de_envasar) ? '  (madura después de envasar)' : ''
  const sinEnvasar = !bool(q.se_envasa) ? '  (no se envasa)' : ''
  console.log(`  ${String(q.nombre).padEnd(22)} ${camino}${nota}${sinEnvasar}`)
}

const bajas = await db.prepare('SELECT nombre FROM tipos_queso WHERE activo = 0 ORDER BY nombre').all()
console.log(`\nDe baja: ${bajas.map((b) => b.nombre).join(', ') || 'ninguno'}\n`)

process.exit(0)
