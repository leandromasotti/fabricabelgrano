import express from 'express'
import { join, dirname, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { db, ahora, avisarMotor } from './db.js'
import { programarBackups } from './backup.js'
import { acceso, avisarAcceso } from './acceso.js'
import { montarMaestros } from './maestros.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const app = express()

// Express 4 NO atrapa el rechazo de un handler `async`: se vuelve una promesa sin
// manejar y, en Node 20, eso mata el proceso. Con handlers sincrónicos un error de
// consulta devolvía un 500; ahora tumbaría el servidor entero de la fábrica.
//
// Se envuelven todos los handlers una sola vez, acá, en lugar de poner un try/catch en
// cada uno de los 51 — que es justo la clase de cosa que uno se olvida en el que falla.
for (const metodo of ['get', 'post', 'put', 'delete']) {
  const original = app[metodo].bind(app)
  app[metodo] = (ruta, ...handlers) =>
    original(
      ruta,
      ...handlers.map((h) =>
        h.length === 4 ? h : (req, res, next) => Promise.resolve(h(req, res, next)).catch(next)
      )
    )
}
// La clave va ANTES de todo: estático, API y lo que venga después.
app.use(acceso)
app.use(express.json())

// La zona de la FÁBRICA, no la del servidor.
//
// Esta distinción no existía mientras el servidor corría en la misma provincia que la
// planta. En la nube corre en UTC, y entonces "hoy" pasa a significar dos cosas: entre
// las 21 y la medianoche argentinas el servidor ya está en el día siguiente, mientras
// que la base —que convierte con dia_local()— sigue en el anterior. El resultado eran
// pantallas en cero con producción cargada: el servidor pedía un día en el que todavía
// no había pasado nada.
//
// El día de la fábrica se define donde está la fábrica. La base ya lo hacía así; esto
// lo alinea.
const ZONA_FABRICA = process.env.ZONA_FABRICA ?? 'America/Argentina/Buenos_Aires'
const hoyLocal = () => new Date().toLocaleDateString('sv-SE', { timeZone: ZONA_FABRICA })

// Aritmética de días sobre el calendario, sin instantes.
//
// Se ancla al mediodía UTC a propósito: restar 24 h desde la medianoche puede caer en el
// día anterior o en el mismo según el huso y el horario de verano. Desde el mediodía,
// ningún corrimiento de zona alcanza a cambiar la fecha.
const restarDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}
// Existe de verdad, sin mirar `activo`.
//
// La diferencia importa. `activo` significa "no lo ofrezcas más", no "rechazá lo que ya
// pasó": es un filtro del CATÁLOGO, y ahí es donde se aplica. Si acá también filtrara,
// dar de baja un formato de cajón un martes a la mañana descartaría —en silencio, porque
// la cola borra lo que el servidor rechaza como inválido— los pallets que una tablet
// cargó sin red media hora antes en ese mismo formato. El operario vio "PALLET
// REGISTRADO" y el registro no existiría en ningún lado.
//
// Un id inactivo solo puede llegar de un registro viejo en camino, y eso es legítimo:
// el pallet se armó de verdad.
const existe = async (tabla, id) =>
  (await db.prepare(`SELECT 1 FROM ${tabla} WHERE id = ?`).get(id)) !== undefined

// Toda escritura de los sectores comparte estas dos reglas:
//  - client_id repetido = reenvio de la cola offline, se devuelve el original
//  - si viene fecha_hora_cliente, el registro se hizo sin red y la hora es de la tablet
const marcaDeTiempo = (fechaCliente) =>
  fechaCliente
    ? { fecha_hora: fechaCliente, origen: 'offline', sincronizado: ahora() }
    : { fecha_hora: ahora(), origen: 'online', sincronizado: null }

// ABM de datos maestros. Vive en su propio módulo: son cuatro recursos con la misma
// forma y meterlos acá sumaría 300 líneas repetidas a un archivo que ya tiene 2.200.
montarMaestros(app, db)

// ---------------------------------------------------------------- catalogo

const qCatalogo = {
  operarios: db.prepare(
    'SELECT id, nombre FROM operarios WHERE activo = 1 AND sector = ? ORDER BY orden, nombre'
  ),
  // Las marcas se filtran por familia: el yogur va en dos marcas, Obenac no lo hace.
  marcas: db.prepare(`
    SELECT m.id, m.nombre
      FROM marcas m
      JOIN marcas_familias f ON f.marca_id = m.id
     WHERE m.activo = 1 AND f.familia = ?
     ORDER BY m.orden, m.nombre
  `),
  productos: db.prepare(`
    SELECT id, nombre, unidades_por_bin, kilos_por_unidad, datos_provisorios
      FROM productos WHERE activo = 1 AND familia = ? ORDER BY orden, nombre
  `),
  envases: db.prepare(`
    SELECT id, nombre, bultos_por_pallet, unidades_por_bulto, litros_por_unidad, provisorio,
           CASE
             WHEN bultos_por_pallet IS NULL OR unidades_por_bulto IS NULL OR litros_por_unidad IS NULL
             THEN NULL
             ELSE CAST(bultos_por_pallet * unidades_por_bulto * litros_por_unidad AS INTEGER)
           END AS litros_por_pallet
      FROM envases WHERE activo = 1 ORDER BY orden, nombre
  `),
  quesos: db.prepare(
    'SELECT id, nombre, familia, se_envasa FROM tipos_queso WHERE activo = 1 ORDER BY orden, nombre'
  ),
}

app.get('/api/catalogo', async (req, res) => {
  const sector = req.query.sector ?? 'lecheria'
  // El sector de la tablet decide la familia: la de yogures no tiene por que ver
  // marcas ni productos de leche.
  const familia = sector === 'yogures' ? 'yogur' : 'leche'
  res.json({
    operarios: await qCatalogo.operarios.all(sector),
    marcas: await qCatalogo.marcas.all(familia),
    productos: await qCatalogo.productos.all(familia),
    envases: await qCatalogo.envases.all(),
    quesos: await qCatalogo.quesos.all(),
    // Las opciones viajan con el catálogo, que la tablet ya pide al arrancar: una
    // preferencia no merece su propia ida y vuelta.
    opciones: Object.fromEntries(
      (await qOpcionesTablet.todas.all()).map((o) => [o.clave, Boolean(o.activo)])
    ),
    // La tablet usa esto para calcular su desfasaje de reloj. Las tablets amuradas
    // se desconfiguran y nadie las mira, y la hora aca es un dato de proceso.
    serverTime: ahora(),
  })
})

// ---------------------------------------------------------------- recepcion

// Recepcion de leche cruda: el inicio real del circuito.
//
// El caudalimetro imprime un ticket y alguien lo tipea. No tiene salida de datos
// todavia — la fabrica esta trabajando en automatizarlo — asi que la pantalla se
// disena para copiar el ticket rapido, con los campos en el mismo orden en que salen
// impresos: tambo, litros, temperatura.
//
// LO QUE REEMPLAZA TRABAJO NO ES LA CARGA, ES EL REPORTE. Hoy el pago a cada tambo se
// calcula sumando las cantidades a mano. La pantalla de carga solo mueve el tipeo de
// lugar; el reporte por tambo es lo que hace desaparecer la suma.

const qRec = {
  tambos: await db.prepare('SELECT id, numero, nombre FROM tambos WHERE activo = 1 ORDER BY orden, numero'),
  porClientId: db.prepare('SELECT id FROM recepciones WHERE client_id = ?'),
  insertar: db.prepare(`
    INSERT INTO recepciones
      (client_id, fecha_hora, registrado_en, origen, sincronizado, operario_id, tambo_id,
       litros, temperatura, remito)
    VALUES
      (@client_id, @fecha_hora, @registrado_en, @origen, @sincronizado, @operario_id, @tambo_id,
       @litros, @temperatura, @remito)
  `),
  detalle: db.prepare(`
    SELECT r.id, r.client_id, r.fecha_hora, r.origen, r.litros, r.temperatura, r.remito,
           r.anulado, o.nombre AS operario, t.numero AS tambo
      FROM recepciones r
      JOIN operarios o ON o.id = r.operario_id
      JOIN tambos    t ON t.id = r.tambo_id
     WHERE r.id = ?
  `),
  delDia: db.prepare(`
    SELECT r.id, r.fecha_hora, r.origen, r.litros, r.temperatura, r.remito, r.anulado,
           o.nombre AS operario, t.numero AS tambo
      FROM recepciones r
      JOIN operarios o ON o.id = r.operario_id
      JOIN tambos    t ON t.id = r.tambo_id
     WHERE date(r.fecha_hora, 'localtime') = ?
     ORDER BY r.fecha_hora DESC
  `),
  anular: db.prepare(
    'UPDATE recepciones SET anulado = 1, anulado_en = ? WHERE id = ? AND anulado = 0'
  ),
  // El reporte que reemplaza la suma manual.
  //
  // El filtro de tambo se aplica a las TRES consultas, no solo al detalle: si la tabla
  // y los totales siguieran mostrando todos los tambos mientras el detalle muestra uno,
  // los numeros de la misma pantalla se contradicen.
  porTambo: db.prepare(`
    SELECT t.numero AS tambo, t.nombre,
           COUNT(*) AS entregas,
           SUM(r.litros) AS litros,
           ROUND(AVG(r.temperatura), 1) AS temp_promedio,
           MAX(r.temperatura) AS temp_maxima,
           MIN(date(r.fecha_hora, 'localtime')) AS primera,
           MAX(date(r.fecha_hora, 'localtime')) AS ultima
      FROM recepciones r
      JOIN tambos t ON t.id = r.tambo_id
     WHERE r.anulado = 0
       AND date(r.fecha_hora, 'localtime') BETWEEN ? AND ?
       AND (? = '' OR t.numero = ?)
     GROUP BY t.id
     ORDER BY litros DESC
  `),
  porDia: db.prepare(`
    SELECT date(r.fecha_hora, 'localtime') AS fecha,
           COUNT(*) AS entregas, SUM(r.litros) AS litros
      FROM recepciones r
      JOIN tambos t ON t.id = r.tambo_id
     WHERE r.anulado = 0
       AND date(r.fecha_hora, 'localtime') BETWEEN ? AND ?
       AND (? = '' OR t.numero = ?)
     GROUP BY fecha
     ORDER BY fecha
  `),
  detallePeriodo: db.prepare(`
    SELECT r.fecha_hora, t.numero AS tambo, r.litros, r.temperatura, r.remito,
           o.nombre AS operario
      FROM recepciones r
      JOIN tambos    t ON t.id = r.tambo_id
      JOIN operarios o ON o.id = r.operario_id
     WHERE r.anulado = 0
       AND date(r.fecha_hora, 'localtime') BETWEEN ? AND ?
       AND (? = '' OR t.numero = ?)
     ORDER BY r.fecha_hora
  `),
}

app.get('/api/tambos', async (_req, res) => res.json(await qRec.tambos.all()))

app.post('/api/recepciones', async (req, res) => {
  const { client_id, operario_id, tambo_id, litros, temperatura, remito, fecha_hora_cliente } =
    req.body ?? {}

  if (!client_id || !operario_id || !tambo_id) {
    return res.status(400).json({ error: 'faltan campos obligatorios' })
  }
  // Un camion no trae 12 litros ni 200.000. El rango no es una validacion de tipo:
  // atrapa el cero de mas o de menos antes de que entre en una liquidacion.
  if (!Number.isInteger(litros) || litros < 50 || litros > 60000) {
    return res.status(400).json({ error: 'litros fuera de rango (50 a 60.000)' })
  }
  if (temperatura !== null && temperatura !== undefined) {
    if (!(temperatura >= 0 && temperatura <= 40)) {
      return res.status(400).json({ error: 'temperatura fuera de rango (0 a 40 °C)' })
    }
  }

  const previo = await qRec.porClientId.get(client_id)
  if (previo) return res.json({ ...(await qRec.detalle.get(previo.id)), duplicado: true })

  if (!(await existe('operarios', operario_id))) return res.status(400).json({ error: 'operario inexistente' })
  if (!(await existe('tambos', tambo_id))) return res.status(400).json({ error: 'tambo inexistente' })

  const marca = marcaDeTiempo(fecha_hora_cliente)
  const info = await qRec.insertar.run({
    client_id,
    ...marca,
    registrado_en: ahora(),
    operario_id,
    tambo_id,
    litros,
    temperatura: temperatura ?? null,
    remito: remito ?? null,
  })
  res.status(201).json(await qRec.detalle.get(info.lastInsertRowid))
})

app.get('/api/recepciones', async (req, res) => {
  const fecha = req.query.fecha ?? hoyLocal()
  const recepciones = await qRec.delDia.all(fecha)
  const vivas = recepciones.filter((r) => !r.anulado)
  res.json({
    fecha,
    entregas: vivas.length,
    litros: vivas.reduce((n, r) => n + r.litros, 0),
    recepciones,
  })
})

app.post('/api/recepciones/:id/anular', async (req, res) => {
  const id = Number(req.params.id)
  if ((await qRec.anular.run(ahora(), id)).changes === 0) {
    return res.status(404).json({ error: 'no existe o ya estaba anulada' })
  }
  res.json(await qRec.detalle.get(id))
})

// El reporte por tambo: lo que hoy se hace sumando a mano.
app.get('/api/recepciones/reporte', async (req, res) => {
  const [desde, hasta] = rango(req)
  const tambo = req.query.tambo ?? ''

  const porTambo = await qRec.porTambo.all(desde, hasta, tambo, tambo)
  res.json({
    desde,
    hasta,
    por_tambo: porTambo,
    por_dia: await qRec.porDia.all(desde, hasta, tambo, tambo),
    detalle: await qRec.detallePeriodo.all(desde, hasta, tambo, tambo),
    total: {
      litros: porTambo.reduce((n, r) => n + r.litros, 0),
      entregas: porTambo.reduce((n, r) => n + r.entregas, 0),
      tambos: porTambo.length,
    },
  })
})

app.get('/api/recepciones.csv', async (req, res) => {
  const [desde, hasta] = rango(req)
  const tambo = req.query.tambo ?? ''
  const filas = await qRec.porTambo.all(desde, hasta, tambo, tambo)
  const csv = [
    'tambo,entregas,litros,temp_promedio,temp_maxima,primera,ultima',
    ...filas.map((r) =>
      [r.tambo, r.entregas, r.litros, r.temp_promedio ?? '', r.temp_maxima ?? '', r.primera, r.ultima].join(',')
    ),
    ['TOTAL', filas.reduce((n, r) => n + r.entregas, 0), filas.reduce((n, r) => n + r.litros, 0), '', '', desde, hasta].join(','),
  ].join('\n')
  res.type('text/csv').attachment(`leche-cruda-${desde}_${hasta}.csv`).send(csv)
})

// ---------------------------------------------------------------- lecheria

