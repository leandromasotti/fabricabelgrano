// Muda la base de un PostgreSQL a otro. Se escribió para salir de Supabase y entrar al
// PostgreSQL del hosting, pero no sabe nada de ninguno de los dos: son dos URLs.
//
//   ORIGEN=<url vieja> DESTINO=<url nueva> node herramientas/mudar-base.mjs
//   ORIGEN=<url vieja> DESTINO=<url nueva> node herramientas/mudar-base.mjs --confirmar
//
// Sin --confirmar no escribe NADA: conecta a las dos puntas, cuenta filas y dice qué
// haría. Igual que las migraciones.
//
// POR QUÉ NO pg_dump
// Porque haría falta un binario de pg_dump de la misma versión mayor que el servidor de
// origen Y compatible con el de destino. Un volcado hecho con pg_dump 17 mete líneas que
// un servidor viejo no entiende (`SET transaction_timeout`), y un hosting compartido no
// dice qué versión corre hasta que uno se conecta. Esto usa sólo la librería `pg`, que ya
// está instalada, y habla el SQL mínimo que entiende cualquier Postgres desde el 12.
//
// EL ESQUEMA NO SE COPIA: SE REGENERA
// El destino se arma con migraciones/001-esquema.sql y las migraciones 002..00N, que es
// el esquema que el código espera. Copiar el del origen arrastraría lo que Supabase le
// haya agregado por abajo (roles anon/authenticated, RLS, grants) y fallaría del otro
// lado, donde esos roles no existen. De paso, que origen y destino queden con las MISMAS
// columnas es la prueba de que la cadena de migraciones reproduce producción: si no
// coinciden, este script se planta y lo muestra.

import { readdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const confirmar = process.argv.includes('--confirmar')
const soloEsquema = process.argv.includes('--solo-esquema')
const soloDatos = process.argv.includes('--solo-datos')

const ORIGEN = process.env.ORIGEN
const DESTINO = process.env.DESTINO

if (!DESTINO) {
  console.error(`
Falta DESTINO.

  ORIGEN=<url vieja> DESTINO=<url nueva> node herramientas/mudar-base.mjs

Las dos URLs llevan contraseña: pasalas por variable de entorno, no las escribas en un
archivo que después se commitea.
`)
  process.exit(1)
}
if (!ORIGEN && !soloEsquema) {
  console.error('Falta ORIGEN (o pasá --solo-esquema para armar el destino vacío).')
  process.exit(1)
}

const donde = (url) => {
  const u = new URL(url)
  return `${u.hostname}${u.port ? ':' + u.port : ''}${u.pathname}`
}

// --------------------------------------------------------------- las dos puntas

async function abrir(url, rol) {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15_000 })
  try {
    await c.connect()
  } catch (e) {
    console.error(`\nNo pude conectar al ${rol} (${donde(url)}):\n  ${e.message}\n`)
    if (/self.signed|certificate/i.test(e.message)) {
      console.error(
        'Eso es el certificado. Un hosting compartido suele traer uno autofirmado:\n' +
          '  probá terminando la URL en ?sslmode=no-verify  (cifra, no valida el certificado)\n' +
          '  o en ?sslmode=disable si el servidor no habla TLS.\n',
      )
    }
    if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND/i.test(e.message)) {
      console.error(
        'Eso no es la contraseña: es que no llegás al servidor. En un hosting compartido\n' +
          'casi siempre hay que habilitar el acceso remoto y declarar tu IP.\n',
      )
    }
    process.exit(1)
  }
  const i = (
    await c.query(
      `SELECT current_database() AS base, current_user AS usuario,
              current_setting('server_version') AS version`,
    )
  ).rows[0]
  console.log(`${rol.padEnd(7)} ${donde(url)}  ·  PostgreSQL ${i.version}  ·  usuario ${i.usuario}`)
  return c
}

