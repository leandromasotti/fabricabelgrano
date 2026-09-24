import { db } from './db.js'

// Marcas. es_propia sale de "marca Obenac, que es nuestra" [A2 00:47] - falta mapear el resto.
// La grafia de Obenac quedo confirmada por el cliente el 2026-09-22 (se escribe con B, no
// con V como se habia transcrito del audio). Cierra la pregunta A1.
const marcas = [
  { nombre: 'Lácteos Belgrano', es_propia: 1, orden: 1 },
  { nombre: 'Central Lechera', es_propia: 0, orden: 2 },
  { nombre: 'Obenac', es_propia: 1, orden: 3 },
]

// Confirmados contra el catalogo oficial de lacteosbelgrano.com.ar (2026-09-11).
// Los yogures: solo vainilla y frutilla (confirmado por el cliente 2026-09-14).
const productos = [
  { nombre: 'Entera', familia: 'leche', orden: 1 },
  { nombre: 'Largavida', familia: 'leche', orden: 2 },
  { nombre: 'Descremada', familia: 'leche', orden: 3 },
  { nombre: 'Vainilla', familia: 'yogur', orden: 1 },
  { nombre: 'Frutilla', familia: 'yogur', orden: 2 },
]

// Formatos en que se arma un pallet de leche, confirmados por el cliente el 2026-09-16.
//
// El sachet es de 1 litro en todos, asi que los litros salen de multiplicar bultos por
// unidades. Casi todos los cajones son por 18; los clientes que piden por 20 se
// resuelven corrigiendo el pallet desde la tablet, no con un formato aparte.
//
// La caja va primera porque es a donde la fabrica esta yendo: "estamos intentando pasar
// de cajones, todo a cajas". Los cajones se dan de baja desde /app/maestros cuando dejen
// de usarse, sin tocar codigo.
//
// Las dos "Palangana" que habia antes eran suposiciones nuestras de cuando no conociamos
// las equivalencias. Ya no se siembran: las reales son Palangana 30 y Bandejon.
// Opciones de las tablets de planta.
//
// El historial arranca APAGADO: en una tablet amurada, la lista de lo que cargaron otros
// compite con el botón que hay que tocar, y la pantalla existe para registrar, no para
// consultar. Para consultar está /app/consulta, en una computadora.
const opcionesTablet = [
  {
    orden: 1,
    clave: 'historial',
    nombre: 'Historial del día en las tablets',
    descripcion: 'La lista de lo ya registrado hoy, abajo de la pantalla de cada sector',
  },
]

// Secciones del tablero LED.
//
// Arrancan TODAS visibles porque es lo que el tablero mostraba hasta hoy, y un seed no
// puede cambiarle la pantalla a nadie por sorpresa. Se apagan las que sobren desde
// /app/tablero-led, que es donde vive la decision.
const seccionesTablero = [
  { orden: 1, clave: 'recepcion', nombre: 'Leche cruda recibida',  descripcion: 'Litros que entraron hoy, entregas y temperatura máxima' },
  { orden: 2, clave: 'lecheria',  nombre: 'Pallets de lechería',   descripcion: 'Pallets del día por marca y tipo de leche' },
  { orden: 3, clave: 'yogur',     nombre: 'Yogures',               descripcion: 'Bins del día y su equivalencia aproximada' },
  { orden: 4, clave: 'queso',     nombre: 'Circuito del queso',    descripcion: 'Producido, esperando sal, en saladero, para envasar y envasado' },
  { orden: 5, clave: 'pedidos',   nombre: 'Pedidos',               descripcion: 'Pendientes, en armado y listos para facturar' },
  { orden: 6, clave: 'alertas',   nombre: 'Atención',              descripcion: 'Tinas demoradas y quesos desnudos hace mucho' },
]