const qPallet = {
  porClientId: db.prepare('SELECT id FROM registros_pallet WHERE client_id = ?'),
  porClientIdCompleto: db.prepare(`
    SELECT id, envase_id, bultos, unidades_por_bulto
      FROM registros_pallet WHERE client_id = ? AND anulado = 0
  `),
  // Los litros salen del ENVASE, no del producto: el mismo tipo de leche puede armarse
  // en caja o en palangana y dar litros distintos.
  //
  // Se congelan en el registro. Si el envase todavia no tiene sus numeros cargados
  // (las palanganas), quedan en NULL y el pallet se guarda igual: no registrar
  // produccion real por no saber una equivalencia seria mucho peor que un dato
  // incompleto que despues se puede completar.
  // Los litros ya no se calculan en el INSERT con un subselect al formato: ahora un
  // pallet puede tener MENOS bultos que el formato (los 20 cajones sueltos del final
  // del dia) o bultos con otra cantidad de unidades (los clientes que piden por 20 en
  // vez de por 18). Las tres cifras se resuelven arriba, en JS, y entran congeladas.
  insertar: db.prepare(`
    INSERT INTO registros_pallet
      (client_id, fecha_hora, origen, sincronizado, operario_id, marca_id, producto_id,
       envase_id, bultos, unidades_por_bulto, litros)
    VALUES
      (@client_id, @fecha_hora, @origen, @sincronizado, @operario_id, @marca_id, @producto_id,
       @envase_id, @bultos, @unidades_por_bulto, @litros)
  `),
  // Correccion dentro de la ventana de la tablet. Va por client_id y no por id porque
  // el pallet puede estar todavia en la cola offline, sin id del servidor.
  corregirCantidades: db.prepare(`
    UPDATE registros_pallet
       SET bultos = @bultos, unidades_por_bulto = @unidades_por_bulto, litros = @litros
     WHERE client_id = @client_id AND anulado = 0
  `),
  detalle: db.prepare(`
    SELECT r.id, r.client_id, r.fecha_hora, r.origen, r.anulado, r.litros,
           -- Lo que realmente se armo, congelado en el alta. bultos_formato viene del
           -- envase y sirve para una sola cosa: saber si el pallet fue completo o no.
           r.bultos, r.unidades_por_bulto,
           o.nombre AS operario, m.nombre AS marca, p.nombre AS producto,
           e.nombre AS envase, e.bultos_por_pallet AS bultos_formato
      FROM registros_pallet r
      JOIN operarios o ON o.id = r.operario_id
      JOIN marcas    m ON m.id = r.marca_id
      JOIN productos p ON p.id = r.producto_id
      LEFT JOIN envases e ON e.id = r.envase_id
     WHERE r.id = ?
  `),
  delDia: db.prepare(`
    SELECT r.id, r.client_id, r.fecha_hora, r.origen, r.anulado, r.litros,
           -- Lo que realmente se armo, congelado en el alta. bultos_formato viene del
           -- envase y sirve para una sola cosa: saber si el pallet fue completo o no.
           r.bultos, r.unidades_por_bulto,
           o.nombre AS operario, m.nombre AS marca, p.nombre AS producto,
           e.nombre AS envase, e.bultos_por_pallet AS bultos_formato
      FROM registros_pallet r
      JOIN operarios o ON o.id = r.operario_id
      JOIN marcas    m ON m.id = r.marca_id
      JOIN productos p ON p.id = r.producto_id
      LEFT JOIN envases e ON e.id = r.envase_id
     -- Por RANGO: un solo día es el rango de un día, así que no hacen falta dos
     -- consultas ni dos caminos que mantener.
     WHERE date(r.fecha_hora, 'localtime') BETWEEN ? AND ?
     ORDER BY r.fecha_hora DESC
  `),
  // Una página del listado. El CSV NO usa esta: baja el período completo, que es
  // justamente para lo que se baja un CSV.
  pagina: db.prepare(`
    SELECT r.id, r.client_id, r.fecha_hora, r.origen, r.anulado, r.litros,
           r.bultos, r.unidades_por_bulto,
           o.nombre AS operario, m.nombre AS marca, p.nombre AS producto,
           e.nombre AS envase, e.bultos_por_pallet AS bultos_formato
      FROM registros_pallet r
      JOIN operarios o ON o.id = r.operario_id
      JOIN marcas    m ON m.id = r.marca_id
      JOIN productos p ON p.id = r.producto_id
      LEFT JOIN envases e ON e.id = r.envase_id
     WHERE date(r.fecha_hora, 'localtime') BETWEEN ? AND ?
     ORDER BY r.fecha_hora DESC
     LIMIT ? OFFSET ?
  `),
  // Los totales salen del PERÍODO, no de la página. Un KPI que cambiara al pasar de
  // página no sería un total de nada.
  resumen: db.prepare(`
    SELECT COUNT(*) AS vivos,
           COALESCE(SUM(r.litros), 0) AS litros,
           SUM(CASE WHEN r.litros IS NULL THEN 1 ELSE 0 END) AS sin_litros
      FROM registros_pallet r
     WHERE r.anulado = 0 AND date(r.fecha_hora, 'localtime') BETWEEN ? AND ?
  `),
  // Cuántas filas hay para paginar. Incluye las anuladas, que se muestran igual.
  filas: db.prepare(`
    SELECT COUNT(*) AS n FROM registros_pallet r
     WHERE date(r.fecha_hora, 'localtime') BETWEEN ? AND ?
  `),
  porProducto: db.prepare(`
    SELECT p.nombre AS producto, COUNT(*) AS n
      FROM registros_pallet r
      JOIN productos p ON p.id = r.producto_id
     WHERE r.anulado = 0 AND date(r.fecha_hora, 'localtime') BETWEEN ? AND ?
     GROUP BY p.id, p.nombre
     ORDER BY n DESC
  `),
  anular: db.prepare(
    'UPDATE registros_pallet SET anulado = 1, anulado_en = ? WHERE id = ? AND anulado = 0'
  ),
}

// Valida una cantidad opcional que viene del cuerpo. Devuelve undefined si no vino,
// null si es invalida. Los topes son generosos a proposito: sirven para atajar un
// dedazo (un 4 de mas), no para modelar la operatoria, que todavia no conocemos.
function cantidadOpcional(v, max) {
  if (v === undefined || v === null || v === '') return undefined
  const n = Number(v)
  return Number.isInteger(n) && n >= 1 && n <= max ? n : null
}

app.post('/api/registros', async (req, res) => {
  const { client_id, operario_id, marca_id, producto_id, envase_id, fecha_hora_cliente } =
    req.body ?? {}

  if (!client_id || !operario_id || !marca_id || !producto_id || !envase_id) {
    return res.status(400).json({ error: 'faltan campos obligatorios' })
  }

  // Reenvio de la cola offline: ya lo teniamos, devolvemos el que existe.
  // Sin esto, cada reintento de sincronizacion duplicaria el pallet.
  const previo = await qPallet.porClientId.get(client_id)
  if (previo) return res.json({ ...(await qPallet.detalle.get(previo.id)), duplicado: true })

  if (!(await existe('operarios', operario_id))) return res.status(400).json({ error: 'operario inexistente' })
  if (!(await existe('marcas', marca_id))) return res.status(400).json({ error: 'marca inexistente' })
  if (!(await existe('productos', producto_id))) return res.status(400).json({ error: 'producto inexistente' })
  if (!(await existe('envases', envase_id))) return res.status(400).json({ error: 'envase inexistente' })

  const bultos = cantidadOpcional(req.body?.bultos, 999)
  const unidades = cantidadOpcional(req.body?.unidades_por_bulto, 999)
  if (bultos === null) return res.status(400).json({ error: 'cantidad de bultos inválida' })
  if (unidades === null) return res.status(400).json({ error: 'unidades por bulto inválidas' })

  // Lo que no viene se toma del formato, y se GUARDA: el registro queda diciendo
  // "40 × 18" para siempre, aunque alguien edite el formato el mes que viene.
  const formato = await qEnvases.uno.get(envase_id)
  const b = bultos ?? formato.bultos_por_pallet
  const u = unidades ?? formato.unidades_por_bulto

  const info = await qPallet.insertar.run({
    client_id,
    ...marcaDeTiempo(fecha_hora_cliente),
    operario_id,
    marca_id,
    producto_id,
    envase_id,
    bultos: b ?? null,
    unidades_por_bulto: u ?? null,
    litros: litrosDePallet(formato, b, u),
  })
  res.status(201).json(await qPallet.detalle.get(info.lastInsertRowid))
})

// Corregir las cantidades de un pallet recien registrado.
//
// Va por client_id y no por id: el pallet puede seguir en la cola offline y todavia no
// tener id del servidor. Es la misma clave que hace idempotente la sincronizacion, asi
// que la correccion llega bien haya viajado el alta o no.
app.put('/api/registros/cantidades', async (req, res) => {
  const { client_id } = req.body ?? {}
  if (!client_id) return res.status(400).json({ error: 'falta client_id' })

  const bultos = cantidadOpcional(req.body?.bultos, 999)
  const unidades = cantidadOpcional(req.body?.unidades_por_bulto, 999)
  if (bultos === null) return res.status(400).json({ error: 'cantidad de bultos inválida' })
  if (unidades === null) return res.status(400).json({ error: 'unidades por bulto inválidas' })

  const actual = await qPallet.porClientIdCompleto.get(client_id)
  if (!actual) return res.status(404).json({ error: 'no existe o ya estaba anulado' })

  const formato = await qEnvases.uno.get(actual.envase_id)
  const b = bultos ?? actual.bultos ?? formato?.bultos_por_pallet
  const u = unidades ?? actual.unidades_por_bulto ?? formato?.unidades_por_bulto

  await qPallet.corregirCantidades.run({
    client_id,
    bultos: b ?? null,
    unidades_por_bulto: u ?? null,
    litros: litrosDePallet(formato, b, u),
  })
  res.json(await qPallet.detalle.get(actual.id))
})

// Acepta un día suelto (?fecha=) o un rango (?desde=&?hasta=). El día suelto se
// conserva porque la tablet de lechería lo usa para su listado de hoy, y porque un
// rango de un día es exactamente eso.
function rangoDia(req) {
  if (req.query.desde || req.query.hasta) {
    const hasta = req.query.hasta ?? hoyLocal()
    return [req.query.desde ?? hasta, hasta]
  }
  const fecha = req.query.fecha ?? hoyLocal()
  return [fecha, fecha]
}

const POR_PAGINA = 25

app.get('/api/registros', async (req, res) => {
  const [desde, hasta] = rangoDia(req)

  const porPagina = Math.min(Math.max(Number(req.query.porPagina) || POR_PAGINA, 1), 500)
  const filas = Number((await qPallet.filas.get(desde, hasta)).n)
  const paginas = Math.max(Math.ceil(filas / porPagina), 1)
  // Si alguien pide la página 9 de un rango que ahora tiene 3, se le devuelve la última
  // en vez de una lista vacía: pasa al cambiar el filtro de fechas estando en una página
  // alta, y una pantalla en blanco ahí se lee como "no hay datos".
  const pagina = Math.min(Math.max(Number(req.query.pagina) || 1, 1), paginas)

  const registros = await qPallet.pagina.all(desde, hasta, porPagina, (pagina - 1) * porPagina)

  // Los totales y el desglose salen del PERÍODO COMPLETO, calculados en la base. Si se
  // sumaran sobre la página, cambiarían al pasar de página y no serían el total de nada.
  const resumen = await qPallet.resumen.get(desde, hasta)

  res.json({
    // `fecha` sigue saliendo para no romper a quien ya la lee; con un rango de varios
    // días es la del final, que es la que la pantalla muestra como "hasta".
    fecha: hasta,
    desde,
    hasta,
    total: Number(resumen.vivos),
    litros: Number(resumen.litros),
    sin_litros: Number(resumen.sin_litros ?? 0),
    por_producto: await qPallet.porProducto.all(desde, hasta),
    pagina,
    por_pagina: porPagina,
    paginas,
    filas,
    registros,
  })
})

app.post('/api/registros/:id/anular', async (req, res) => {
  const id = Number(req.params.id)
  if ((await qPallet.anular.run(ahora(), id)).changes === 0) {
    return res.status(404).json({ error: 'no existe o ya estaba anulado' })
  }
  res.json(await qPallet.detalle.get(id))
})

app.get('/api/registros.csv', async (req, res) => {
  const [desde, hasta] = rangoDia(req)
  const filas = (await qPallet.delDia.all(desde, hasta)).filter((r) => !r.anulado)
  const csv = [
    'fecha_hora,operario,marca,producto,envase,litros,origen',
    ...filas.map((r) =>
      [r.fecha_hora, r.operario, r.marca, r.producto, r.envase ?? '', r.litros ?? '', r.origen].join(',')
    ),
  ].join('\n')
  // El nombre del archivo dice el período: un CSV suelto en Descargas sin eso no se
  // puede distinguir del que se bajó ayer.
  const sello = desde === hasta ? desde : `${desde}_${hasta}`
  res.type('text/csv').attachment(`pallets-${sello}.csv`).send(csv)
})

// ---------------------------------------------------------------- yogur

// Otra tablet y otro flujo: el yogur se registra BIN POR BIN, no por pallet.
//
// El recipiente es un BIN PLASTICO de 500 litros de capacidad, y por eso entran ~500
// sachets de 1 litro. Ese "500 litros" es el dato que explica el numero: si manana
// cambiara el tamano del sachet, la cantidad por bin se deduce de la capacidad.
// Los kilos salen del peso del sachet (1 kg), configurable desde /envases.html.

const qYogur = {
  porClientId: db.prepare('SELECT id FROM registros_yogur WHERE client_id = ?'),
  insertar: db.prepare(`
    INSERT INTO registros_yogur
      (client_id, fecha_hora, origen, sincronizado, operario_id, marca_id, producto_id,
       unidades, kilos)
    VALUES
      (@client_id, @fecha_hora, @origen, @sincronizado, @operario_id, @marca_id, @producto_id,
       @unidades,
       (SELECT CASE WHEN kilos_por_unidad IS NULL THEN NULL
                    ELSE kilos_por_unidad * @unidades END
          FROM productos WHERE id = @producto_id))
  `),
  detalle: db.prepare(`
    SELECT y.id, y.client_id, y.fecha_hora, y.origen, y.unidades, y.kilos, y.anulado,
           o.nombre AS operario, m.nombre AS marca, p.nombre AS producto
      FROM registros_yogur y
      JOIN operarios o ON o.id = y.operario_id
      JOIN marcas    m ON m.id = y.marca_id
      JOIN productos p ON p.id = y.producto_id
     WHERE y.id = ?
  `),
  delDia: db.prepare(`
    SELECT y.id, y.fecha_hora, y.origen, y.unidades, y.kilos, y.anulado,
           o.nombre AS operario, m.nombre AS marca, p.nombre AS producto
      FROM registros_yogur y
      JOIN operarios o ON o.id = y.operario_id
      JOIN marcas    m ON m.id = y.marca_id
      JOIN productos p ON p.id = y.producto_id
     WHERE date(y.fecha_hora, 'localtime') = ?
     ORDER BY y.fecha_hora DESC
  `),
  anular: db.prepare(
    'UPDATE registros_yogur SET anulado = 1, anulado_en = ? WHERE id = ? AND anulado = 0'
  ),
  unidadesDe: db.prepare('SELECT unidades_por_bin FROM productos WHERE id = ?'),
}

app.post('/api/yogur', async (req, res) => {
  const { client_id, operario_id, marca_id, producto_id, unidades, fecha_hora_cliente } =
    req.body ?? {}

  if (!client_id || !operario_id || !marca_id || !producto_id) {
    return res.status(400).json({ error: 'faltan campos obligatorios' })
  }

  const previo = await qYogur.porClientId.get(client_id)
  if (previo) return res.json({ ...(await qYogur.detalle.get(previo.id)), duplicado: true })

  if (!(await existe('operarios', operario_id))) return res.status(400).json({ error: 'operario inexistente' })
  if (!(await existe('marcas', marca_id))) return res.status(400).json({ error: 'marca inexistente' })
  if (!(await existe('productos', producto_id))) return res.status(400).json({ error: 'producto inexistente' })

  // Si la tablet no manda unidades, se usa la cantidad configurada de la caja.
  const porDefecto = (await qYogur.unidadesDe.get(producto_id))?.unidades_por_bin
  const n = unidades ?? porDefecto
  if (!Number.isInteger(n) || n < 1) {
    return res.status(400).json({ error: 'unidades debe ser un entero mayor a cero' })
  }

  const info = await qYogur.insertar.run({
    client_id,
    ...marcaDeTiempo(fecha_hora_cliente),
    operario_id,
    marca_id,
    producto_id,
    unidades: n,
  })
  res.status(201).json(await qYogur.detalle.get(info.lastInsertRowid))
})