const tablasDe = async (c) =>
  (
    await c.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name`,
    )
  ).rows.map((r) => r.table_name)

const columnasDe = async (c, tabla) =>
  (
    await c.query(
      `SELECT column_name, is_generated, is_identity FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position`,
      [tabla],
    )
  ).rows

const contar = async (c, tabla) =>
  Number((await c.query(`SELECT count(*) AS n FROM "${tabla}"`)).rows[0].n)

console.log()
const destino = await abrir(DESTINO, 'destino')
const origen = ORIGEN ? await abrir(ORIGEN, 'origen') : null
console.log()

// Las columnas generadas (litros_por_pallet) son PostgreSQL 12 en adelante. Si el hosting
// corre algo más viejo, el esquema no entra, y es mejor saberlo en la primera línea que a
// mitad de la copia.
const mayor = Number((await destino.query('SHOW server_version_num')).rows[0].server_version_num)
if (mayor < 120000) {
  console.error(
    `El destino corre PostgreSQL ${Math.floor(mayor / 10000)}, y el esquema usa columnas\n` +
      'GENERATED ... STORED, que existen desde la 12. Con esta versión no se puede mudar.\n',
  )
  process.exit(1)
}

// --------------------------------------------------------------- 1. el esquema

let tablasDestino = await tablasDe(destino)
let recienCreado = false

if (!soloDatos) {
  if (tablasDestino.length) {
    console.log(`El destino ya tiene ${tablasDestino.length} tablas; no toco el esquema.\n`)
  } else {
    const migraciones = readdirSync(join(raiz, 'migraciones'))
      .filter((f) => /^\d{3}-.*\.js$/.test(f))
      .sort()
    console.log('ESQUEMA — el destino está vacío, hay que armarlo:')
    console.log('  001-esquema.sql')
    for (const m of migraciones) console.log(`  ${m}`)
    console.log()

    if (confirmar) {
      await destino.query(readFileSync(join(raiz, 'migraciones', '001-esquema.sql'), 'utf8'))
      console.log('  001-esquema.sql  ok')

      // Cada migración corre como proceso aparte, apuntada al destino por DATABASE_URL,
      // que es lo único que miran. Así se usa exactamente el mismo código que ya se probó
      // contra la base local, sin una segunda ruta de ejecución que mantener.
      for (const m of migraciones) {
        const r = spawnSync(process.execPath, [join(raiz, 'migraciones', m), '--confirmar'], {
          env: { ...process.env, DATABASE_URL: DESTINO },
          encoding: 'utf8',
        })
        if (r.status !== 0) {
          console.error(`\n  ${m}  FALLÓ\n${r.stdout ?? ''}${r.stderr ?? ''}`)
          process.exit(1)
        }
        console.log(`  ${m}  ok`)
      }
      tablasDestino = await tablasDe(destino)
      recienCreado = true
      console.log()
    }
  }
}

if (soloEsquema) {
  await destino.end()
  console.log(confirmar ? 'Esquema listo.\n' : 'Nada escrito (faltó --confirmar).\n')
  process.exit(0)
}

// --------------------------------------------------- 2. ¿son el mismo esquema?

const tablasOrigen = await tablasDe(origen)

if (!tablasDestino.length) {
  console.log('El destino todavía no tiene tablas. Corré con --confirmar para armarlas.\n')
}

if (tablasDestino.length) {
  const faltan = tablasOrigen.filter((t) => !tablasDestino.includes(t))
  const sobran = tablasDestino.filter((t) => !tablasOrigen.includes(t))
  if (faltan.length) console.log(`Tablas del origen que NO están en el destino: ${faltan.join(', ')}`)
  if (sobran.length) console.log(`Tablas del destino que no están en el origen: ${sobran.join(', ')}`)

  // Una columna de menos en el destino es pérdida de datos silenciosa: el INSERT anda
  // igual y el dato se evapora. Es exactamente el caso que hay que frenar.
  const huecos = []
  for (const t of tablasOrigen.filter((x) => tablasDestino.includes(x))) {
    const o = (await columnasDe(origen, t)).map((c) => c.column_name)
    const d = new Set((await columnasDe(destino, t)).map((c) => c.column_name))
    const sinLugar = o.filter((c) => !d.has(c))
    if (sinLugar.length) huecos.push(`  ${t}: ${sinLugar.join(', ')}`)
  }
  if (huecos.length) {
    console.error('\nHay columnas del origen que el destino no tiene:')
    console.error(huecos.join('\n'))
    console.error('\nLa cadena de migraciones no reproduce producción. No copio nada.\n')
    process.exit(1)
  }
}

// --------------------------------------------------- 3. en qué orden van las tablas

// Una FK no puede apuntar a una fila que todavía no existe, así que los padres van
// primero. Orden topológico sobre las FK reales de la base, no sobre una lista escrita a
// mano que se desactualiza con la próxima tabla.
async function enOrden(c, tablas) {
  const fks = (
    await c.query(
      `SELECT con.conrelid::regclass::text AS hijo, con.confrelid::regclass::text AS padre
         FROM pg_constraint con
         JOIN pg_class t ON t.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE con.contype = 'f' AND n.nspname = 'public'`,
    )
  ).rows

  const limpio = (s) => s.replace(/^public\./, '').replace(/"/g, '')
  const padres = new Map(tablas.map((t) => [t, new Set()]))
  for (const { hijo, padre } of fks) {
    const h = limpio(hijo)
    const p = limpio(padre)
    if (h !== p && padres.has(h) && padres.has(p)) padres.get(h).add(p)
  }

  const orden = []
  const puestas = new Set()
  while (orden.length < tablas.length) {
    const listas = tablas.filter(
      (t) => !puestas.has(t) && [...padres.get(t)].every((p) => puestas.has(p)),
    )
    // Un ciclo de FK no se puede ordenar. Se avisa y se sigue, que es mejor que entrar en
    // un bucle infinito sin decir por qué.
    if (!listas.length) {
      const sueltas = tablas.filter((t) => !puestas.has(t))
      console.log(`Aviso: FK circulares entre ${sueltas.join(', ')}; van al final sin orden.`)
      orden.push(...sueltas)
      break
    }
    for (const t of listas) {
      orden.push(t)
      puestas.add(t)
    }
  }
  return orden
}

// En el ensayo el destino todavía está vacío, y filtrar por sus tablas daría una lista
// vacía: el ensayo diría "0 filas" justo cuando hay toda una base para mudar. Las FK se
// leen del ORIGEN, que siempre tiene el esquema completo, y son las mismas de los dos
// lados porque el destino se arma con las mismas migraciones.
const aCopiar = tablasDestino.length
  ? tablasOrigen.filter((t) => tablasDestino.includes(t))
  : tablasOrigen
const orden = await enOrden(origen, aCopiar)

// Varias migraciones dejan catálogo cargado: los motivos de la 006, los formatos de yogur
// de la 009. O sea que un destino "recién armado" NO está vacío, y esas mismas filas van a
// llegar desde el origen —con los ids que las FK de los registros ya apuntan—. Copiarlas
// encima duplicaría cada motivo y cada formato.
//
// Se vacía sólo si el esquema se creó en ESTA corrida. Sobre una base que ya existía no se
// borra nada: ahí el que decide qué pasa con los datos de adentro es el usuario, no esto.
if (recienCreado) {
  await destino.query(
    `TRUNCATE ${tablasDestino.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  )
  console.log('Vaciado el catálogo que dejaron las migraciones; las filas vienen del origen.\n')
}