// Formatos actualizados por el cliente el 2026-09-22.
//
// OJO con el orden si aparece una base vieja: este seed inserta por nombre, así que sobre
// una base que todavía tenga "Cajón lácteo" / "Cajón Sancor" / "Cajón La Serenísima"
// agregaría los nuevos SIN sacar los viejos, y quedarían los cinco activos. Primero
// `node migraciones/002-cajones-y-obenac.js --confirmar`, después el seed. Las bases de
// Docker y Supabase ya están migradas; esto aplica a cualquier otra que aparezca.
//
// Salieron "Cajón Sancor" y "Cajón La Serenísima": eran el mismo cajón de 40 × 18 con el
// nombre del cliente que se lo llevaba, y lo que distingue a un cajon de otro no es el
// cliente sino cuantas unidades entran. Quedan los dos que importan, x 18 y x 20.
//
// El x 20 va marcado como provisorio porque los 40 bultos por pallet son deduccion, no
// dato: Alexis dijo que el cajon x 20 existe "porque en un solo pallet meten mas litros",
// lo que implica el mismo pallet de 40 cajones con mas unidades en cada uno (800 L en vez
// de 720). Se confirma desde /app/envases destildando "provisorio", sin tocar codigo.
//
// OJO: hoy `provisorio` se ve SOLO en /app/envases, como el tag "a confirmar". La tablet
// muestra "800 litros" sin ninguna marca, asi que el operario no tiene forma de saber que
// ese numero es estimado. Existe una clase .aviso-provisorio en styles.css que nadie usa,
// justamente para esto. Mientras no se muestre, el flag sirve al encargado y no al
// operario — que es la mitad del valor que deberia tener.
const envases = [
  { nombre: 'Caja 12 × 1 L',       bultos: 70, unidades: 12, litros: 1, provisorio: 0, orden: 1 },
  { nombre: 'Cajón lácteo x 18',   bultos: 40, unidades: 18, litros: 1, provisorio: 0, orden: 2 },
  { nombre: 'Cajón lácteo x 20',   bultos: 40, unidades: 20, litros: 1, provisorio: 1, orden: 3 },
  { nombre: 'Palangana 30',        bultos: 30, unidades: 18, litros: 1, provisorio: 0, orden: 4 },
  { nombre: 'Bandejón de colores', bultos: 30, unidades: 18, litros: 1, provisorio: 0, orden: 5 },
]

// Que familia hace cada marca. El yogur va en dos marcas: Obenac NO hace yogur
// (confirmado por el cliente 2026-09-14).
const marcasFamilias = [
  { marca: 'Lácteos Belgrano', familias: ['leche', 'yogur'] },
  { marca: 'Central Lechera', familias: ['leche', 'yogur'] },
  { marca: 'Obenac', familias: ['leche'] },
]

// Unidades por caja de yogur. El cliente lo dio como "aproximadamente 500" y decidio
// dejarlo fijo. Queda configurable y marcado como provisorio: si al contarlas resulta
// que varian, conviene que el operario cargue la cantidad real — igual que el rinde de
// la tina, que tampoco se asume.
// kilos_por_unidad = 1 (confirmado 2026-09-15). Los dos numeros se editan desde
// /envases.html sin tocar codigo.
const yogurCaja = { unidades_por_bin: 500, kilos_por_unidad: 1 }

// PLACEHOLDER - es el unico dato que bloquea el arranque real (ver 04-plan-mvp.md, seccion 6).
// Reemplazar por las listas reales antes de instalar en planta.
const operarios = [
  { nombre: 'Operario 1', sector: 'lecheria', orden: 1 },
  { nombre: 'Operario 2', sector: 'lecheria', orden: 2 },
  { nombre: 'Operario 3', sector: 'lecheria', orden: 3 },
  { nombre: 'Yogurtero 1', sector: 'yogures', orden: 1 },
  { nombre: 'Yogurtero 2', sector: 'yogures', orden: 2 },
  { nombre: 'Recepción 1', sector: 'recepcion', orden: 1 },
  { nombre: 'Recepción 2', sector: 'recepcion', orden: 2 },
  { nombre: 'Quesero 1', sector: 'queseria', orden: 1 },
  { nombre: 'Quesero 2', sector: 'queseria', orden: 2 },
  { nombre: 'Salador 1', sector: 'saladero', orden: 1 },
  { nombre: 'Salador 2', sector: 'saladero', orden: 2 },
  { nombre: 'Armador 1', sector: 'pedidos', orden: 1 },
  { nombre: 'Armador 2', sector: 'pedidos', orden: 2 },
  { nombre: 'Envasador 1', sector: 'envasado', orden: 1 },
  { nombre: 'Envasador 2', sector: 'envasado', orden: 2 },
  { nombre: 'Madurador 1', sector: 'maduracion', orden: 1 },
]