app.get('/api/yogur', async (req, res) => {
  const fecha = req.query.fecha ?? hoyLocal()
  const registros = await qYogur.delDia.all(fecha)
  const vivos = registros.filter((r) => !r.anulado)
  res.json({
    fecha,
    bins: vivos.length,
    unidades: vivos.reduce((n, r) => n + r.unidades, 0),
    kilos: vivos.reduce((n, r) => n + (r.kilos ?? 0), 0),
    registros,
  })
})

app.post('/api/yogur/:id/anular', async (req, res) => {
  const id = Number(req.params.id)
  if ((await qYogur.anular.run(ahora(), id)).changes === 0) {
    return res.status(404).json({ error: 'no existe o ya estaba anulado' })
  }
  res.json(await qYogur.detalle.get(id))
})

// ---------------------------------------------------------------- envases (config)

const qEnvases = {
  todos: db.prepare(`
    SELECT id, nombre, bultos_por_pallet, unidades_por_bulto, litros_por_unidad,
           provisorio, activo, orden
      FROM envases ORDER BY orden, nombre
  `),
  // provisorio = false SOLO si los tres valores estan. Marcarlo confirmado con datos a
  // medias dejaria un formato que dice "confirmado" pero sigue sin poder calcular
  // litros, que es la peor combinacion: el tag miente y nadie vuelve a completarlo.
  // La condicion se evalua en JS (ver mas abajo) y no con un CASE: los valores ya
  // estan ahi, y un parametro que solo aparece dentro de un IS NOT NULL no tiene tipo
  // deducible para Postgres.
  actualizar: db.prepare(`
    UPDATE envases
       SET bultos_por_pallet = @bultos, unidades_por_bulto = @unidades,
           litros_por_unidad = @litros, provisorio = @provisorio
     WHERE id = @id
  `),
  usos: db.prepare('SELECT COUNT(*) n FROM registros_pallet WHERE envase_id = ? AND anulado = 0'),
  uno: db.prepare(`
    SELECT id, nombre, bultos_por_pallet, unidades_por_bulto, litros_por_unidad, activo, orden
      FROM envases WHERE id = ?
  `),
  crear: db.prepare(`
    INSERT INTO envases (nombre, bultos_por_pallet, unidades_por_bulto, litros_por_unidad,
                         provisorio, activo, orden)
    -- true y no 1: el traductor a Postgres convierte las COMPARACIONES booleanas,
    -- no los literales de un VALUES. SQLite acepta la palabra desde la 3.23.
    VALUES (@nombre, @bultos, @unidades, @litros, @provisorio, true, @orden)
  `),
  // Se reordena y se da de baja sin tocar los numeros: son dos decisiones distintas y
  // mezclarlas obliga a reescribir el formato entero para moverlo de lugar.
  visibilidad: db.prepare('UPDATE envases SET activo = @activo, orden = @orden WHERE id = @id'),
  ordenMaximo: db.prepare('SELECT COALESCE(MAX(orden), 0) AS n FROM envases'),
  porNombre: db.prepare('SELECT id FROM envases WHERE nombre = ?'),
}

/**
 * Litros de un pallet, a partir del formato y de lo que realmente se armó.
 *
 * Devuelve null y no 0 cuando falta un dato: un pallet sin equivalencia conocida no
 * aporta cero litros al total, aporta "no sabemos". Un cero se sumaría en silencio.
 */
function litrosDePallet(formato, bultos, unidades) {
  const l = formato?.litros_por_unidad
  if (!bultos || !unidades || !l) return null
  return Math.round(bultos * unidades * l)
}

// Formato de la caja de yogur. Vive en `productos` y no en `envases` porque no es un
// formato de pallet: el yogur se registra caja por caja. Se sirve junto con los
// envases para que haya UNA sola pantalla donde se cargan las equivalencias.
const qYogurFormato = {
  todos: db.prepare(`
    SELECT id, nombre, unidades_por_bin, kilos_por_unidad, datos_provisorios
      FROM productos WHERE familia = 'yogur' AND activo = 1 ORDER BY orden, nombre
  `),
  actualizar: db.prepare(`
    UPDATE productos
       SET unidades_por_bin = @unidades, kilos_por_unidad = @kilos,
           datos_provisorios = @provisorios
     WHERE id = @id AND familia = 'yogur'
  `),
  usos: db.prepare('SELECT COUNT(*) n FROM registros_yogur WHERE producto_id = ? AND anulado = 0'),
  sinKilos: db.prepare(`
    SELECT COUNT(*) n FROM registros_yogur
     WHERE producto_id = ? AND anulado = 0 AND kilos IS NULL
  `),
}

// Un formato incompleto no tiene equivalencia en litros: devuelve null, no 0. Un cero
// se sumaria en los totales como si el pallet estuviera vacio.
const litrosPorPallet = (e) =>
  e && e.bultos_por_pallet && e.unidades_por_bulto && e.litros_por_unidad
    ? Math.round(e.bultos_por_pallet * e.unidades_por_bulto * e.litros_por_unidad)
    : null

app.get('/api/envases', async (_req, res) => {
  // Promise.all y no un for: las consultas por fila salen en paralelo, que con una
  // base en red es la diferencia entre una ida y vuelta y N.
  const pallets = await Promise.all(
    (await qEnvases.todos.all()).map(async (e) => ({
      ...e,
      litros_por_pallet: litrosPorPallet(e),
      // Cuantos pallets se registraron con este formato. Si un envase provisorio ya
      // tiene pallets encima, completarlo no alcanza: hay que recalcular esos litros.
      pallets: (await qEnvases.usos.get(e.id)).n,
    }))
  )
  const yogur = await Promise.all(
    (await qYogurFormato.todos.all()).map(async (y) => ({
      ...y,
      kilos_por_bin:
        y.unidades_por_bin && y.kilos_por_unidad
          ? Math.round(y.unidades_por_bin * y.kilos_por_unidad * 100) / 100
          : null,
      bins: (await qYogurFormato.usos.get(y.id)).n,
      bins_sin_kilos: (await qYogurFormato.sinKilos.get(y.id)).n,
    }))
  )
  res.json({ pallets, yogur })
})

app.put('/api/yogur/formato/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (!(await qYogurFormato.todos.all()).some((y) => y.id === id)) {
    return res.status(404).json({ error: 'producto de yogur inexistente' })
  }

  const limpio = (v) => (v === null || v === undefined || v === '' ? null : Number(v))
  const unidades = limpio(req.body?.unidades_por_bin)
  const kilos = limpio(req.body?.kilos_por_unidad)

  if (unidades !== null && (!Number.isInteger(unidades) || unidades < 1 || unidades > 100000)) {
    return res.status(400).json({ error: 'unidades por caja: valor inválido' })
  }
  if (kilos !== null && !(kilos > 0 && kilos <= 100)) {
    return res.status(400).json({ error: 'kilos por sachet: valor inválido' })
  }

  await qYogurFormato.actualizar.run({
    id, unidades, kilos,
    provisorios: unidades === null || kilos === null,
  })

  // Las cajas ya registradas sin kilos se completan, igual que los pallets al cargar
  // un formato: esos kilos nunca se supieron, no es que hayan cambiado.
  let rellenadas = 0
  if (kilos !== null) {
    rellenadas = (await db.prepare(`
      UPDATE registros_yogur
         SET kilos = unidades * ?
       WHERE producto_id = ? AND kilos IS NULL AND anulado = 0
    `).run(kilos, id)).changes
  }

  res.json({ ok: true, bins_rellenados: rellenadas })
})

app.put('/api/envases/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (!(await existe('envases', id))) return res.status(404).json({ error: 'envase inexistente' })

  const limpio = (v) => (v === null || v === undefined || v === '' ? null : Number(v))
  const bultos = limpio(req.body?.bultos_por_pallet)
  const unidades = limpio(req.body?.unidades_por_bulto)
  const litros = limpio(req.body?.litros_por_unidad)

  for (const [n, v, entero] of [
    ['bultos por pallet', bultos, true],
    ['unidades por bulto', unidades, true],
    ['litros por unidad', litros, false],
  ]) {
    if (v === null) continue
    if (entero ? !Number.isInteger(v) || v < 1 : !(v > 0)) {
      return res.status(400).json({ error: `${n}: valor inválido` })
    }
  }

  await qEnvases.actualizar.run({
    id, bultos, unidades, litros,
    provisorio: bultos === null || unidades === null || litros === null,
  })

  // Al completar un envase que ya tenia pallets registrados sin litros, se rellenan.
  // Es el unico caso en que se toca un registro historico, y es correcto: esos litros
  // nunca se supieron, no es que hayan cambiado.
  const rellenados = (await db.prepare(`
    UPDATE registros_pallet
       SET litros = (
         SELECT CAST(bultos_por_pallet * unidades_por_bulto * litros_por_unidad AS INTEGER)
           FROM envases WHERE id = ?
       )
     WHERE envase_id = ? AND litros IS NULL
  `).run(id, id)).changes

  const actualizado = (await qEnvases.todos.all()).find((e) => e.id === id)
  res.json({ ...actualizado, litros_por_pallet: litrosPorPallet(actualizado), pallets_rellenados: rellenados })
})

// Alta de un formato.
//
// Hasta ahora agregar un cajón nuevo necesitaba un desarrollador, y la lista se mueve: el
// 2026-09-22 salieron "Sancor" y "La Serenísima" —eran el mismo cajón con el nombre del
// cliente— y entró la distinción que sí importa, x 18 contra x 20. Además todos están en
// camino de desaparecer conforme pasan de cajones a cajas. Que lo cargue y lo dé de baja
// el encargado es la diferencia entre acompañar ese cambio o quedar atrás de él.
app.post('/api/envases', async (req, res) => {
  const nombre = String(req.body?.nombre ?? '').trim()
  if (!nombre) return res.status(400).json({ error: 'falta el nombre' })
  if (nombre.length > 60) return res.status(400).json({ error: 'nombre demasiado largo' })
  if (await qEnvases.porNombre.get(nombre)) {
    return res.status(409).json({ error: 'ya existe un formato con ese nombre' })
  }

  const limpio = (v) => (v === null || v === undefined || v === '' ? null : Number(v))
  const bultos = limpio(req.body?.bultos_por_pallet)
  const unidades = limpio(req.body?.unidades_por_bulto)
  const litros = limpio(req.body?.litros_por_unidad)

  for (const [n, v, entero] of [
    ['bultos por pallet', bultos, true],
    ['unidades por bulto', unidades, true],
    ['litros por unidad', litros, false],
  ]) {
    if (v === null) continue
    if (entero ? !Number.isInteger(v) || v < 1 : !(v > 0)) {
      return res.status(400).json({ error: `${n}: valor inválido` })
    }
  }

  // Se puede crear incompleto: es preferible tener el formato listado y marcado "a
  // confirmar" a que el operario no encuentre dónde registrar el pallet que ya armó.
  const provisorio = bultos === null || unidades === null || litros === null
  const orden = ((await qEnvases.ordenMaximo.get()).n ?? 0) + 1

  const info = await qEnvases.crear.run({ nombre, bultos, unidades, litros, provisorio, orden })
  const creado = (await qEnvases.todos.all()).find((e) => e.id === info.lastInsertRowid)
  res.status(201).json({ ...creado, litros_por_pallet: litrosPorPallet(creado) })
})

// Activar, desactivar y reordenar. Separado del PUT de los números porque son dos
// decisiones distintas: mover un formato de lugar no debería obligar a reescribir sus
// equivalencias.
app.put('/api/envases/:id/visibilidad', async (req, res) => {
  const id = Number(req.params.id)
  const actual = await qEnvases.uno.get(id)
  if (!actual) return res.status(404).json({ error: 'envase inexistente' })

  const activo = req.body?.activo === undefined ? Boolean(actual.activo) : Boolean(req.body.activo)
  const orden = Number(req.body?.orden)
  if (req.body?.orden !== undefined && (!Number.isInteger(orden) || orden < 0 || orden > 999)) {
    return res.status(400).json({ error: 'orden inválido' })
  }

  // Lo que no viene se deja como está. Pasar undefined haría que el adaptador lo ligue
  // como NULL, y `orden` es NOT NULL: el UPDATE fallaría por omitir un campo.
  await qEnvases.visibilidad.run({
    id,
    activo,
    orden: req.body?.orden === undefined ? actual.orden : orden,
  })
  const r = (await qEnvases.todos.all()).find((e) => e.id === id)
  res.json({ ...r, litros_por_pallet: litrosPorPallet(r) })
})

// ---------------------------------------------------------------- queseria

const qTina = {
  porClientId: db.prepare('SELECT id FROM tinas WHERE client_id = ?'),
  insertar: db.prepare(`
    INSERT INTO tinas
      (client_id, fecha_hora, origen, sincronizado, operario_id, tipo_queso_id, cantidad)
    VALUES
      (@client_id, @fecha_hora, @origen, @sincronizado, @operario_id, @tipo_queso_id, @cantidad)
  `),
  detalle: db.prepare(`
    SELECT t.id, t.client_id, t.fecha_hora, t.origen, t.cantidad, t.anulado,
           o.nombre AS operario, q.nombre AS queso, q.familia
      FROM tinas t
      JOIN operarios   o ON o.id = t.operario_id
      JOIN tipos_queso q ON q.id = t.tipo_queso_id
     WHERE t.id = ?
  `),
  delDia: db.prepare(`
    SELECT t.id, t.fecha_hora, t.origen, t.cantidad, t.anulado,
           o.nombre AS operario, q.nombre AS queso, q.familia
      FROM tinas t
      JOIN operarios   o ON o.id = t.operario_id
      JOIN tipos_queso q ON q.id = t.tipo_queso_id
     WHERE date(t.fecha_hora, 'localtime') = ?
     ORDER BY t.fecha_hora DESC
  `),
  anular: db.prepare('UPDATE tinas SET anulado = 1, anulado_en = ? WHERE id = ? AND anulado = 0'),
}

app.post('/api/tinas', async (req, res) => {
  const { client_id, operario_id, tipo_queso_id, cantidad, fecha_hora_cliente } = req.body ?? {}

  if (!client_id || !operario_id || !tipo_queso_id) {
    return res.status(400).json({ error: 'faltan campos obligatorios' })
  }
  // El rinde es variable (117 / 120 / 124 segun la altura de la masa), pero cero o
  // negativo es siempre un error de carga.
  if (!Number.isInteger(cantidad) || cantidad < 1) {
    return res.status(400).json({ error: 'cantidad debe ser un entero mayor a cero' })
  }

  const previo = await qTina.porClientId.get(client_id)
  if (previo) return res.json({ ...(await qTina.detalle.get(previo.id)), duplicado: true })

  if (!(await existe('operarios', operario_id))) return res.status(400).json({ error: 'operario inexistente' })
  if (!(await existe('tipos_queso', tipo_queso_id))) return res.status(400).json({ error: 'queso inexistente' })

  const info = await qTina.insertar.run({
    client_id,
    ...marcaDeTiempo(fecha_hora_cliente),
    operario_id,
    tipo_queso_id,
    cantidad,
  })
  res.status(201).json(await qTina.detalle.get(info.lastInsertRowid))
})

app.get('/api/tinas', async (req, res) => {
  const fecha = req.query.fecha ?? hoyLocal()
  const tinas = await qTina.delDia.all(fecha)
  const vivas = tinas.filter((t) => !t.anulado)
  res.json({
    fecha,
    total: vivas.length,
    piezas: vivas.reduce((n, t) => n + t.cantidad, 0),
    tinas,
  })
})

