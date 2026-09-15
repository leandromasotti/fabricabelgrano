import { db } from './db.js'

// Marcas: dos confirmadas en el audio 2, la tercera pendiente de confirmacion (pregunta A1).
// es_propia sale de "marca Ovenac, que es nuestra" [A2 00:47] - falta mapear el resto.
const marcas = [
  { nombre: 'Lácteos Belgrano', es_propia: 1, orden: 1 },
  { nombre: 'Central Lechera', es_propia: 0, orden: 2 },
  { nombre: 'Ovenac', es_propia: 1, orden: 3 },
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

// Formatos en que se arma un pallet de leche.
//
// Solo el primero esta confirmado: 70 cajas de 12 sachets de 1 litro = 840 L.
// Los dos tipos de palangana quedan marcados como PROVISORIOS porque el cliente
// todavia no tiene los numeros. La pantalla lo dice, y se corrigen desde
// /envases.html sin tocar codigo.
// El sachet de leche es de 1 litro en todos los formatos (confirmado 2026-09-15), asi
// que de las palanganas solo faltan las dos cantidades.
const envases = [
  { nombre: 'Caja 12 × 1 L', bultos: 70, unidades: 12, litros: 1, provisorio: 0, orden: 1 },
  { nombre: 'Palangana', bultos: null, unidades: null, litros: 1, provisorio: 1, orden: 2 },
  { nombre: 'Palangana 2', bultos: null, unidades: null, litros: 1, provisorio: 1, orden: 3 },
]

// Que familia hace cada marca. El yogur va en dos marcas: Ovenac NO hace yogur
// (confirmado por el cliente 2026-09-14).
const marcasFamilias = [
  { marca: 'Lácteos Belgrano', familias: ['leche', 'yogur'] },
  { marca: 'Central Lechera', familias: ['leche', 'yogur'] },
  { marca: 'Ovenac', familias: ['leche'] },
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

// Catalogo oficial de lacteosbelgrano.com.ar (2026-09-11) + "Mar del Plata", que se
// menciona en el audio 5 pero no figura en la web (pregunta C7).
// dias_maduracion queda en null: no lo sabemos todavia (pregunta C2).
// se_envasa: el sardo NO se envasa, confirmado en el audio 4.
const tiposQueso = [
  { nombre: 'Cremoso',           familia: 'blando',   se_envasa: 1, orden: 1 },
  { nombre: 'Cremoso Extra',     familia: 'blando',   se_envasa: 1, orden: 2 },
  { nombre: 'Mozzarella barra',  familia: 'blando',   se_envasa: 1, orden: 3 },
  { nombre: 'Mozzarella cilindro', familia: 'blando', se_envasa: 1, orden: 4 },
  { nombre: 'Por Salut',         familia: 'blando',   se_envasa: 1, orden: 5 },
  { nombre: 'Por Salut sin sal', familia: 'blando',   se_envasa: 1, orden: 6 },
  { nombre: 'Pategrás',          familia: 'semiduro', se_envasa: 1, orden: 7 },
  { nombre: 'Fontina',           familia: 'semiduro', se_envasa: 1, orden: 8 },
  { nombre: 'Gouda',             familia: 'semiduro', se_envasa: 1, orden: 9 },
  { nombre: 'Tybo',              familia: 'semiduro', se_envasa: 1, orden: 10 },
  { nombre: 'Cheddar en barra',  familia: 'semiduro', se_envasa: 1, orden: 11 },
  { nombre: 'Mar del Plata',     familia: 'semiduro', se_envasa: 1, orden: 12 },
  // Figura en el catalogo oficial entre los semiduros, pero la ricota se hace del
  // SUERO: no pasa por tina, saladero ni maduracion como los demas. Se carga para
  // que exista en las listas, pero su circuito real esta sin definir (pregunta C7).
  { nombre: 'Ricota',            familia: 'semiduro', se_envasa: 1, orden: 13 },
  { nombre: 'Sardo',             familia: 'duro',     se_envasa: 0, orden: 14 },
  { nombre: 'Reggianito',        familia: 'duro',     se_envasa: 1, orden: 15 },
  { nombre: 'Parmesano',         familia: 'duro',     se_envasa: 1, orden: 16 },
  { nombre: 'Provolone',         familia: 'duro',     se_envasa: 1, orden: 17 },
  { nombre: 'Provoleta',         familia: 'duro',     se_envasa: 1, orden: 18 },
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
  // Semiduros
  'Pategrás':            { madura: 1, min: 30,  opt: 45,  max: 75 },
  'Fontina':             { madura: 1, min: 30,  opt: 45,  max: 70 },
  'Gouda':               { madura: 1, min: 30,  opt: 60,  max: 90 },
  'Tybo':                { madura: 1, min: 25,  opt: 40,  max: 65 },
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
  `INSERT INTO tipos_queso (nombre, familia, se_envasa, orden)
   VALUES (@nombre, @familia, @se_envasa, @orden)`
)

const cargar = db.transaction(() => {
  if (db.prepare('SELECT COUNT(*) n FROM marcas').get().n === 0) {
    marcas.forEach((m) => insertMarca.run(m))
    console.log(`  marcas:    ${marcas.length}`)
  }
  const existeProducto = db.prepare('SELECT 1 FROM productos WHERE nombre = ? AND familia = ?')
  const nuevosProductos = productos.filter((p) => !existeProducto.get(p.nombre, p.familia))
  nuevosProductos.forEach((p) => insertProducto.run(p))
  if (nuevosProductos.length) console.log(`  productos: +${nuevosProductos.length}`)
  // Idempotente por nombre+sector: agregar un operario nuevo no obliga a borrar la base.
  const existeOperario = db.prepare('SELECT 1 FROM operarios WHERE nombre = ? AND sector = ?')
  const nuevos = operarios.filter((o) => !existeOperario.get(o.nombre, o.sector))
  nuevos.forEach((o) => insertOperario.run(o))
  if (nuevos.length) console.log(`  operarios: +${nuevos.length}  <-- PLACEHOLDER, reemplazar`)
  // Idempotente por nombre: agregar un queso nuevo al catálogo no obliga a borrar la
  // base ni pisa los que ya están cargados.
  const existeQueso = db.prepare('SELECT 1 FROM tipos_queso WHERE nombre = ?')
  const nuevosQuesos = tiposQueso.filter((q) => !existeQueso.get(q.nombre))
  nuevosQuesos.forEach((q) => insertTipoQueso.run(q))
  if (nuevosQuesos.length) console.log(`  quesos:    +${nuevosQuesos.length}`)
  if (db.prepare('SELECT COUNT(*) n FROM clientes').get().n === 0) {
    clientes.forEach((c) => insertCliente.run(c))
    console.log(`  clientes:  ${clientes.length}  <-- PLACEHOLDER, reemplazar`)
  }

  const existeTambo = db.prepare('SELECT 1 FROM tambos WHERE numero = ?')
  const nuevosTambos = tambos.filter((x) => !existeTambo.get(x.numero))
  nuevosTambos.forEach((x) => insertTambo.run(x))
  if (nuevosTambos.length) console.log(`  tambos:    +${nuevosTambos.length}  <-- PLACEHOLDER, revisar`)

  // Idempotente por nombre, igual que los quesos.
  const existeEnvase = db.prepare('SELECT 1 FROM envases WHERE nombre = ?')
  const nuevosEnvases = envases.filter((e) => !existeEnvase.get(e.nombre))
  nuevosEnvases.forEach((e) => insertEnvase.run(e))
  if (nuevosEnvases.length) console.log(`  envases:   +${nuevosEnvases.length}`)

  // Que familia hace cada marca. INSERT OR IGNORE: no pisa lo que ya este.
  const marcaPorNombre = db.prepare('SELECT id FROM marcas WHERE nombre = ?')
  let relaciones = 0
  for (const { marca, familias } of marcasFamilias) {
    const m = marcaPorNombre.get(marca)
    if (!m) continue
    for (const f of familias) relaciones += insertMarcaFamilia.run(m.id, f).changes
  }
  if (relaciones) console.log(`  marcas×familias: +${relaciones}`)

  // Datos de la caja de yogur, solo mientras sigan marcados como provisorios.
  const ponerYogur = db.prepare(`
    UPDATE productos
       SET unidades_por_bin = @unidades_por_bin, kilos_por_unidad = @kilos_por_unidad
     WHERE familia = 'yogur' AND datos_provisorios = 1
  `)
  const tocadosYogur = ponerYogur.run(yogurCaja).changes
  if (tocadosYogur) {
    console.log(`  yogur:     ${tocadosYogur} productos con ${yogurCaja.unidades_por_bin} u/caja (APROXIMADO)`)
  }

  // Los pallets viejos no tenian envase: se les asigna el unico formato que existia.
  const sinEnvase = db.prepare('SELECT COUNT(*) n FROM registros_pallet WHERE envase_id IS NULL').get().n
  if (sinEnvase) {
    const caja = db.prepare("SELECT id FROM envases WHERE nombre = 'Caja 12 × 1 L'").get()
    if (caja) {
      db.prepare('UPDATE registros_pallet SET envase_id = ? WHERE envase_id IS NULL').run(caja.id)
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
    tocados += ponerDias.run({
      nombre,
      madura: m.madura,
      min: m.min ?? null,
      opt: m.opt ?? null,
      max: m.max ?? null,
    }).changes
  }
  if (tocados) console.log(`  maduración: ${tocados} quesos con días DE REFERENCIA (a confirmar)`)
})

cargar()
console.log('Seed listo.')