// Catalogo oficial de lacteosbelgrano.com.ar (2026-09-11), con los circuitos que dio el
// cliente el 2026-09-22 y las correcciones del 24/9. Detalle en docs/12-circuitos-del-queso.md.
//
// Las DOS columnas de circuito son independientes y hay que leerlas juntas:
//
//   pasa_por_sal = 0             -> no va al saladero: disponible apenas se produce
//   madura_antes_de_envasar = 1  -> va a camara DESNUDO: disponible al salir de camara
//
// Ojo con `madura` vs `madura_antes_de_envasar`: el cremoso y el tybo maduran, pero
// DESPUES de envasarse, asi que su maduracion no bloquea el envasado. Confundir las dos
// cosas es lo que tenia al cremoso fuera de la lista de envasado para siempre.
//
// activo = 0 en tres: Cheddar y Ricota no se estan produciendo, y "Mar del Plata" es el
// MISMO queso que el Pategras (confirmado 2026-09-24). Se dan de baja, no se borran: el
// Cheddar tiene 9 tinas registradas y el Mar del Plata 7.
//
// se_envasa: el sardo NO se envasa, confirmado en el audio 4.
const tiposQueso = [
  // masa: se envasan en el momento de elaboracion, sin pasar por sal
  { nombre: 'Mozzarella barra',    familia: 'blando',   se_envasa: 1, sal: 0, madura_antes: 0, orden: 1 },
  { nombre: 'Mozzarella cilindro', familia: 'blando',   se_envasa: 1, sal: 0, madura_antes: 0, orden: 2 },
  { nombre: 'Cremoso procesado',   familia: 'blando',   se_envasa: 1, sal: 0, madura_antes: 0, orden: 3 },
  // tampoco pasa por sal, aunque no sea de masa: el nombre lo dice
  { nombre: 'Por Salut sin sal',   familia: 'blando',   se_envasa: 1, sal: 0, madura_antes: 0, orden: 4 },
  // se salan y de ahi esperan envasado
  { nombre: 'Cremoso',             familia: 'blando',   se_envasa: 1, sal: 1, madura_antes: 0, orden: 5 },
  { nombre: 'Cremoso Extra',       familia: 'blando',   se_envasa: 1, sal: 1, madura_antes: 0, orden: 6 },
  { nombre: 'Por Salut',           familia: 'blando',   se_envasa: 1, sal: 1, madura_antes: 0, orden: 7 },
  { nombre: 'Tybo',                familia: 'semiduro', se_envasa: 1, sal: 1, madura_antes: 0, orden: 8 },
  { nombre: 'Provoleta',           familia: 'duro',     se_envasa: 1, sal: 1, madura_antes: 0, orden: 9 },
  // van a camara de maduracion SIN envasar antes
  { nombre: 'Pategrás',            familia: 'semiduro', se_envasa: 1, sal: 1, madura_antes: 1, orden: 10 },
  { nombre: 'Fontina',             familia: 'semiduro', se_envasa: 1, sal: 1, madura_antes: 1, orden: 11 },
  { nombre: 'Gouda',               familia: 'semiduro', se_envasa: 1, sal: 1, madura_antes: 1, orden: 12 },
  { nombre: 'Sardo',               familia: 'duro',     se_envasa: 0, sal: 1, madura_antes: 1, orden: 13 },
  { nombre: 'Reggianito',          familia: 'duro',     se_envasa: 1, sal: 1, madura_antes: 1, orden: 14 },
  { nombre: 'Parmesano',           familia: 'duro',     se_envasa: 1, sal: 1, madura_antes: 1, orden: 15 },
  { nombre: 'Provolone',           familia: 'duro',     se_envasa: 1, sal: 1, madura_antes: 1, orden: 16 },
  // de baja: no se estan produciendo, o son duplicados
  { nombre: 'Cheddar en barra',    familia: 'semiduro', se_envasa: 1, sal: 1, madura_antes: 1, orden: 17, activo: 0 },
  { nombre: 'Mar del Plata',       familia: 'semiduro', se_envasa: 1, sal: 1, madura_antes: 1, orden: 18, activo: 0 },
  // La ricota se hace del SUERO: no pasa por tina, saladero ni maduracion. Hoy no se
  // produce, asi que queda de baja y su circuito real sigue sin definir (pregunta C7).
  { nombre: 'Ricota',              familia: 'semiduro', se_envasa: 1, sal: 0, madura_antes: 0, orden: 19, activo: 0 },
]