app.post('/api/tinas/:id/anular', async (req, res) => {
  const id = Number(req.params.id)
  if ((await qTina.anular.run(ahora(), id)).changes === 0) {
    return res.status(404).json({ error: 'no existe o ya estaba anulada' })
  }
  res.json(await qTina.detalle.get(id))
})

// ---------------------------------------------------------------- saladero

// El saldo sale de sumar eventos, no de un estado guardado en la tina: asi una tina
// puede entrar entera y salir en tandas sin que haya que decidirlo de antemano.
const SALDOS = `
  SELECT t.id, t.fecha_hora, t.cantidad, q.nombre AS queso, q.familia,
         COALESCE(SUM(CASE WHEN m.tipo = 'entrada' THEN m.cantidad END), 0) AS entrada,
         COALESCE(SUM(CASE WHEN m.tipo = 'salida'  THEN m.cantidad END), 0) AS salida,
         MIN(CASE WHEN m.tipo = 'entrada' THEN m.fecha_hora END) AS primera_entrada
    FROM tinas t
    JOIN tipos_queso q ON q.id = t.tipo_queso_id
    LEFT JOIN movimientos_saladero m ON m.tina_id = t.id AND m.anulado = 0
   WHERE t.anulado = 0
   -- q.id va en el GROUP BY porque Postgres solo deja proyectar columnas no agregadas
   -- si dependen de una PK agrupada: q.nombre depende de q.id, no de t.id. SQLite lo
   -- dejaba pasar eligiendo un valor cualquiera.
   GROUP BY t.id, q.id
`

const qSal = {
  pendientes: db.prepare(`SELECT * FROM (${SALDOS}) s WHERE entrada < cantidad ORDER BY fecha_hora`),
  enSal: db.prepare(`SELECT * FROM (${SALDOS}) s WHERE entrada > salida ORDER BY primera_entrada`),
  saldoDe: db.prepare(`SELECT * FROM (${SALDOS}) s WHERE id = ?`),
  porClientId: db.prepare('SELECT id FROM movimientos_saladero WHERE client_id = ?'),
  insertar: db.prepare(`
    INSERT INTO movimientos_saladero
      (client_id, fecha_hora, origen, sincronizado, operario_id, tina_id, tipo, cantidad)
    VALUES
      (@client_id, @fecha_hora, @origen, @sincronizado, @operario_id, @tina_id, @tipo, @cantidad)
  `),
  detalle: db.prepare(`
    SELECT m.id, m.client_id, m.fecha_hora, m.origen, m.tipo, m.cantidad, m.anulado, m.tina_id,
           o.nombre AS operario, q.nombre AS queso
      FROM movimientos_saladero m
      JOIN operarios   o ON o.id = m.operario_id
      JOIN tinas       t ON t.id = m.tina_id
      JOIN tipos_queso q ON q.id = t.tipo_queso_id
     WHERE m.id = ?
  `),
  delDia: db.prepare(`
    SELECT m.id, m.fecha_hora, m.origen, m.tipo, m.cantidad, m.anulado, m.tina_id,
           o.nombre AS operario, q.nombre AS queso
      FROM movimientos_saladero m
      JOIN operarios   o ON o.id = m.operario_id
      JOIN tinas       t ON t.id = m.tina_id
      JOIN tipos_queso q ON q.id = t.tipo_queso_id
     WHERE date(m.fecha_hora, 'localtime') = ?
     ORDER BY m.fecha_hora DESC
  `),
  anular: db.prepare(
    'UPDATE movimientos_saladero SET anulado = 1, anulado_en = ? WHERE id = ? AND anulado = 0'
  ),
}

const minutosDesde = (iso) => Math.round((Date.now() - Date.parse(iso)) / 60000)

// minutos_desde_produccion es el dato del control de pH: "eso te da un tiempo, entre
// que el pH llega donde tiene que llegar" [A3 01:08]. Por eso el saladero no muestra
// una lista de tinas a secas, sino cuanto hace que esperan.
app.get('/api/saladero/pendientes', async (_req, res) => {
  res.json(
    (await qSal.pendientes.all()).map((t) => ({
      ...t,
      falta: t.cantidad - t.entrada,
      minutos_desde_produccion: minutosDesde(t.fecha_hora),
    }))
  )
})

app.get('/api/saladero/en-sal', async (_req, res) => {
  res.json(
    (await qSal.enSal.all()).map((t) => ({
      ...t,
      en_sal: t.entrada - t.salida,
      minutos_en_sal: t.primera_entrada ? minutosDesde(t.primera_entrada) : null,
    }))
  )
})

app.post('/api/saladero', async (req, res) => {
  const { client_id, operario_id, tina_id, tipo, cantidad, fecha_hora_cliente } = req.body ?? {}

  if (!client_id || !operario_id || !tina_id || !tipo) {
    return res.status(400).json({ error: 'faltan campos obligatorios' })
  }
  if (tipo !== 'entrada' && tipo !== 'salida') {
    return res.status(400).json({ error: 'tipo debe ser entrada o salida' })
  }
  if (!Number.isInteger(cantidad) || cantidad < 1) {
    return res.status(400).json({ error: 'cantidad debe ser un entero mayor a cero' })
  }

  const previo = await qSal.porClientId.get(client_id)
  if (previo) return res.json({ ...(await qSal.detalle.get(previo.id)), duplicado: true })

  if (!(await existe('operarios', operario_id))) return res.status(400).json({ error: 'operario inexistente' })

  const saldo = await qSal.saldoDe.get(tina_id)
  if (!saldo) return res.status(400).json({ error: 'tina inexistente o anulada' })

  // No se puede salar mas de lo que se produjo, ni sacar mas de lo que hay adentro.
  const tope = tipo === 'entrada' ? saldo.cantidad - saldo.entrada : saldo.entrada - saldo.salida
  if (cantidad > tope) {
    return res.status(409).json({
      error: tipo === 'entrada' ? 'excede lo producido en la tina' : 'excede lo que hay en sal',
      disponible: tope,
    })
  }

  const info = await qSal.insertar.run({
    client_id,
    ...marcaDeTiempo(fecha_hora_cliente),
    operario_id,
    tina_id,
    tipo,
    cantidad,
  })
  res.status(201).json(await qSal.detalle.get(info.lastInsertRowid))
})

app.get('/api/saladero', async (req, res) => {
  const fecha = req.query.fecha ?? hoyLocal()
  const movimientos = await qSal.delDia.all(fecha)
  const vivos = movimientos.filter((m) => !m.anulado)
  const sumar = (tipo) =>
    vivos.filter((m) => m.tipo === tipo).reduce((n, m) => n + m.cantidad, 0)
  res.json({ fecha, entradas: sumar('entrada'), salidas: sumar('salida'), movimientos })
})

app.post('/api/saladero/:id/anular', async (req, res) => {
  const id = Number(req.params.id)
  if ((await qSal.anular.run(ahora(), id)).changes === 0) {
    return res.status(404).json({ error: 'no existe o ya estaba anulado' })
  }
  res.json(await qSal.detalle.get(id))
})

// ---------------------------------------------------------------- maduracion

// "Si yo sé los que hay ahí y sé CUÁNDO ENTRARON, sé cuántos días tienen los pategrás
// de maduración, para saber si van a abrir ojos" [A5 00:39-00:51].
//
// El reloj arranca al ENTRAR a la cámara, no al producir: entre producir y madurar hay
// saladero, y contar esos días como maduración declararía apto un queso todavía verde.
//
// QUIÉN ENTRA A CÁMARA lo decide `madura`, y sólo eso. Es una pregunta distinta de
// `madura_antes_de_envasar`, que decide si esa maduración bloquea el envasado:
//
//   madura = 0                       -> no aparece nunca acá (cremoso, tybo, muzzarellas)
//   madura = 1, madura_antes = 1     -> entra desnudo y se envasa al salir (pategrás)
//   madura = 1, madura_antes = 0     -> madura después de envasarse (provoleta)
//
// El tybo tenía `madura = 1` con días de referencia de semiduro y por eso aparecía acá,
// pero es un queso barra y funciona como el cremoso: sale de sal y espera envasado
// (corregido 2026-09-24). Ver docs/12-circuitos-del-queso.md.

const MADURACION_SALDOS = `
  SELECT t.id, t.fecha_hora, t.cantidad, q.nombre AS queso, q.familia,
         q.madura, q.se_envasa,
         q.dias_minimos, q.dias_optimos, q.dias_maximos, q.dias_provisorios,
         (SELECT COALESCE(SUM(m.cantidad), 0) FROM movimientos_saladero m
           WHERE m.tina_id = t.id AND m.tipo = 'salida' AND m.anulado = 0) AS salio_de_sal,
         (SELECT COALESCE(SUM(x.cantidad), 0) FROM movimientos_maduracion x
           WHERE x.tina_id = t.id AND x.tipo = 'entrada' AND x.anulado = 0) AS entro_camara,
         (SELECT COALESCE(SUM(x.cantidad), 0) FROM movimientos_maduracion x
           WHERE x.tina_id = t.id AND x.tipo = 'salida' AND x.anulado = 0) AS salio_camara,
         (SELECT MIN(x.fecha_hora) FROM movimientos_maduracion x
           WHERE x.tina_id = t.id AND x.tipo = 'entrada' AND x.anulado = 0) AS entrada_camara
    FROM tinas t
    JOIN tipos_queso q ON q.id = t.tipo_queso_id
   WHERE t.anulado = 0
`

const qMad = {
  // Salieron de sal, maduran, y todavía no entraron (del todo) a la cámara.
  paraEntrar: db.prepare(`
    SELECT * FROM (${MADURACION_SALDOS}) s
     WHERE madura = 1 AND salio_de_sal > entro_camara
     ORDER BY fecha_hora
  `),
  // Adentro de la cámara ahora.
  enCamara: db.prepare(`
    SELECT * FROM (${MADURACION_SALDOS}) s
     WHERE entro_camara > salio_camara
     ORDER BY entrada_camara
  `),
  saldoDe: db.prepare(`SELECT * FROM (${MADURACION_SALDOS}) s WHERE id = ?`),
  porClientId: db.prepare('SELECT id FROM movimientos_maduracion WHERE client_id = ?'),
  insertar: db.prepare(`
    INSERT INTO movimientos_maduracion
      (client_id, fecha_hora, origen, sincronizado, operario_id, tina_id, tipo, cantidad, dias_reales)
    VALUES
      (@client_id, @fecha_hora, @origen, @sincronizado, @operario_id, @tina_id, @tipo, @cantidad, @dias_reales)
  `),
  detalle: db.prepare(`
    SELECT x.id, x.client_id, x.fecha_hora, x.origen, x.tipo, x.cantidad, x.dias_reales,
           x.anulado, x.tina_id, o.nombre AS operario, q.nombre AS queso
      FROM movimientos_maduracion x
      JOIN operarios   o ON o.id = x.operario_id
      JOIN tinas       t ON t.id = x.tina_id
      JOIN tipos_queso q ON q.id = t.tipo_queso_id
     WHERE x.id = ?
  `),
  delDia: db.prepare(`
    SELECT x.id, x.fecha_hora, x.origen, x.tipo, x.cantidad, x.dias_reales, x.anulado,
           o.nombre AS operario, q.nombre AS queso
      FROM movimientos_maduracion x
      JOIN operarios   o ON o.id = x.operario_id
      JOIN tinas       t ON t.id = x.tina_id
      JOIN tipos_queso q ON q.id = t.tipo_queso_id
     WHERE date(x.fecha_hora, 'localtime') = ?
     ORDER BY x.fecha_hora DESC
  `),
  anular: db.prepare(
    'UPDATE movimientos_maduracion SET anulado = 1, anulado_en = ? WHERE id = ? AND anulado = 0'
  ),
  // Lo que realmente tardó cada queso, para comparar contra el número teórico.
  realesPorQueso: db.prepare(`
    SELECT q.nombre AS queso, COUNT(*) AS lotes,
           ROUND(AVG(x.dias_reales)) AS promedio,
           MIN(x.dias_reales) AS minimo, MAX(x.dias_reales) AS maximo
      FROM movimientos_maduracion x
      JOIN tinas       t ON t.id = x.tina_id
      JOIN tipos_queso q ON q.id = t.tipo_queso_id
     WHERE x.tipo = 'salida' AND x.anulado = 0 AND x.dias_reales IS NOT NULL
     GROUP BY q.id
     ORDER BY lotes DESC
  `),
}

const dias = (desde) => Math.floor((Date.now() - Date.parse(desde)) / 864e5)

// Cuatro estados, no dos. Un queso no pasa de "no apto" a "apto" un martes a las 8:
// hay un mínimo antes del cual no se vende, un punto, y un momento en que se pasó.
// Con un solo número el sistema falla justo en los bordes, que es donde se decide.
function estadoMaduracion(t, diasAdentro) {
  if (!t.dias_minimos) return { estado: 'sin_dato', falta: null }
  if (diasAdentro < t.dias_minimos) return { estado: 'falta', falta: t.dias_minimos - diasAdentro }
  if (t.dias_maximos && diasAdentro > t.dias_maximos) return { estado: 'pasado', falta: 0 }
  if (t.dias_optimos && diasAdentro >= t.dias_optimos) return { estado: 'optimo', falta: 0 }
  return { estado: 'apto', falta: 0 }
}

app.get('/api/maduracion/pendientes', async (_req, res) => {
  res.json(
    (await qMad.paraEntrar.all()).map((t) => ({
      ...t,
      falta: t.salio_de_sal - t.entro_camara,
      minutos_desde_sal: null,
    }))
  )
})

app.get('/api/maduracion/camara', async (_req, res) => {
  const lotes = (await qMad.enCamara.all()).map((t) => {
    const diasAdentro = t.entrada_camara ? dias(t.entrada_camara) : 0
    return {
      ...t,
      en_camara: t.entro_camara - t.salio_camara,
      dias_adentro: diasAdentro,
      ...estadoMaduracion(t, diasAdentro),
    }
  })

  const porEstado = (e) => lotes.filter((l) => l.estado === e)
  res.json({
    lotes,
    resumen: {
      total: lotes.reduce((n, l) => n + l.en_camara, 0),
      falta: porEstado('falta').reduce((n, l) => n + l.en_camara, 0),
      apto: porEstado('apto').reduce((n, l) => n + l.en_camara, 0),
      optimo: porEstado('optimo').reduce((n, l) => n + l.en_camara, 0),
      pasado: porEstado('pasado').reduce((n, l) => n + l.en_camara, 0),
      sin_dato: porEstado('sin_dato').reduce((n, l) => n + l.en_camara, 0),
    },
  })
})

app.post('/api/maduracion', async (req, res) => {
  const { client_id, operario_id, tina_id, tipo, cantidad, fecha_hora_cliente } = req.body ?? {}

  if (!client_id || !operario_id || !tina_id || !tipo) {
    return res.status(400).json({ error: 'faltan campos obligatorios' })
  }
  if (tipo !== 'entrada' && tipo !== 'salida') {
    return res.status(400).json({ error: 'tipo debe ser entrada o salida' })
  }
  if (!Number.isInteger(cantidad) || cantidad < 1) {
    return res.status(400).json({ error: 'cantidad debe ser un entero mayor a cero' })
  }

  const previo = await qMad.porClientId.get(client_id)
  if (previo) return res.json({ ...(await qMad.detalle.get(previo.id)), duplicado: true })

  if (!(await existe('operarios', operario_id))) return res.status(400).json({ error: 'operario inexistente' })

  const saldo = await qMad.saldoDe.get(tina_id)
  if (!saldo) return res.status(400).json({ error: 'tina inexistente o anulada' })
  if (tipo === 'entrada' && !saldo.madura) {
    return res.status(409).json({ error: `el ${saldo.queso} no madura` })
  }

  const tope =
    tipo === 'entrada'
      ? saldo.salio_de_sal - saldo.entro_camara
      : saldo.entro_camara - saldo.salio_camara
  if (cantidad > tope) {
    return res.status(409).json({
      error: tipo === 'entrada' ? 'excede lo que salió de sal' : 'excede lo que hay en cámara',
      disponible: tope,
    })
  }

  // Al salir se congela cuántos días estuvo. Guardarlo cerrado permite comparar
  // después lo REAL contra el número teórico, sin recalcular nada.
  const diasReales =
    tipo === 'salida' && saldo.entrada_camara ? dias(saldo.entrada_camara) : null

  const info = await qMad.insertar.run({
    client_id,
    ...marcaDeTiempo(fecha_hora_cliente),
    operario_id,
    tina_id,
    tipo,
    cantidad,
    dias_reales: diasReales,
  })
  res.status(201).json(await qMad.detalle.get(info.lastInsertRowid))
})