// --------------------------------------------------- 4. el plan, o la copia

console.log('DATOS:')
let total = 0
const conFilas = []
for (const t of orden) {
  const n = await contar(origen, t)
  const yaHay = tablasDestino.length ? await contar(destino, t) : 0
  total += n
  if (n || yaHay) {
    console.log(
      `  ${t.padEnd(26)} ${String(n).padStart(6)} filas${yaHay ? `   (el destino ya tiene ${yaHay})` : ''}`,
    )
  }
  if (n) conFilas.push({ t, n, yaHay })
}
console.log(`  ${'-'.repeat(26)} ${String(total).padStart(6)} filas en total\n`)

// El seed deja catálogo cargado apenas arranca el servidor. Copiar encima duplicaría cada
// marca y cada producto, y las FK de los registros apuntarían a la copia equivocada.
const ocupadas = conFilas.filter((x) => x.yaHay)
if (ocupadas.length) {
  console.error(
    `El destino ya tiene datos en: ${ocupadas.map((x) => x.t).join(', ')}.\n` +
      'Esto copia sobre una base vacía. Vaciá esas tablas o mudá a una base nueva.\n',
  )
  process.exit(1)
}

if (!confirmar) {
  console.log('Nada escrito. Repetí con --confirmar para mudar.\n')
  await origen.end()
  await destino.end()
  process.exit(0)
}

const LOTE = 500

for (const { t, n } of conFilas) {
  const cols = await columnasDe(origen, t)
  // Una columna GENERATED ... STORED la calcula el destino sola, y escribirla es un error
  // ("cannot insert into generated column"). Las IDENTITY sí se escriben, con OVERRIDING
  // SYSTEM VALUE, porque los ids tienen que ser los MISMOS: son las FK de todas las demás
  // tablas y los que ya están impresos en los remitos del cliente.
  const nombres = cols.filter((c) => c.is_generated !== 'ALWAYS').map((c) => c.column_name)
  const lista = nombres.map((c) => `"${c}"`).join(', ')
  const hayIdentity = cols.some((c) => c.is_identity === 'YES')

  const filas = (await origen.query(`SELECT ${lista} FROM "${t}"`)).rows
  for (let i = 0; i < filas.length; i += LOTE) {
    const lote = filas.slice(i, i + LOTE)
    const valores = []
    const marcas = lote.map(
      (f) =>
        '(' +
        nombres
          .map((c) => {
            valores.push(f[c])
            return '$' + valores.length
          })
          .join(', ') +
        ')',
    )
    await destino.query(
      `INSERT INTO "${t}" (${lista}) ${hayIdentity ? 'OVERRIDING SYSTEM VALUE ' : ''}VALUES ${marcas.join(', ')}`,
      valores,
    )
  }

  // Sin esto, la primera carga desde una tablet choca con un id que ya existe: la
  // secuencia quedó en 1 porque los ids entraron a mano.
  for (const c of cols.filter((x) => x.is_identity === 'YES')) {
    await destino.query(
      `SELECT setval(
         pg_get_serial_sequence($1, $2),
         GREATEST((SELECT COALESCE(MAX("${c.column_name}"), 0) FROM "${t}"), 1)
       )`,
      [t, c.column_name],
    )
  }

  const quedaron = await contar(destino, t)
  console.log(
    `  ${t.padEnd(26)} ${String(quedaron).padStart(6)} / ${n}${quedaron === n ? '' : '   <- NO COINCIDE'}`,
  )
}

console.log('\nVerificando...')
let mal = 0
for (const t of orden) {
  const a = await contar(origen, t)
  const b = await contar(destino, t)
  if (a !== b) {
    console.error(`  ${t}: origen ${a}, destino ${b}`)
    mal++
  }
}
console.log(
  mal ? `\n${mal} tabla(s) con diferencias.\n` : '\nMudanza completa: todas las tablas coinciden.\n',
)

await origen.end()
await destino.end()
process.exit(mal ? 1 : 0)