// ---------------------------------------------------------------------------
// DIAS DE MADURACION - VALORES DE REFERENCIA, NO CONFIRMADOS POR LA FABRICA
// ---------------------------------------------------------------------------
// Son puntos de partida tipicos para cada tipo de queso, cargados para que el sistema
// arranque mostrando algo. NO salen de ningun audio ni de la fabrica.
//
// Quedan marcados con dias_provisorios = 1 y la pantalla lo dice: mientras ese flag
// este en 1, los dias se muestran como "de referencia". En cuanto el maestro quesero
// dicte los reales, se corrigen desde /maduracion-dias.html y el flag pasa a 0.
//
// min = antes de esto no se vende | optimo = el punto | max = se esta pasando
const maduracion = {
  // Blandos: no maduran, salen de sal y se envasan.
  'Cremoso':             { madura: 0 },
  'Cremoso Extra':       { madura: 0 },
  'Mozzarella barra':    { madura: 0 },
  'Mozzarella cilindro': { madura: 0 },
  'Por Salut':           { madura: 0 },
  'Por Salut sin sal':   { madura: 0 },
  'Ricota':              { madura: 0 },   // es fresca, no madura pese a figurar entre los semiduros
  'Cremoso procesado':   { madura: 0 },
  // El tybo es un queso BARRA y funciona como el cremoso: sale de sal y espera envasado,
  // no pasa por camara (confirmado por el cliente 2026-09-24). Estaba en 1 con dias de
  // referencia de semiduro, que lo hacian aparecer en la tablet de maduracion.
  'Tybo':                { madura: 0 },
  // Semiduros
  'Pategrás':            { madura: 1, min: 30,  opt: 45,  max: 75 },
  'Fontina':             { madura: 1, min: 30,  opt: 45,  max: 70 },
  'Gouda':               { madura: 1, min: 30,  opt: 60,  max: 90 },
  'Cheddar en barra':    { madura: 1, min: 60,  opt: 90,  max: 180 },
  'Mar del Plata':       { madura: 1, min: 30,  opt: 45,  max: 70 },
  // Duros
  'Sardo':               { madura: 1, min: 90,  opt: 150, max: 270 },
  'Reggianito':          { madura: 1, min: 150, opt: 180, max: 300 },
  'Parmesano':           { madura: 1, min: 180, opt: 240, max: 365 },
  'Provolone':           { madura: 1, min: 60,  opt: 120, max: 240 },
  'Provoleta':           { madura: 1, min: 20,  opt: 30,  max: 60 },
}

const insertMarca = db.prepare(
  'INSERT INTO marcas (nombre, es_propia, orden) VALUES (@nombre, @es_propia, @orden)'
)
const insertProducto = db.prepare(
  'INSERT INTO productos (nombre, familia, orden) VALUES (@nombre, @familia, @orden)'
)
const insertOperario = db.prepare(
  'INSERT INTO operarios (nombre, sector, orden) VALUES (@nombre, @sector, @orden)'
)
// Tambos vistos en la planilla del 05.09.26. PLACEHOLDER: la lista real la tiene la
// fabrica, y seguramente son mas. Se cargan con `npm run tambos`.
const tambos = [2, 4, 5, 6, 14, 15].map((n, i) => ({ numero: n, orden: i + 1 }))

// PLACEHOLDER - la lista real de clientes la tiene el encargado.
const clientes = [
  { nombre: 'Cliente 1', orden: 1 },
  { nombre: 'Cliente 2', orden: 2 },
  { nombre: 'Cliente 3', orden: 3 },
  { nombre: 'Cliente 4', orden: 4 },
  { nombre: 'Cliente 5', orden: 5 },
]