app.get('/api/maduracion', async (req, res) => {
  const fecha = req.query.fecha ?? hoyLocal()
  const movimientos = await qMad.delDia.all(fecha)
  const vivos = movimientos.filter((m) => !m.anulado)
  const sumar = (tipo) => vivos.filter((m) => m.tipo === tipo).reduce((n, m) => n + m.cantidad, 0)
  res.json({ fecha, entradas: sumar('entrada'), salidas: sumar('salida'), movimientos })
})

app.post('/api/maduracion/:id/anular', async (req, res) => {
  const id = Number(req.params.id)
  if ((await qMad.anular.run(ahora(), id)).changes === 0) {
    return res.status(404).json({ error: 'no existe o ya estaba anulado' })
  }
  res.json(await qMad.detalle.get(id))
})

// ---------------------------------------------------------------- días de maduración

const qDias = {
  todos: db.prepare(`
    SELECT id, nombre, familia, madura, se_envasa,
           dias_minimos, dias_optimos, dias_maximos, dias_provisorios
      FROM tipos_queso WHERE activo = 1 ORDER BY orden, nombre
  `),
  actualizar: db.prepare(`
    UPDATE tipos_queso
       SET madura = @madura, dias_minimos = @min, dias_optimos = @opt, dias_maximos = @max,
           dias_provisorios = 0
     WHERE id = @id
  `),
}

app.get('/api/quesos/dias', async (_req, res) => {
  res.json({
    quesos: await qDias.todos.all(),
    // Lo que tardaron de verdad, para contrastar contra el número cargado.
    reales: await qMad.realesPorQueso.all(),
  })
})

app.put('/api/quesos/:id/dias', async (req, res) => {
  const { madura, dias_minimos, dias_optimos, dias_maximos } = req.body ?? {}
  const id = Number(req.params.id)
  if (!(await existe('tipos_queso', id))) return res.status(404).json({ error: 'queso inexistente' })

  const limpio = (v) => (v === null || v === undefined || v === '' ? null : Number(v))
  const min = limpio(dias_minimos)
  const opt = limpio(dias_optimos)
  const max = limpio(dias_maximos)

  for (const [n, v] of [['mínimo', min], ['óptimo', opt], ['máximo', max]]) {
    if (v !== null && (!Number.isInteger(v) || v < 1 || v > 2000)) {
      return res.status(400).json({ error: `el ${n} debe ser un entero entre 1 y 2000` })
    }
  }
  // Un óptimo menor al mínimo dejaría el estado "apto" inalcanzable.
  if (min !== null && opt !== null && opt < min) {
    return res.status(400).json({ error: 'el óptimo no puede ser menor al mínimo' })
  }
  if (opt !== null && max !== null && max < opt) {
    return res.status(400).json({ error: 'el máximo no puede ser menor al óptimo' })
  }

  // Escribir marca dias_provisorios = 0: a partir de acá el valor es del quesero, y
  // ningún seed posterior lo pisa.
  await qDias.actualizar.run({ id, madura: madura ? 1 : 0, min, opt, max })
  res.json((await qDias.todos.all()).find((q) => q.id === id))
})

// ---------------------------------------------------------------- envasado

// "Una vez que sale del saladero, el queso desnudo va a una camara de desnudo, y
// desde esa camara el flaco que los envasa envasa las barras, envasa el cremoso.
// Los sardos no se envasan" [A4 00:31-00:52].
//
// Disponible para envasar = lo que salio de sal - lo ya envasado.

// De dónde toma el envasado depende del circuito del queso — son tres, y los dio el
// cliente el 22/9 (pregunta B3, ya cerrada). Ver DISPONIBLE_ENVASAR más abajo.
const ENVASADO_SALDOS = `
  SELECT t.id, t.fecha_hora, t.cantidad, q.nombre AS queso, q.familia, q.se_envasa, q.madura,
         q.pasa_por_sal, q.madura_antes_de_envasar,
         (SELECT COALESCE(SUM(m.cantidad), 0)
            FROM movimientos_saladero m
           WHERE m.tina_id = t.id AND m.tipo = 'salida' AND m.anulado = 0) AS salio_de_sal,
         (SELECT COALESCE(SUM(x.cantidad), 0)
            FROM movimientos_maduracion x
           WHERE x.tina_id = t.id AND x.tipo = 'salida' AND x.anulado = 0) AS salio_camara,
         (SELECT COALESCE(SUM(e.cantidad), 0)
            FROM movimientos_envasado e
           WHERE e.tina_id = t.id AND e.anulado = 0) AS envasado,
         (SELECT MAX(m.fecha_hora)
            FROM movimientos_saladero m
           WHERE m.tina_id = t.id AND m.tipo = 'salida' AND m.anulado = 0) AS ultima_salida,
         (SELECT MAX(x.fecha_hora)
            FROM movimientos_maduracion x
           WHERE x.tina_id = t.id AND x.tipo = 'salida' AND x.anulado = 0) AS salida_camara_fecha
    FROM tinas t
    JOIN tipos_queso q ON q.id = t.tipo_queso_id
   WHERE t.anulado = 0
`

// Cuándo una tina queda disponible para envasar. Son TRES circuitos, no dos, y los dio
// el cliente el 22/9 (ver docs/12-circuitos-del-queso.md):
//
//   madura desnudo  -> pategrás, reggianito, sardo...  disponible al SALIR DE CÁMARA
//   pasa por sal    -> cremoso, tybo, provoleta...     disponible al SALIR DE SAL
//   ni una ni otra  -> muzzarellas, cremoso procesado  disponible APENAS SE PRODUCE
//
// El eje que faltaba es que `madura` y "madura antes de envasarse" no son lo mismo. El
// cremoso madura, pero DESPUÉS de envasarse, así que su maduración no bloquea nada. Con
// la versión anterior —`CASE WHEN madura = 1 THEN salio_camara ELSE salio_de_sal END`—
// el cremoso, el tybo y la provoleta esperaban para siempre una salida de cámara que en
// su circuito no ocurre, y no aparecían nunca en la lista de envasado.
const DISPONIBLE_ENVASAR = `
  CASE WHEN madura_antes_de_envasar = 1 THEN salio_camara
       WHEN pasa_por_sal = 1            THEN salio_de_sal
       ELSE cantidad END`

const qEnv = {
  // Solo lo que efectivamente se envasa Y ya está disponible segun su circuito.
  // El sardo (se_envasa = 0) nunca aparece: sale de cámara y ya está listo.
  pendientes: db.prepare(`
    SELECT *, ${DISPONIBLE_ENVASAR} AS disponible,
           -- Desde cuándo está esperando. El tercer COALESCE es por los quesos de masa:
           -- no tienen salida de cámara ni de sal, así que esperan desde que se
           -- produjeron. Sin él quedaban en NULL y el ORDER BY los mandaba a un extremo
           -- de la lista, justo a los que hay que envasar en el momento.
           COALESCE(salida_camara_fecha, ultima_salida, fecha_hora) AS espera_desde
      FROM (${ENVASADO_SALDOS}) s
     WHERE se_envasa = 1 AND ${DISPONIBLE_ENVASAR} > envasado
     ORDER BY espera_desde
  `),
  saldoDe: db.prepare(`SELECT * FROM (${ENVASADO_SALDOS}) s WHERE id = ?`),
  porClientId: db.prepare('SELECT id FROM movimientos_envasado WHERE client_id = ?'),
  insertar: db.prepare(`
    INSERT INTO movimientos_envasado
      (client_id, fecha_hora, origen, sincronizado, operario_id, tina_id, cantidad)
    VALUES
      (@client_id, @fecha_hora, @origen, @sincronizado, @operario_id, @tina_id, @cantidad)
  `),
  detalle: db.prepare(`
    SELECT e.id, e.client_id, e.fecha_hora, e.origen, e.cantidad, e.anulado, e.tina_id,
           o.nombre AS operario, q.nombre AS queso
      FROM movimientos_envasado e
      JOIN operarios   o ON o.id = e.operario_id
      JOIN tinas       t ON t.id = e.tina_id
      JOIN tipos_queso q ON q.id = t.tipo_queso_id
     WHERE e.id = ?
  `),
  delDia: db.prepare(`
    SELECT e.id, e.fecha_hora, e.origen, e.cantidad, e.anulado, e.tina_id,
           o.nombre AS operario, q.nombre AS queso
      FROM movimientos_envasado e
      JOIN operarios   o ON o.id = e.operario_id
      JOIN tinas       t ON t.id = e.tina_id
      JOIN tipos_queso q ON q.id = t.tipo_queso_id
     WHERE date(e.fecha_hora, 'localtime') = ?
     ORDER BY e.fecha_hora DESC
  `),
  anular: db.prepare(
    'UPDATE movimientos_envasado SET anulado = 1, anulado_en = ? WHERE id = ? AND anulado = 0'
  ),
}

// El mismo criterio que DISPONIBLE_ENVASAR, pero en JS.
//
// Existen por separado porque uno filtra la lista en SQL y el otro valida una carga
// puntual, y TIENEN QUE DECIR LO MISMO. Cuando divergen pasa lo peor: la pantalla ofrece
// envasar una tina y el servidor la rechaza, sin que el operario entienda por qué. Pasó
// justamente cuando se agregaron los tres circuitos y esta validación quedó con la lógica
// vieja de `madura`.
function circuitoDe(s) {
  if (s.madura_antes_de_envasar) return { base: s.salio_camara, viene_de: 'maduración' }
  if (s.pasa_por_sal) return { base: s.salio_de_sal, viene_de: 'saladero' }
  return { base: s.cantidad, viene_de: 'producción' }
}

app.get('/api/envasado/pendientes', async (_req, res) => {
  res.json({
    pendientes: (await qEnv.pendientes.all()).map((t) => ({
      ...t,
      falta: t.disponible - t.envasado,
      minutos_desde_sal: t.espera_desde ? minutosDesde(t.espera_desde) : null,
      // De dónde viene: cambia el texto que ve el operario. Los de masa vienen de
      // producción, no de un sector intermedio.
      viene_de: circuitoDe(t).viene_de,
    })),
  })
})

app.post('/api/envasado', async (req, res) => {
  const { client_id, operario_id, tina_id, cantidad, fecha_hora_cliente } = req.body ?? {}

  if (!client_id || !operario_id || !tina_id) {
    return res.status(400).json({ error: 'faltan campos obligatorios' })
  }
  if (!Number.isInteger(cantidad) || cantidad < 1) {
    return res.status(400).json({ error: 'cantidad debe ser un entero mayor a cero' })
  }

  const previo = await qEnv.porClientId.get(client_id)
  if (previo) return res.json({ ...(await qEnv.detalle.get(previo.id)), duplicado: true })

  if (!(await existe('operarios', operario_id))) return res.status(400).json({ error: 'operario inexistente' })

  const saldo = await qEnv.saldoDe.get(tina_id)
  if (!saldo) return res.status(400).json({ error: 'tina inexistente o anulada' })
  if (!saldo.se_envasa) {
    return res.status(409).json({ error: `el ${saldo.queso} no se envasa` })
  }

  // No se puede envasar mas de lo disponible segun el circuito del queso. Usa el MISMO
  // criterio que la lista (circuitoDe), para que no haya forma de que una tina aparezca
  // como disponible y despues se rechace.
  const { base, viene_de } = circuitoDe(saldo)
  const disponible = base - saldo.envasado
  if (cantidad > disponible) {
    const de = { maduración: 'salió de la cámara', saladero: 'salió de sal', producción: 'se produjo' }
    return res.status(409).json({ error: `excede lo que ${de[viene_de]}`, disponible })
  }

  const info = await qEnv.insertar.run({
    client_id,
    ...marcaDeTiempo(fecha_hora_cliente),
    operario_id,
    tina_id,
    cantidad,
  })
  res.status(201).json(await qEnv.detalle.get(info.lastInsertRowid))
})

app.get('/api/envasado', async (req, res) => {
  const fecha = req.query.fecha ?? hoyLocal()
  const movimientos = await qEnv.delDia.all(fecha)
  const vivos = movimientos.filter((m) => !m.anulado)
  res.json({
    fecha,
    envasado: vivos.reduce((n, m) => n + m.cantidad, 0),
    movimientos,
  })
})

app.post('/api/envasado/:id/anular', async (req, res) => {
  const id = Number(req.params.id)
  if ((await qEnv.anular.run(ahora(), id)).changes === 0) {
    return res.status(404).json({ error: 'no existe o ya estaba anulado' })
  }
  res.json(await qEnv.detalle.get(id))
})

// ---------------------------------------------------------------- pedidos

// El problema que resuelve este modulo esta en el audio 6: hoy el encargado baja un
// papel, el operario pesa los quesos y los anota a mano, sube el papel, y recien ahi
// se puede facturar. El cuello de botella no es anotar: es que Andres no puede
// facturar NADA hasta que suban todos los pedidos juntos [A6 01:33].

const qPed = {
  clientes: db.prepare('SELECT id, nombre FROM clientes WHERE activo = 1 ORDER BY orden, nombre'),
  porClientId: db.prepare('SELECT id FROM pedidos WHERE client_id = ?'),

  producto: db.prepare('SELECT id, nombre, familia FROM productos WHERE id = ?'),
  marcaHaceFamilia: db.prepare(
    'SELECT 1 AS hay FROM marcas_familias WHERE marca_id = ? AND familia = ?'
  ),

  crear: db.prepare(`
    INSERT INTO pedidos (client_id, cliente_id, estado, origen, creado_en, nota)
    VALUES (@client_id, @cliente_id, @estado, @origen, @creado_en, @nota)
  `),
  crearLinea: db.prepare(`
    INSERT INTO pedido_lineas (pedido_id, tipo_queso_id, producto_id, marca_id, envase_id, cantidad_pedida)
    VALUES (@pedido_id, @tipo_queso_id, @producto_id, @marca_id, @envase_id, @cantidad_pedida)
  `),

  cabecera: db.prepare(`
    SELECT p.id, p.client_id, p.estado, p.origen, p.creado_en, p.armado_en, p.facturado_en,
           p.nota, p.anulado, c.nombre AS cliente, o.nombre AS armador
      FROM pedidos p
      JOIN clientes c ON c.id = p.cliente_id
      LEFT JOIN operarios o ON o.id = p.armado_por
     WHERE p.id = ?
  `),
  // LEFT JOIN en los cuatro: una línea usa tipos_queso O productos/marcas/envases, nunca
  // los dos. Con JOIN normal cada línea perdía la mitad de los pedidos.
  lineas: db.prepare(`
    SELECT l.id, l.tipo_queso_id, l.producto_id, l.marca_id, l.envase_id, l.cantidad_pedida,
           q.nombre  AS queso,    q.familia,
           pr.nombre AS producto, pr.familia AS producto_familia,
           m.nombre  AS marca,    e.nombre   AS envase,
           e.unidades_por_bulto,  e.litros_por_unidad
      FROM pedido_lineas l
      LEFT JOIN tipos_queso q  ON q.id  = l.tipo_queso_id
      LEFT JOIN productos   pr ON pr.id = l.producto_id
      LEFT JOIN marcas      m  ON m.id  = l.marca_id
      LEFT JOIN envases     e  ON e.id  = l.envase_id
     WHERE l.pedido_id = ?
     ORDER BY l.id
  `),
  pesosDe: db.prepare(`
    SELECT id, client_id, gramos, fecha_hora, origen
      FROM pedido_pesos
     WHERE linea_id = ? AND anulado = 0
     ORDER BY id
  `),
  cantidadesDe: db.prepare(`
    SELECT id, client_id, cantidad, fecha_hora, origen
      FROM pedido_cantidades
     WHERE linea_id = ? AND anulado = 0
     ORDER BY id
  `),
  listar: db.prepare(`
    SELECT p.id, p.estado, p.origen, p.creado_en, p.armado_en, p.facturado_en,
           c.nombre AS cliente, o.nombre AS armador
      FROM pedidos p
      JOIN clientes c ON c.id = p.cliente_id
      LEFT JOIN operarios o ON o.id = p.armado_por
     WHERE p.anulado = 0
       AND (? = '' OR p.estado = ?)
     ORDER BY
       CASE p.estado WHEN 'armando' THEN 0 WHEN 'pendiente' THEN 1 WHEN 'listo' THEN 2 ELSE 3 END,
       p.creado_en DESC
     LIMIT 200
  `),

  pesoPorClientId: db.prepare('SELECT id FROM pedido_pesos WHERE client_id = ?'),
  lineaDe: db.prepare(
    'SELECT l.id, l.pedido_id, l.tipo_queso_id, l.producto_id FROM pedido_lineas l WHERE l.id = ?'
  ),
  agregarPeso: db.prepare(`
    INSERT INTO pedido_pesos (client_id, linea_id, gramos, fecha_hora, origen)
    VALUES (@client_id, @linea_id, @gramos, @fecha_hora, @origen)
  `),
  anularPeso: db.prepare(
    'UPDATE pedido_pesos SET anulado = 1, anulado_en = ? WHERE id = ? AND anulado = 0'
  ),

  cantidadPorClientId: db.prepare('SELECT id FROM pedido_cantidades WHERE client_id = ?'),
  agregarCantidad: db.prepare(`
    INSERT INTO pedido_cantidades (client_id, linea_id, cantidad, fecha_hora, origen)
    VALUES (@client_id, @linea_id, @cantidad, @fecha_hora, @origen)
  `),
  anularCantidad: db.prepare(
    'UPDATE pedido_cantidades SET anulado = 1, anulado_en = ? WHERE id = ? AND anulado = 0'
  ),
  marcarArmando: db.prepare(
    "UPDATE pedidos SET estado = 'armando', armado_por = ? WHERE id = ? AND estado = 'pendiente'"
  ),
  cerrar: db.prepare(`
    UPDATE pedidos SET estado = 'listo', armado_en = ?, armado_por = COALESCE(armado_por, ?)
     WHERE id = ? AND estado IN ('pendiente', 'armando')
  `),
  reabrir: db.prepare("UPDATE pedidos SET estado = 'armando', armado_en = NULL WHERE id = ? AND estado = 'listo'"),
  facturar: db.prepare("UPDATE pedidos SET estado = 'facturado', facturado_en = ? WHERE id = ? AND estado = 'listo'"),
  anular: db.prepare('UPDATE pedidos SET anulado = 1, anulado_en = ? WHERE id = ? AND anulado = 0'),
}

// Arma el pedido completo con sus lineas, sus pesos y los totales ya calculados.
// Los totales se calculan aca y no en cada pantalla: el kilaje termina en una factura
// y no puede depender de que dos clientes sumen igual.
async function pedidoCompleto(id) {
  const cab = await qPed.cabecera.get(id)
  if (!cab) return null

  const lineas = await Promise.all((await qPed.lineas.all(id)).map(async (l) => {
    // El queso se cumple pesando: la unidad pedida son piezas y lo que se entrega son
    // kilos, porque cada pieza pesa distinto.
    if (l.tipo_queso_id) {
      const pesos = await qPed.pesosDe.all(l.id)
      const gramos = pesos.reduce((n, p) => n + p.gramos, 0)
      return {
        ...l,
        clase: 'queso',
        unidad: 'piezas',
        descripcion: l.queso,
        pesos,
        cantidades: [],
        piezas: pesos.length,
        gramos,
        litros: 0,
        entregado: pesos.length,
        // Diferencia entre lo pedido y lo que se esta entregando. Puede ser negativa:
        // si en la camara hay 2 y pidieron 3, el sistema no lo impide, lo muestra.
        diferencia: pesos.length - l.cantidad_pedida,
      }
    }

    // Leche y yogur se cumplen contando. No hay balanza: un carton de 1 L es 1 L, y lo
    // que puede variar es cuantos bultos se llegaron a preparar.
    const cargas = await qPed.cantidadesDe.all(l.id)
    const preparado = cargas.reduce((n, c) => n + c.cantidad, 0)
    const esYogur = l.producto_familia === 'yogur'

    // Litros solo tienen sentido en leche, y solo si el formato tiene los numeros
    // cargados. NUMERIC vuelve como texto desde Postgres, de ahi el Number().
    const porBulto = Number(l.unidades_por_bulto ?? 0) * Number(l.litros_por_unidad ?? 0)
    const litros = esYogur ? 0 : Math.round(preparado * porBulto)

    return {
      ...l,
      clase: esYogur ? 'yogur' : 'leche',
      unidad: esYogur ? 'unidades' : 'bultos',
      descripcion: [l.producto, l.marca, l.envase].filter(Boolean).join(' · '),
      pesos: [],
      cantidades: cargas,
      piezas: 0,
      gramos: 0,
      litros,
      entregado: preparado,
      diferencia: preparado - l.cantidad_pedida,
    }
  }))

  const deQueso = lineas.filter((l) => l.clase === 'queso')
  const deLeche = lineas.filter((l) => l.clase === 'leche')
  const deYogur = lineas.filter((l) => l.clase === 'yogur')
  const suma = (xs, f) => xs.reduce((n, x) => n + f(x), 0)

  return {
    ...cab,
    lineas,
    // piezas y gramos siguen siendo SOLO de queso. Mezclar bultos de leche con piezas de
    // queso en un mismo total daria un numero que no significa nada, y este es el objeto
    // del que sale el remito.
    piezas: suma(deQueso, (l) => l.piezas),
    piezas_pedidas: suma(deQueso, (l) => l.cantidad_pedida),
    gramos: suma(deQueso, (l) => l.gramos),
    bultos: suma(deLeche, (l) => l.entregado),
    bultos_pedidos: suma(deLeche, (l) => l.cantidad_pedida),
    litros: suma(deLeche, (l) => l.litros),
    unidades_yogur: suma(deYogur, (l) => l.entregado),
    unidades_yogur_pedidas: suma(deYogur, (l) => l.cantidad_pedida),
  }
}

app.get('/api/clientes', async (_req, res) => res.json(await qPed.clientes.all()))

app.post('/api/pedidos', async (req, res) => {
  const { client_id, cliente_id, lineas, origen, nota } = req.body ?? {}

  if (!client_id || !cliente_id || !Array.isArray(lineas) || !lineas.length) {
    return res.status(400).json({ error: 'faltan cliente o líneas' })
  }
  // Cada línea se normaliza acá, una sola vez, y lo que sigue trabaja con el resultado.
  // Validar en el handler y volver a deducir la clase más abajo es como se cuelan los
  // casos raros: una línea de yogur con envase, una de leche sin marca.
  const normalizadas = []
  for (const l of lineas) {
    if (!Number.isInteger(l.cantidad_pedida) || l.cantidad_pedida < 1) {
      return res.status(400).json({ error: 'cantidad inválida' })
    }
    const esQueso = Boolean(l.tipo_queso_id)
    const esProducto = Boolean(l.producto_id)
    if (esQueso === esProducto) {
      return res.status(400).json({ error: 'la línea tiene que ser de queso o de producto' })
    }

    if (esQueso) {
      if (!(await existe('tipos_queso', l.tipo_queso_id))) {
        return res.status(400).json({ error: 'queso inexistente' })
      }
      normalizadas.push({
        tipo_queso_id: l.tipo_queso_id,
        producto_id: null,
        marca_id: null,
        envase_id: null,
        cantidad_pedida: l.cantidad_pedida,
      })
      continue
    }

    const producto = await qPed.producto.get(l.producto_id)
    if (!producto) return res.status(400).json({ error: 'producto inexistente' })
    if (!l.marca_id) return res.status(400).json({ error: 'falta la marca' })
    if (!(await existe('marcas', l.marca_id))) {
      return res.status(400).json({ error: 'marca inexistente' })
    }
    // Obenac no hace yogur. Sin esto se puede cargar un pedido que la planta no puede
    // producir, y el que se entera es el armador parado frente a la cámara.
    if (!(await qPed.marcaHaceFamilia.get(l.marca_id, producto.familia))) {
      return res.status(400).json({ error: `esa marca no hace ${producto.familia}` })
    }

    // La leche se pide en cajones, así que el formato es parte de lo pedido: pedir
    // "40 cajones de Entera" sin decir si son x 18 o x 20 son 80 litros de diferencia.
    // El yogur se pide en unidades y no lleva envase.
    const esLeche = producto.familia === 'leche'
    if (esLeche && !l.envase_id) return res.status(400).json({ error: 'falta el formato' })
    if (!esLeche && l.envase_id) {
      return res.status(400).json({ error: 'el yogur se pide en unidades, sin formato' })
    }
    if (l.envase_id && !(await existe('envases', l.envase_id))) {
      return res.status(400).json({ error: 'formato inexistente' })
    }

    normalizadas.push({
      tipo_queso_id: null,
      producto_id: l.producto_id,
      marca_id: l.marca_id,
      envase_id: l.envase_id ?? null,
      cantidad_pedida: l.cantidad_pedida,
    })
  }

  const previo = await qPed.porClientId.get(client_id)
  if (previo) return res.json({ ...await pedidoCompleto(previo.id), duplicado: true })

  if (!(await existe('clientes', cliente_id))) return res.status(400).json({ error: 'cliente inexistente' })

  // La cabecera y sus lineas van juntas o no va ninguna: un pedido sin lineas seria
  // una fila que el armador ve y no puede armar.
  const nuevoId = await db.transaccion(async (tx) => {
    const crear = tx.prepare(`
      INSERT INTO pedidos (client_id, cliente_id, estado, origen, creado_en, nota)
      VALUES (@client_id, @cliente_id, @estado, @origen, @creado_en, @nota)
    `)
    const crearLinea = tx.prepare(`
      INSERT INTO pedido_lineas (pedido_id, tipo_queso_id, producto_id, marca_id, envase_id, cantidad_pedida)
      VALUES (@pedido_id, @tipo_queso_id, @producto_id, @marca_id, @envase_id, @cantidad_pedida)
    `)
    const info = await crear.run({
      client_id,
      cliente_id,
      estado: 'pendiente',
      origen: origen === 'tablet' ? 'tablet' : 'encargado',
      creado_en: ahora(),
      nota: nota ?? null,
    })
    for (const l of normalizadas) await crearLinea.run({ ...l, pedido_id: info.lastInsertRowid })
    return info.lastInsertRowid
  })

  res.status(201).json(await pedidoCompleto(nuevoId))
})

app.get('/api/pedidos', async (req, res) => {
  const estado = req.query.estado ?? ''
  const pedidos = await Promise.all((await qPed.listar.all(estado, estado)).map(async (p) => {
    const completo = await pedidoCompleto(p.id)
    return {
      ...p,
      piezas: completo.piezas,
      piezas_pedidas: completo.piezas_pedidas,
      gramos: completo.gramos,
      bultos: completo.bultos,
      bultos_pedidos: completo.bultos_pedidos,
      litros: completo.litros,
      unidades_yogur: completo.unidades_yogur,
      unidades_yogur_pedidas: completo.unidades_yogur_pedidas,
      lineas: completo.lineas.length,
    }
  }))
  res.json({ pedidos })
})

app.get('/api/pedidos/:id', async (req, res) => {
  const p = await pedidoCompleto(Number(req.params.id))
  if (!p) return res.status(404).json({ error: 'no existe' })
  res.json(p)
})

app.post('/api/pedidos/:id/tomar', async (req, res) => {
  const id = Number(req.params.id)
  await qPed.marcarArmando.run(req.body?.operario_id ?? null, id)
  const p = await pedidoCompleto(id)
  if (!p) return res.status(404).json({ error: 'no existe' })
  res.json(p)
})

// Una fila por pieza pesada. client_id unico = la cola offline puede reenviar sin
// duplicar, igual que en el resto del sistema.
app.post('/api/pedidos/pesos', async (req, res) => {
  const { client_id, linea_id, gramos, fecha_hora_cliente } = req.body ?? {}

  if (!client_id || !linea_id) return res.status(400).json({ error: 'faltan campos obligatorios' })
  if (!Number.isInteger(gramos) || gramos < 1 || gramos > 200000) {
    return res.status(400).json({ error: 'peso fuera de rango' })
  }

  const previo = await qPed.pesoPorClientId.get(client_id)
  if (previo) return res.json({ id: previo.id, duplicado: true })

  const linea = await qPed.lineaDe.get(linea_id)
  if (!linea) return res.status(400).json({ error: 'línea inexistente' })
  // Una línea de leche no se pesa. Sin esta guarda un error de la tablet mete gramos en
  // una línea que se cuenta en cajones, y el remito sale con kilos inventados.
  if (!linea.tipo_queso_id) {
    return res.status(400).json({ error: 'esa línea se cumple por cantidad, no por peso' })
  }

  const marca = marcaDeTiempo(fecha_hora_cliente)
  const info = await qPed.agregarPeso.run({
    client_id,
    linea_id,
    gramos,
    fecha_hora: marca.fecha_hora,
    origen: marca.origen,
  })
  res.status(201).json({ id: info.lastInsertRowid, pedido: await pedidoCompleto(linea.pedido_id) })
})

app.post('/api/pedidos/pesos/:id/anular', async (req, res) => {
  const id = Number(req.params.id)
  if ((await qPed.anularPeso.run(ahora(), id)).changes === 0) {
    return res.status(404).json({ error: 'no existe o ya estaba anulado' })
  }
  res.json({ ok: true })
})

// El equivalente de los pesos para leche y yogur: una fila por carga preparada.
//
// Va aparte y no como un campo en la linea por lo mismo que los pesos: el armador puede
// preparar en dos veces, deshacer una sola, y la cola offline reenvia sin duplicar
// gracias al client_id unico. Un total pisado en la linea pierde las tres cosas.
app.post('/api/pedidos/cantidades', async (req, res) => {
  const { client_id, linea_id, cantidad, fecha_hora_cliente } = req.body ?? {}

  if (!client_id || !linea_id) return res.status(400).json({ error: 'faltan campos obligatorios' })
  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 100000) {
    return res.status(400).json({ error: 'cantidad fuera de rango' })
  }

  const previo = await qPed.cantidadPorClientId.get(client_id)
  if (previo) return res.json({ id: previo.id, duplicado: true })

  const linea = await qPed.lineaDe.get(linea_id)
  if (!linea) return res.status(400).json({ error: 'línea inexistente' })
  // La contracara de la guarda de los pesos: un queso se pesa, no se cuenta. Si entrara
  // por acá, el pedido mostraria piezas entregadas sin un solo kilo detras.
  if (!linea.producto_id) {
    return res.status(400).json({ error: 'esa línea se cumple pesando, no por cantidad' })
  }

  const marca = marcaDeTiempo(fecha_hora_cliente)
  const info = await qPed.agregarCantidad.run({
    client_id,
    linea_id,
    cantidad,
    fecha_hora: marca.fecha_hora,
    origen: marca.origen,
  })
  res.status(201).json({ id: info.lastInsertRowid, pedido: await pedidoCompleto(linea.pedido_id) })
})