const insertTambo = db.prepare(
  'INSERT INTO tambos (numero, orden) VALUES (@numero, @orden)'
)
const insertOpcionTablet = db.prepare(
  'INSERT INTO opciones_tablet (clave, nombre, descripcion, activo, orden) VALUES (@clave, @nombre, @descripcion, false, @orden)'
)
const insertSeccion = db.prepare(
  'INSERT INTO tablero_secciones (clave, nombre, descripcion, visible, orden) VALUES (@clave, @nombre, @descripcion, true, @orden)'
)
const insertEnvase = db.prepare(`
  INSERT INTO envases (nombre, bultos_por_pallet, unidades_por_bulto, litros_por_unidad, provisorio, orden)
  VALUES (@nombre, @bultos, @unidades, @litros, @provisorio, @orden)
`)
const insertMarcaFamilia = db.prepare(
  'INSERT OR IGNORE INTO marcas_familias (marca_id, familia) VALUES (?, ?)'
)
const insertCliente = db.prepare(
  'INSERT INTO clientes (nombre, orden) VALUES (@nombre, @orden)'
)
const insertTipoQueso = db.prepare(
  `INSERT INTO tipos_queso (nombre, familia, se_envasa, pasa_por_sal, madura_antes_de_envasar, activo, orden)
   VALUES (@nombre, @familia, @se_envasa, @sal, @madura_antes, @activo, @orden)`
)