app.post('/api/pedidos/cantidades/:id/anular', async (req, res) => {
  const id = Number(req.params.id)
  if ((await qPed.anularCantidad.run(ahora(), id)).changes === 0) {
    return res.status(404).json({ error: 'no existe o ya estaba anulado' })
  }
  res.json({ ok: true })
})

app.post('/api/pedidos/:id/cerrar', async (req, res) => {
  const id = Number(req.params.id)
  if ((await qPed.cerrar.run(ahora(), req.body?.operario_id ?? null, id)).changes === 0) {
    return res.status(409).json({ error: 'el pedido no está en condiciones de cerrarse' })
  }
  res.json(await pedidoCompleto(id))
})

app.post('/api/pedidos/:id/reabrir', async (req, res) => {
  const id = Number(req.params.id)
  if ((await qPed.reabrir.run(id)).changes === 0) {
    return res.status(409).json({ error: 'solo se puede reabrir un pedido listo' })
  }
  res.json(await pedidoCompleto(id))
})

app.post('/api/pedidos/:id/facturar', async (req, res) => {
  const id = Number(req.params.id)
  if ((await qPed.facturar.run(ahora(), id)).changes === 0) {
    return res.status(409).json({ error: 'solo se puede facturar un pedido listo' })
  }
  res.json(await pedidoCompleto(id))
})

app.post('/api/pedidos/:id/anular', async (req, res) => {
  const id = Number(req.params.id)
  if ((await qPed.anular.run(ahora(), id)).changes === 0) {
    return res.status(404).json({ error: 'no existe o ya estaba anulado' })
  }
  res.json({ ok: true })
})

// Lo que el encargado necesita para facturar, en el formato mas plano posible.
app.get('/api/pedidos/:id/remito.csv', async (req, res) => {
  const p = await pedidoCompleto(Number(req.params.id))
  if (!p) return res.status(404).send('no existe')
  // Una fila por linea, con las dos clases en las mismas columnas. `unidad` dice como
  // leer `pedido` y `entregado` —piezas, bultos o unidades—, porque sumar cajones con
  // piezas de queso en una misma columna daria un total que no significa nada.
  //
  // Los kilos solo los tiene el queso y los litros solo la leche. La columna vacia es
  // mas honesta que un cero: un cero se suma sin querer.
  const esc = (v) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const fila = (xs) => xs.map(esc).join(',')

  const filas = [fila(['cliente', 'clase', 'detalle', 'unidad', 'pedido', 'entregado', 'kilos', 'litros'])]
  for (const l of p.lineas) {
    filas.push(fila([
      p.cliente,
      l.clase,
      l.descripcion,
      l.unidad,
      l.cantidad_pedida,
      l.entregado,
      l.clase === 'queso' ? (l.gramos / 1000).toFixed(3) : '',
      l.clase === 'leche' ? l.litros : '',
    ]))
  }
  filas.push(fila(['', 'TOTAL queso', '', 'piezas', p.piezas_pedidas, p.piezas, (p.gramos / 1000).toFixed(3), '']))
  if (p.bultos_pedidos) {
    filas.push(fila(['', 'TOTAL leche', '', 'bultos', p.bultos_pedidos, p.bultos, '', p.litros]))
  }
  if (p.unidades_yogur_pedidas) {
    filas.push(fila(['', 'TOTAL yogur', '', 'unidades', p.unidades_yogur_pedidas, p.unidades_yogur, '', '']))
  }
  res.type('text/csv').attachment(`pedido-${p.id}-${p.cliente}.csv`).send(filas.join('\n'))
})

// ---------------------------------------------------------------- tablero

// Estado del circuito completo, para la pantalla LED de planta. Un solo endpoint:
// la pantalla no tiene que orquestar seis llamadas ni quedar a medio pintar si una
// falla.
//
// Hay dos clases de numero acá y conviene no mezclarlas:
//   - FLUJO  ("hoy se hicieron 420 piezas"): se reinicia cada dia.
//   - STOCK  ("hay 3.248 en sal"): es una foto del momento, no depende del dia.
// En la pantalla van separados y etiquetados, porque un numero sin referencia en una
// pared es decoracion.

const qOpcionesTablet = {
  todas: db.prepare(
    'SELECT clave, nombre, descripcion, activo FROM opciones_tablet ORDER BY orden'
  ),
  cambiar: db.prepare('UPDATE opciones_tablet SET activo = @activo WHERE clave = @clave'),
}

const qSecciones = {
  todas: db.prepare(
    'SELECT clave, nombre, descripcion, visible FROM tablero_secciones ORDER BY orden'
  ),
  cambiar: db.prepare('UPDATE tablero_secciones SET visible = @visible WHERE clave = @clave'),
}

const qTab = {
  palletsHoy: db.prepare(`
    SELECT m.nombre AS marca, p.nombre AS producto,
           COUNT(*) AS pallets, COALESCE(SUM(r.litros), 0) AS litros
      FROM registros_pallet r
      JOIN marcas    m ON m.id = r.marca_id
      JOIN productos p ON p.id = r.producto_id
     WHERE r.anulado = 0 AND date(r.fecha_hora, 'localtime') = ?
     GROUP BY m.id, p.id
  `),
  // Se cuenta aparte y no derivado de palletsHoy: esa consulta agrupa por marca y
  // producto, asi que un grupo que mezcla un pallet en caja (840 L) con uno en
  // palangana (sin litros) suma 840 y el segundo queda invisible.
  palletsSinLitros: db.prepare(`
    SELECT COUNT(*) AS n FROM registros_pallet
     WHERE anulado = 0 AND litros IS NULL AND date(fecha_hora, 'localtime') = ?
  `),
  // Leche cruda que entró hoy. Es el INPUT del circuito: no se mezcla con los litros
  // envasados de lechería, que son producto terminado. Dos "litros" distintos.
  recibidoHoy: db.prepare(`
    SELECT COUNT(*) AS entregas, COALESCE(SUM(litros), 0) AS litros,
           COUNT(DISTINCT tambo_id) AS tambos, MAX(temperatura) AS temp_maxima
      FROM recepciones
     WHERE anulado = 0 AND date(fecha_hora, 'localtime') = ?
  `),
  yogurHoy: db.prepare(`
    SELECT p.nombre AS sabor, COUNT(*) AS bins,
           COALESCE(SUM(y.unidades), 0) AS unidades, SUM(y.kilos) AS kilos
      FROM registros_yogur y
      JOIN productos p ON p.id = y.producto_id
     WHERE y.anulado = 0 AND date(y.fecha_hora, 'localtime') = ?
     GROUP BY p.id
     ORDER BY unidades DESC
  `),
  producidoHoy: db.prepare(`
    SELECT q.nombre AS queso, COUNT(*) AS tinas, SUM(t.cantidad) AS piezas
      FROM tinas t
      JOIN tipos_queso q ON q.id = t.tipo_queso_id
     WHERE t.anulado = 0 AND date(t.fecha_hora, 'localtime') = ?
     GROUP BY q.id
     ORDER BY piezas DESC
  `),
  // Foto: cuanto hay adentro del saladero ahora mismo, por tipo de queso.
  enSalAhora: db.prepare(`
    SELECT q.nombre AS queso,
           SUM(CASE WHEN m.tipo = 'entrada' THEN m.cantidad ELSE -m.cantidad END) AS piezas
      FROM movimientos_saladero m
      JOIN tinas       t ON t.id = m.tina_id AND t.anulado = 0
      JOIN tipos_queso q ON q.id = t.tipo_queso_id
     WHERE m.anulado = 0
     GROUP BY q.id
    -- Postgres no acepta el alias de salida en HAVING (se evalua antes del SELECT),
    -- asi que la expresion va repetida. En ORDER BY si lo acepta, y ahi queda el alias.
    HAVING SUM(CASE WHEN m.tipo = 'entrada' THEN m.cantidad ELSE -m.cantidad END) > 0
     ORDER BY piezas DESC
  `),
  movSaladeroHoy: db.prepare(`
    SELECT tipo, COALESCE(SUM(cantidad), 0) AS piezas
      FROM movimientos_saladero
     WHERE anulado = 0 AND date(fecha_hora, 'localtime') = ?
     GROUP BY tipo
  `),
  // Foto: queso desnudo esperando envase (salio de sal y todavia no se envaso).
  paraEnvasar: db.prepare(`
    SELECT q.nombre AS queso, q.se_envasa,
           SUM(x.salio - x.envasado) AS piezas,
           MIN(x.ultima_salida) AS mas_viejo
      FROM (
        SELECT t.id, t.tipo_queso_id,
               (SELECT COALESCE(SUM(m.cantidad), 0) FROM movimientos_saladero m
                 WHERE m.tina_id = t.id AND m.tipo = 'salida' AND m.anulado = 0) AS salio,
               (SELECT COALESCE(SUM(e.cantidad), 0) FROM movimientos_envasado e
                 WHERE e.tina_id = t.id AND e.anulado = 0) AS envasado,
               (SELECT MAX(m.fecha_hora) FROM movimientos_saladero m
                 WHERE m.tina_id = t.id AND m.tipo = 'salida' AND m.anulado = 0) AS ultima_salida
          FROM tinas t WHERE t.anulado = 0
      ) x
      JOIN tipos_queso q ON q.id = x.tipo_queso_id
     WHERE x.salio > x.envasado
     GROUP BY q.id
     ORDER BY piezas DESC
  `),
  envasadoHoy: db.prepare(`
    SELECT COALESCE(SUM(cantidad), 0) AS piezas
      FROM movimientos_envasado
     WHERE anulado = 0 AND date(fecha_hora, 'localtime') = ?
  `),
  pedidosPorEstado: db.prepare(`
    SELECT estado, COUNT(*) AS n FROM pedidos WHERE anulado = 0 GROUP BY estado
  `),
  pedidosHoy: db.prepare(`
    SELECT COUNT(*) AS n FROM pedidos
     WHERE anulado = 0 AND estado IN ('listo', 'facturado')
       AND date(COALESCE(armado_en, creado_en), 'localtime') = ?
  `),
  kilosListos: db.prepare(`
    SELECT COALESCE(SUM(w.gramos), 0) AS gramos
      FROM pedidos p
      JOIN pedido_lineas l ON l.pedido_id = p.id
      JOIN pedido_pesos  w ON w.linea_id = l.id AND w.anulado = 0
     WHERE p.anulado = 0 AND p.estado = 'listo'
  `),
  // Tinas producidas que todavia no entraron a sal, con cuanto hace que esperan.
  esperandoSal: db.prepare(`
    SELECT t.id, q.nombre AS queso, t.fecha_hora,
           t.cantidad - (SELECT COALESCE(SUM(m.cantidad), 0) FROM movimientos_saladero m
                          WHERE m.tina_id = t.id AND m.tipo = 'entrada' AND m.anulado = 0) AS falta
      FROM tinas t
      JOIN tipos_queso q ON q.id = t.tipo_queso_id
     WHERE t.anulado = 0
       AND t.cantidad > (SELECT COALESCE(SUM(m.cantidad), 0) FROM movimientos_saladero m
                          WHERE m.tina_id = t.id AND m.tipo = 'entrada' AND m.anulado = 0)
     ORDER BY t.fecha_hora
  `),
  // Promedio de piezas por dia de los ultimos 14 dias, sin contar hoy. Sirve de
  // referencia: "420" solo no dice nada, "420 contra 380 de promedio" si.
  promedioDiario: db.prepare(`
    SELECT ROUND(AVG(piezas)) AS promedio FROM (
      SELECT SUM(cantidad) AS piezas
        FROM tinas
       WHERE anulado = 0
         AND date(fecha_hora, 'localtime') < ?
         AND date(fecha_hora, 'localtime') >= date(?, '-14 days')
       GROUP BY date(fecha_hora, 'localtime')
    ) d
  `),
}

// Umbrales provisorios: no sabemos los reales todavia (pregunta B6).
const ALERTA_SAL_MIN = 4 * 60
const ALERTA_DESNUDO_MIN = 48 * 60

app.get('/api/tablero', async (_req, res) => {
  const hoy = hoyLocal()

  // Que secciones mostrar. Viaja con los datos y no en un endpoint aparte: la pantalla
  // ya pide esto cada 10 segundos, asi que apagar una seccion desde el escritorio se ve
  // en la pared sin que nadie vaya hasta la maquina.
  const secciones = Object.fromEntries(
    (await qSecciones.todas.all()).map((s) => [s.clave, Boolean(s.visible)])
  )

  const movSal = await qTab.movSaladeroHoy.all(hoy)
  const dePedidos = await qTab.pedidosPorEstado.all()
  const cuenta = (estado) => dePedidos.find((p) => p.estado === estado)?.n ?? 0

  const enSal = await qTab.enSalAhora.all()
  const paraEnvasar = await qTab.paraEnvasar.all()
  const producido = await qTab.producidoHoy.all(hoy)
  const esperandoSal = await qTab.esperandoSal.all()

  const demoradasSal = esperandoSal
    .map((t) => ({ ...t, minutos: minutosDesde(t.fecha_hora) }))
    .filter((t) => t.minutos >= ALERTA_SAL_MIN)

  const desnudoViejo = paraEnvasar
    .filter((t) => t.se_envasa && t.mas_viejo && minutosDesde(t.mas_viejo) >= ALERTA_DESNUDO_MIN)
    .map((t) => ({ ...t, minutos: minutosDesde(t.mas_viejo) }))

  res.json({
    hora: ahora(),
    fecha: hoy,

    recepcion: await qTab.recibidoHoy.get(hoy),

    lecheria: await (async () => {
      const detalle = await qTab.palletsHoy.all(hoy)
      return {
        detalle,
        total: detalle.reduce((n, r) => n + r.pallets, 0),
        litros: detalle.reduce((n, r) => n + r.litros, 0),
        // Los pallets en un formato todavía sin confirmar no suman litros. Se cuentan
        // aparte para que el total no parezca menor de lo que fue.
        sin_litros: (await qTab.palletsSinLitros.get(hoy)).n,
      }
    })(),

    yogur: await (async () => {
      const detalle = await qTab.yogurHoy.all(hoy)
      return {
        detalle,
        bins: detalle.reduce((n, r) => n + r.bins, 0),
        unidades: detalle.reduce((n, r) => n + r.unidades, 0),
        kilos: detalle.reduce((n, r) => n + (r.kilos ?? 0), 0),
      }
    })(),

    // FLUJO del dia
    hoy: {
      piezas: producido.reduce((n, r) => n + r.piezas, 0),
      tinas: producido.reduce((n, r) => n + r.tinas, 0),
      por_queso: producido,
      entro_a_sal: movSal.find((m) => m.tipo === 'entrada')?.piezas ?? 0,
      salio_de_sal: movSal.find((m) => m.tipo === 'salida')?.piezas ?? 0,
      envasado: (await qTab.envasadoHoy.get(hoy)).piezas,
      pedidos_terminados: (await qTab.pedidosHoy.get(hoy)).n,
      promedio_piezas: (await qTab.promedioDiario.get(hoy, hoy))?.promedio ?? null,
    },

    // STOCK: foto del momento
    ahora: {
      esperando_sal: esperandoSal.reduce((n, t) => n + t.falta, 0),
      en_sal: enSal.reduce((n, r) => n + r.piezas, 0),
      en_sal_por_queso: enSal,
      para_envasar: paraEnvasar.filter((r) => r.se_envasa).reduce((n, r) => n + r.piezas, 0),
      para_envasar_por_queso: paraEnvasar.filter((r) => r.se_envasa),
      // El sardo no se envasa: sale de sal y va a maduracion, que todavia no existe
      // como pantalla. Se muestra aparte para que no parezca que se perdio.
      a_maduracion: paraEnvasar.filter((r) => !r.se_envasa).reduce((n, r) => n + r.piezas, 0),
    },

    pedidos: {
      pendientes: cuenta('pendiente'),
      armando: cuenta('armando'),
      listos: cuenta('listo'),
      kilos_listos: (await qTab.kilosListos.get()).gramos / 1000,
    },

    // Lo que hay que mirar, no solo lo que paso.
    alertas: {
      esperando_sal: demoradasSal.map((t) => ({ queso: t.queso, piezas: t.falta, minutos: t.minutos })),
      desnudo_viejo: desnudoViejo.map((t) => ({ queso: t.queso, piezas: t.piezas, minutos: t.minutos })),
    },
    secciones,
  })
})

// ---------------------------------------------------------------- tablero: config

app.get('/api/tablets/opciones', async (_req, res) => {
  res.json(await qOpcionesTablet.todas.all())
})

app.put('/api/tablets/opciones/:clave', async (req, res) => {
  const { clave } = req.params
  if (!(await qOpcionesTablet.todas.all()).some((o) => o.clave === clave)) {
    return res.status(404).json({ error: 'opción inexistente' })
  }
  if (typeof req.body?.activo !== 'boolean') {
    return res.status(400).json({ error: 'activo debe ser true o false' })
  }
  await qOpcionesTablet.cambiar.run({ clave, activo: req.body.activo })
  res.json(await qOpcionesTablet.todas.all())
})

app.get('/api/tablero/secciones', async (_req, res) => {
  res.json(await qSecciones.todas.all())
})

app.put('/api/tablero/secciones/:clave', async (req, res) => {
  const { clave } = req.params
  const existe = (await qSecciones.todas.all()).some((s) => s.clave === clave)
  if (!existe) return res.status(404).json({ error: 'sección inexistente' })

  if (typeof req.body?.visible !== 'boolean') {
    return res.status(400).json({ error: 'visible debe ser true o false' })
  }
  await qSecciones.cambiar.run({ clave, visible: req.body.visible })
  res.json(await qSecciones.todas.all())
})

// ---------------------------------------------------------------- reportes

// Todo lo de aca abajo responde a un rango de fechas. El encargado nunca pidió un
// reporte concreto (pregunta C1), asi que estos son los que se desprenden de los
// datos que ya se capturan. El de rendimiento por tina es el unico que muestra algo
// que hoy la fabrica no puede ver de ninguna manera.

const qRep = {
  piezasPorDia: db.prepare(`
    SELECT date(t.fecha_hora, 'localtime') AS fecha,
           COUNT(*)        AS tinas,
           SUM(t.cantidad) AS piezas
      FROM tinas t
      JOIN tipos_queso q ON q.id = t.tipo_queso_id
     WHERE t.anulado = 0
       AND date(t.fecha_hora, 'localtime') BETWEEN ? AND ?
       AND (? = '' OR q.nombre = ?)
     GROUP BY fecha
     ORDER BY fecha
  `),
  palletsPorDia: db.prepare(`
    SELECT date(fecha_hora, 'localtime') AS fecha,
           COUNT(*) AS pallets, COALESCE(SUM(litros), 0) AS litros
      FROM registros_pallet
     WHERE anulado = 0
       AND date(fecha_hora, 'localtime') BETWEEN ? AND ?
     GROUP BY fecha
     ORDER BY fecha
  `),
  // El rinde varia por tina ("un dia 120, al otro 117, al otro 124" [A3 00:34]).
  // Promedio, minimo y maximo juntos muestran cuanta variacion hay de verdad.
  rendimiento: db.prepare(`
    SELECT q.nombre AS queso, q.familia,
           COUNT(*)      AS tinas,
           SUM(t.cantidad) AS piezas,
           ROUND(AVG(t.cantidad), 1) AS promedio,
           MIN(t.cantidad) AS minimo,
           MAX(t.cantidad) AS maximo
      FROM tinas t
      JOIN tipos_queso q ON q.id = t.tipo_queso_id
     WHERE t.anulado = 0
       AND date(t.fecha_hora, 'localtime') BETWEEN ? AND ?
       AND (? = '' OR q.nombre = ?)
     GROUP BY q.id
     ORDER BY piezas DESC
  `),
  yogur: db.prepare(`
    SELECT m.nombre AS marca, p.nombre AS sabor,
           COUNT(*) AS bins, COALESCE(SUM(y.unidades), 0) AS unidades, SUM(y.kilos) AS kilos
      FROM registros_yogur y
      JOIN marcas    m ON m.id = y.marca_id
      JOIN productos p ON p.id = y.producto_id
     WHERE y.anulado = 0
       AND date(y.fecha_hora, 'localtime') BETWEEN ? AND ?
     GROUP BY m.id, p.id
     ORDER BY unidades DESC
  `),
  lecheria: db.prepare(`
    SELECT m.nombre AS marca, p.nombre AS producto,
           COUNT(*) AS pallets, COALESCE(SUM(r.litros), 0) AS litros
      FROM registros_pallet r
      JOIN marcas    m ON m.id = r.marca_id
      JOIN productos p ON p.id = r.producto_id
     WHERE r.anulado = 0
       AND date(r.fecha_hora, 'localtime') BETWEEN ? AND ?
     GROUP BY m.id, p.id
     ORDER BY pallets DESC
  `),
  // Minutos entre el fin de produccion y el ingreso a sal: es el intervalo que
  // importa para el control de pH [A3 01:08].
  //
  // Devuelve la lista y no un promedio a proposito. Cuando alguien se olvida de
  // marcar la entrada y la carga al otro dia, ese registro vale miles de minutos y
  // ensucia cualquier promedio. Se usa la MEDIANA, que no se mueve por dos outliers,
  // y aparte se cuentan las demoras para que no se pierdan: una tina marcada 20 h
  // tarde es en si misma una señal, no ruido para descartar.
  tiemposASal: db.prepare(`
    SELECT (julianday(MIN(m.fecha_hora)) - julianday(t.fecha_hora)) * 1440 AS minutos
      FROM tinas t
      JOIN movimientos_saladero m ON m.tina_id = t.id AND m.tipo = 'entrada' AND m.anulado = 0
      JOIN tipos_queso q ON q.id = t.tipo_queso_id
     WHERE t.anulado = 0
       AND date(t.fecha_hora, 'localtime') BETWEEN ? AND ?
       AND (? = '' OR q.nombre = ?)
     GROUP BY t.id
     ORDER BY minutos
  `),
  enSalAhora: db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN m.tipo = 'entrada' THEN m.cantidad ELSE -m.cantidad END), 0) AS n
      FROM movimientos_saladero m
      JOIN tinas t ON t.id = m.tina_id
      JOIN tipos_queso q ON q.id = t.tipo_queso_id
     WHERE m.anulado = 0 AND t.anulado = 0
       AND (? = '' OR q.nombre = ?)
  `),
  detalleTinas: db.prepare(`
    SELECT t.fecha_hora, q.nombre AS queso, t.cantidad, o.nombre AS operario, t.origen
      FROM tinas t
      JOIN tipos_queso q ON q.id = t.tipo_queso_id
      JOIN operarios   o ON o.id = t.operario_id
     WHERE t.anulado = 0
       AND date(t.fecha_hora, 'localtime') BETWEEN ? AND ?
       AND (? = '' OR q.nombre = ?)
     ORDER BY t.fecha_hora DESC
     LIMIT 500
  `),
}

// Rango por defecto: ultimos 30 dias. (Definida con `function` a proposito: se usa
// tambien en recepcion, que esta mas arriba en el archivo.)
function rango(req) {
  const hasta = req.query.hasta ?? hoyLocal()
  const desde = req.query.desde ?? restarDias(hasta, 29)
  return [desde, hasta]
}

app.get('/api/reportes', async (req, res) => {
  const [desde, hasta] = rango(req)
  const queso = req.query.queso ?? ''

  const porDiaTinas = await qRep.piezasPorDia.all(desde, hasta, queso, queso)
  const porDiaPallets = await qRep.palletsPorDia.all(desde, hasta)

  // Serie continua: los dias sin produccion valen cero, no se saltean. Un hueco en
  // el eje haria parecer que se produjo todos los dias.
  //
  // El 'T00:00:00' NO es decorativo. new Date('2026-08-15') se parsea como medianoche
  // UTC, y toLocaleDateString despues lo pasa a hora local: en UTC-3 eso corre cada
  // dia uno para atras y deja el ultimo afuera del rango. El resultado era que el
  // total del reporte no incluia el dia de hoy y no coincidia con los graficos, que
  // suman por SQL. Con 'T00:00:00' se parsea como medianoche LOCAL y cierra.
  const dias = []
  for (
    let d = new Date(`${desde}T00:00:00`);
    d <= new Date(`${hasta}T00:00:00`);
    d.setDate(d.getDate() + 1)
  ) {
    const fecha = d.toLocaleDateString('sv-SE')
    dias.push({
      fecha,
      piezas: porDiaTinas.find((x) => x.fecha === fecha)?.piezas ?? 0,
      tinas: porDiaTinas.find((x) => x.fecha === fecha)?.tinas ?? 0,
      pallets: porDiaPallets.find((x) => x.fecha === fecha)?.pallets ?? 0,
      litros: porDiaPallets.find((x) => x.fecha === fecha)?.litros ?? 0,
    })
  }

  const rendimiento = await qRep.rendimiento.all(desde, hasta, queso, queso)

  // Umbral de "marcado tarde": mas de 12 h entre producir y salar no es un tiempo de
  // proceso, es un olvido. Provisorio hasta saber el intervalo real (pregunta nueva).
  const TARDE = 12 * 60
  const tiempos = (await qRep.tiemposASal.all(desde, hasta, queso, queso)).map((x) => x.minutos)
  const mediana = tiempos.length
    ? Math.round(tiempos[Math.floor(tiempos.length / 2)])
    : null

  res.json({
    desde,
    hasta,
    resumen: {
      piezas: rendimiento.reduce((n, r) => n + r.piezas, 0),
      tinas: rendimiento.reduce((n, r) => n + r.tinas, 0),
      pallets: dias.reduce((n, d) => n + d.pallets, 0),
      litros: dias.reduce((n, d) => n + d.litros, 0),
      yogur_bins: (await qRep.yogur.all(desde, hasta)).reduce((n, r) => n + r.bins, 0),
      yogur_unidades: (await qRep.yogur.all(desde, hasta)).reduce((n, r) => n + r.unidades, 0),
      en_sal: (await qRep.enSalAhora.get(queso, queso)).n,
      minutos_a_sal: mediana,
      muestras_a_sal: tiempos.length,
      tardias: tiempos.filter((m) => m > TARDE).length,
    },
    dias,
    rendimiento,
    lecheria: await qRep.lecheria.all(desde, hasta),
    yogur: await qRep.yogur.all(desde, hasta),
    // Orden canonico de los productos, independiente de lo que traiga el filtro.
    // El color de cada tipo de leche se asigna por esta lista y no por el orden de
    // aparicion: si cambiar el rango repintara las series, comparar dos periodos
    // seria enganoso.
    productos: (await qCatalogo.productos.all('leche')).map((p) => p.nombre),
    detalle: await qRep.detalleTinas.all(desde, hasta, queso, queso),
  })
})

app.get('/api/reportes.csv', async (req, res) => {
  const [desde, hasta] = rango(req)
  const queso = req.query.queso ?? ''
  const filas = await qRep.detalleTinas.all(desde, hasta, queso, queso)
  const csv = [
    'fecha_hora,queso,cantidad,operario,origen',
    ...filas.map((r) => [r.fecha_hora, r.queso, r.cantidad, r.operario, r.origen].join(',')),
  ].join('\n')
  res.type('text/csv').attachment(`produccion-${desde}_${hasta}.csv`).send(csv)
})

// ---------------------------------------------------------------- estatico

app.use(
  express.static(join(root, 'public'), {
    setHeaders(res, ruta) {
      // Los assets del escritorio llevan el hash del contenido en el nombre, así que un
      // archivo con ese nombre nunca cambia: se puede cachear para siempre. Es lo que
      // evita que el navegador vuelva a bajar 350 KB de JS en cada visita.
      if (ruta.includes(`${sep}app${sep}assets${sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      }
    },
  })
)

// El escritorio nuevo (React) es una SPA: sus rutas —/app/reportes y las que vengan—
// solo existen en el navegador. Si alguien las abre directo o recarga, el estático no
// encuentra archivo y contesta 404; hay que devolverle el index y dejar que el router
// resuelva. Se limita a /app para no tocar nada de lo que ya funciona: las tablets y
// el tablero siguen siendo archivos de verdad en la raíz.
app.get('/app/*', (req, res, next) => {   // Express 4: comodin '*', no ':splat'
  // Una ruta CON extensión que llegó hasta acá es un archivo que no existe, y tiene que
  // dar 404. Contestarla con el index devuelve HTML donde el navegador espera JS, y el
  // error que muestra es "MIME type" — que no dice nada de la causa real: un index viejo
  // en caché pidiendo un asset que el build nuevo ya borró.
  if (/\.[a-z0-9]+$/i.test(req.path)) return next()

  // El shell NO se cachea. Sus assets llevan hash y sí, pero si el shell se guarda, tras
  // cada despliegue el navegador sigue pidiendo los archivos de la versión anterior.
  res.setHeader('Cache-Control', 'no-cache')
  res.sendFile(join(root, 'public', 'app', 'index.html'), (err) => {
    if (!err) return
    // Todavia no se corrio el build del escritorio. Es lo PRIMERO que pasa en una
    // maquina recien clonada, asi que la instruccion va en la pantalla y no en el log
    // del servidor: quien abre el navegador no lo esta mirando.
    res.status(503).type('html').send(`<!doctype html>
<meta charset="utf-8">
<title>Falta compilar el escritorio</title>
<body style="font:15px/1.5 system-ui;max-width:34rem;margin:15vh auto;padding:0 1.5rem">
<h1 style="font-size:19px">El escritorio no está compilado</h1>
<p>Las pantallas de <code>/app</code> se generan con un paso de build. Corré:</p>
<pre style="background:#f4f4f2;padding:12px 14px;border-radius:8px">npm run web:install   # solo la primera vez
npm run web:build</pre>
<p style="color:#666">Las tablets de planta no dependen de esto:
<a href="/">seguí a la pantalla de sectores</a>.</p>
</body>`)
  })
})

// Último recurso: un error que llegó hasta acá se registra entero y se responde 500.
// Sin esto el cliente recibe una conexión cortada y nadie sabe qué pasó.
app.use((err, _req, res, _next) => {
  console.error('Error no manejado:', err.message)
  if (err.stack) console.error(err.stack.split(String.fromCharCode(10)).slice(1, 4).join(String.fromCharCode(10)))
  if (!res.headersSent) res.status(500).json({ error: 'error interno' })
})

// La app se EXPORTA y el listen queda condicionado a que este archivo sea el que se
// ejecutó. Es lo que permite que el mismo código corra como proceso de siempre (un
// servidor en la fábrica) y como función en un hosting serverless, donde no hay ningún
// proceso al que hacerle listen: el entorno importa la app y le pasa cada request.
export { app }

// pathToFileURL y no comparar strings de path: en Windows argv[1] viene con barras
// invertidas y con la unidad en mayúscula, y import.meta.url no. Comparar las dos URLs
// ya normalizadas es lo único que funciona igual en los dos sistemas.
const ejecutadoDirecto =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href

if (ejecutadoDirecto) {
  const port = process.env.PORT ?? 3000
  app.listen(port, () => {
    console.log(`Fabrica Belgrano - http://localhost:${port}`)
    avisarMotor()
    avisarAcceso()
    programarBackups()
  })
}