async function cargar() {
  if ((await db.prepare('SELECT COUNT(*) n FROM marcas').get()).n === 0) {
    for (const m of marcas) await insertMarca.run(m)
    console.log(`  marcas:    ${marcas.length}`)
  }
  const existeProducto = db.prepare('SELECT 1 FROM productos WHERE nombre = ? AND familia = ?')
  const nuevosProductos = []
  for (const p of productos) if (!(await existeProducto.get(p.nombre, p.familia))) nuevosProductos.push(p)
  for (const p of nuevosProductos) await insertProducto.run(p)
  if (nuevosProductos.length) console.log(`  productos: +${nuevosProductos.length}`)
  // Idempotente por nombre+sector: agregar un operario nuevo no obliga a borrar la base.
  const existeOperario = db.prepare('SELECT 1 FROM operarios WHERE nombre = ? AND sector = ?')
  const nuevos = []
  for (const o of operarios) if (!(await existeOperario.get(o.nombre, o.sector))) nuevos.push(o)
  for (const o of nuevos) await insertOperario.run(o)
  if (nuevos.length) console.log(`  operarios: +${nuevos.length}  <-- PLACEHOLDER, reemplazar`)
  // Idempotente por nombre: agregar un queso nuevo al catálogo no obliga a borrar la
  // base ni pisa los que ya están cargados.
  const existeQueso = db.prepare('SELECT 1 FROM tipos_queso WHERE nombre = ?')
  const nuevosQuesos = []
  for (const q of tiposQueso) if (!(await existeQueso.get(q.nombre))) nuevosQuesos.push(q)
  // `activo` viene sólo en los que van de baja, así que el resto se completa acá en vez
  // de repetir `activo: 1` en dieciséis líneas.
  for (const q of nuevosQuesos) await insertTipoQueso.run({ activo: 1, ...q })
  if (nuevosQuesos.length) console.log(`  quesos:    +${nuevosQuesos.length}`)
  if ((await db.prepare('SELECT COUNT(*) n FROM clientes').get()).n === 0) {
    for (const c of clientes) await insertCliente.run(c)
    console.log(`  clientes:  ${clientes.length}  <-- PLACEHOLDER, reemplazar`)
  }

  const existeTambo = db.prepare('SELECT 1 FROM tambos WHERE numero = ?')
  const nuevosTambos = []
  for (const x of tambos) if (!(await existeTambo.get(x.numero))) nuevosTambos.push(x)
  for (const x of nuevosTambos) await insertTambo.run(x)
  if (nuevosTambos.length) console.log(`  tambos:    +${nuevosTambos.length}  <-- PLACEHOLDER, revisar`)

  // Idempotente por nombre, igual que los quesos.
  const existeEnvase = db.prepare('SELECT 1 FROM envases WHERE nombre = ?')
  const nuevosEnvases = []
  for (const e of envases) if (!(await existeEnvase.get(e.nombre))) nuevosEnvases.push(e)
  for (const e of nuevosEnvases) await insertEnvase.run(e)
  if (nuevosEnvases.length) console.log(`  envases:   +${nuevosEnvases.length}`)

  // Idempotente por clave: agregar una seccion nueva al tablero no pisa lo que el
  // encargado ya decidio mostrar u ocultar.
  const existeSeccion = db.prepare('SELECT 1 FROM tablero_secciones WHERE clave = ?')
  const nuevasSecciones = []
  for (const s of seccionesTablero) if (!(await existeSeccion.get(s.clave))) nuevasSecciones.push(s)
  for (const s of nuevasSecciones) await insertSeccion.run(s)
  if (nuevasSecciones.length) console.log(`  tablero:   +${nuevasSecciones.length} secciones`)

  const existeOpcion = db.prepare('SELECT 1 FROM opciones_tablet WHERE clave = ?')
  const nuevasOpciones = []
  for (const o of opcionesTablet) if (!(await existeOpcion.get(o.clave))) nuevasOpciones.push(o)
  for (const o of nuevasOpciones) await insertOpcionTablet.run(o)
  if (nuevasOpciones.length) console.log(`  tablets:   +${nuevasOpciones.length} opciones`)

  // Que familia hace cada marca. INSERT OR IGNORE: no pisa lo que ya este.
  const marcaPorNombre = db.prepare('SELECT id FROM marcas WHERE nombre = ?')
  let relaciones = 0
  for (const { marca, familias } of marcasFamilias) {
    const m = await marcaPorNombre.get(marca)
    if (!m) continue
    for (const f of familias) relaciones += (await insertMarcaFamilia.run(m.id, f)).changes
  }
  if (relaciones) console.log(`  marcas×familias: +${relaciones}`)

  // Datos de la caja de yogur, solo mientras sigan marcados como provisorios.
  const ponerYogur = db.prepare(`
    UPDATE productos
       SET unidades_por_bin = @unidades_por_bin, kilos_por_unidad = @kilos_por_unidad
     WHERE familia = 'yogur' AND datos_provisorios = 1
  `)
  const tocadosYogur = (await ponerYogur.run(yogurCaja)).changes
  if (tocadosYogur) {
    console.log(`  yogur:     ${tocadosYogur} productos con ${yogurCaja.unidades_por_bin} u/caja (APROXIMADO)`)
  }

  // Los pallets viejos no tenian envase: se les asigna el unico formato que existia.
  const sinEnvase = (await db.prepare('SELECT COUNT(*) n FROM registros_pallet WHERE envase_id IS NULL').get()).n
  if (sinEnvase) {
    const caja = await db.prepare("SELECT id FROM envases WHERE nombre = 'Caja 12 × 1 L'").get()
    if (caja) {
      await db.prepare('UPDATE registros_pallet SET envase_id = ? WHERE envase_id IS NULL').run(caja.id)
      console.log(`  ${sinEnvase} pallets viejos asignados al formato en caja`)
    }
  }

  // Los dias de maduracion se aplican siempre, pero SOLO sobre los quesos que todavia
  // tienen sus valores marcados como provisorios: si el quesero ya los corrigio, un
  // seed posterior no puede pisarselos.
  const ponerDias = db.prepare(`
    UPDATE tipos_queso
       SET madura = @madura, dias_minimos = @min, dias_optimos = @opt, dias_maximos = @max
     WHERE nombre = @nombre AND dias_provisorios = 1
  `)
  let tocados = 0
  for (const [nombre, m] of Object.entries(maduracion)) {
    tocados += (await ponerDias.run({
      nombre,
      madura: m.madura,
      min: m.min ?? null,
      opt: m.opt ?? null,
      max: m.max ?? null,
    })).changes
  }
  if (tocados) console.log(`  maduración: ${tocados} quesos con días DE REFERENCIA (a confirmar)`)
}

await cargar()
console.log('Seed listo.')
