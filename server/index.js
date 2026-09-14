import express from 'express'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { db, ahora } from './db.js'
import { programarBackups } from './backup.js'
import { acceso, avisarAcceso } from './acceso.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const app = express()
// La clave va ANTES de todo: estático, API y lo que venga después.
app.use(acceso)
app.use(express.json())

const hoyLocal = () => new Date().toLocaleDateString('sv-SE') // YYYY-MM-DD local
const existe = (tabla, id) =>
  db.prepare(`SELECT 1 FROM ${tabla} WHERE id = ? AND activo = 1`).get(id) !== undefined

// Toda escritura de los sectores comparte estas dos reglas:
//  - client_id repetido = reenvio de la cola offline, se devuelve el original
//  - si viene fecha_hora_cliente, el registro se hizo sin red y la hora es de la tablet
const marcaDeTiempo = (fechaCliente) =>
  fechaCliente
    ? { fecha_hora: fechaCliente, origen: 'offline', sincronizado: ahora() }
    : { fecha_hora: ahora(), origen: 'online', sincronizado: null }

// ---------------------------------------------------------------- catalogo

const qCatalogo = {
  operarios: db.prepare(
    'SELECT id, nombre FROM operarios WHERE activo = 1 AND sector = ? ORDER BY orden, nombre'
  ),
  marcas: db.prepare('SELECT id, nombre FROM marcas WHERE activo = 1 ORDER BY orden, nombre'),
  productos: db.prepare(`
    SELECT id, nombre, cajas_por_pallet, litros_por_caja,
           cajas_por_pallet * litros_por_caja AS litros_por_pallet
      FROM productos WHERE activo = 1 AND familia = ? ORDER BY orden, nombre
  `),
  quesos: db.prepare(
    'SELECT id, nombre, familia, se_envasa FROM tipos_queso WHERE activo = 1 ORDER BY orden, nombre'
  ),
}

app.get('/api/catalogo', (req, res) => {
  res.json({
    operarios: qCatalogo.operarios.all(req.query.sector ?? 'lecheria'),
    marcas: qCatalogo.marcas.all(),
    productos: qCatalogo.productos.all('leche'),
    quesos: qCatalogo.quesos.all(),
    // La tablet usa esto para calcular su desfasaje de reloj. Las tablets amuradas
    // se desconfiguran y nadie las mira, y la hora aca es un dato de proceso.
    serverTime: ahora(),
  })
})

// ---------------------------------------------------------------- lecheria

const qPallet = {
  porClientId: db.prepare('SELECT id FROM registros_pallet WHERE client_id = ?'),
  // Los litros se calculan y se guardan ACA, con la equivalencia vigente hoy.
  // Recalcularlos al mostrarlos haria que un cambio futuro de caja reescriba la
  // historia.
  insertar: db.prepare(`
    INSERT INTO registros_pallet
      (client_id, fecha_hora, origen, sincronizado, operario_id, marca_id, producto_id, litros)
    VALUES
      (@client_id, @fecha_hora, @origen, @sincronizado, @operario_id, @marca_id, @producto_id,
       (SELECT cajas_por_pallet * litros_por_caja FROM productos WHERE id = @producto_id))
  `),
  detalle: db.prepare(`
    SELECT r.id, r.client_id, r.fecha_hora, r.origen, r.anulado, r.litros,
           o.nombre AS operario, m.nombre AS marca, p.nombre AS producto
      FROM registros_pallet r
      JOIN operarios o ON o.id = r.operario_id
      JOIN marcas    m ON m.id = r.marca_id
      JOIN productos p ON p.id = r.producto_id
     WHERE r.id = ?
  `),
  delDia: db.prepare(`
    SELECT r.id, r.client_id, r.fecha_hora, r.origen, r.anulado, r.litros,
           o.nombre AS operario, m.nombre AS marca, p.nombre AS producto
      FROM registros_pallet r
      JOIN operarios o ON o.id = r.operario_id
      JOIN marcas    m ON m.id = r.marca_id
      JOIN productos p ON p.id = r.producto_id
     WHERE date(r.fecha_hora, 'localtime') = ?
     ORDER BY r.fecha_hora DESC
  `),
  anular: db.prepare(
    'UPDATE registros_pallet SET anulado = 1, anulado_en = ? WHERE id = ? AND anulado = 0'
  ),
}

app.post('/api/registros', (req, res) => {
  const { client_id, operario_id, marca_id, producto_id, fecha_hora_cliente } = req.body ?? {}

  if (!client_id || !operario_id || !marca_id || !producto_id) {
    return res.status(400).json({ error: 'faltan campos obligatorios' })
  }

  // Reenvio de la cola offline: ya lo teniamos, devolvemos el que existe.
  // Sin esto, cada reintento de sincronizacion duplicaria el pallet.
  const previo = qPallet.porClientId.get(client_id)
  if (previo) return res.json({ ...qPallet.detalle.get(previo.id), duplicado: true })

  if (!existe('operarios', operario_id)) return res.status(400).json({ error: 'operario inexistente' })
  if (!existe('marcas', marca_id)) return res.status(400).json({ error: 'marca inexistente' })
  if (!existe('productos', producto_id)) return res.status(400).json({ error: 'producto inexistente' })

  const info = qPallet.insertar.run({
    client_id,
    ...marcaDeTiempo(fecha_hora_cliente),
    operario_id,
    marca_id,
    producto_id,
  })
  res.status(201).json(qPallet.detalle.get(info.lastInsertRowid))
})

app.get('/api/registros', (req, res) => {
  const fecha = req.query.fecha ?? hoyLocal()
  const registros = qPallet.delDia.all(fecha)
  const vivos = registros.filter((r) => !r.anulado)
  res.json({
    fecha,
    total: vivos.length,
    litros: vivos.reduce((n, r) => n + (r.litros ?? 0), 0),
    registros,
  })
})

app.post('/api/registros/:id/anular', (req, res) => {
  const id = Number(req.params.id)
  if (qPallet.anular.run(ahora(), id).changes === 0) {
    return res.status(404).json({ error: 'no existe o ya estaba anulado' })
  }
  res.json(qPallet.detalle.get(id))
})

app.get('/api/registros.csv', (req, res) => {
  const fecha = req.query.fecha ?? hoyLocal()
  const filas = qPallet.delDia.all(fecha).filter((r) => !r.anulado)
  const csv = [
    'fecha_hora,operario,marca,producto,litros,origen',
    ...filas.map((r) =>
      [r.fecha_hora, r.operario, r.marca, r.producto, r.litros ?? '', r.origen].join(',')
    ),
  ].join('\n')
  res.type('text/csv').attachment(`pallets-${fecha}.csv`).send(csv)
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

app.post('/api/tinas', (req, res) => {
  const { client_id, operario_id, tipo_queso_id, cantidad, fecha_hora_cliente } = req.body ?? {}

  if (!client_id || !operario_id || !tipo_queso_id) {
    return res.status(400).json({ error: 'faltan campos obligatorios' })
  }
  // El rinde es variable (117 / 120 / 124 segun la altura de la masa), pero cero o
  // negativo es siempre un error de carga.
  if (!Number.isInteger(cantidad) || cantidad < 1) {
    return res.status(400).json({ error: 'cantidad debe ser un entero mayor a cero' })
  }

  const previo = qTina.porClientId.get(client_id)
  if (previo) return res.json({ ...qTina.detalle.get(previo.id), duplicado: true })

  if (!existe('operarios', operario_id)) return res.status(400).json({ error: 'operario inexistente' })
  if (!existe('tipos_queso', tipo_queso_id)) return res.status(400).json({ error: 'queso inexistente' })

  const info = qTina.insertar.run({
    client_id,
    ...marcaDeTiempo(fecha_hora_cliente),
    operario_id,
    tipo_queso_id,
    cantidad,
  })
  res.status(201).json(qTina.detalle.get(info.lastInsertRowid))
})

app.get('/api/tinas', (req, res) => {
  const fecha = req.query.fecha ?? hoyLocal()
  const tinas = qTina.delDia.all(fecha)
  const vivas = tinas.filter((t) => !t.anulado)
  res.json({
    fecha,
    total: vivas.length,
    piezas: vivas.reduce((n, t) => n + t.cantidad, 0),
    tinas,
  })
})

app.post('/api/tinas/:id/anular', (req, res) => {
  const id = Number(req.params.id)
  if (qTina.anular.run(ahora(), id).changes === 0) {
    return res.status(404).json({ error: 'no existe o ya estaba anulada' })
  }
  res.json(qTina.detalle.get(id))
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
   GROUP BY t.id
`

const qSal = {
  pendientes: db.prepare(`SELECT * FROM (${SALDOS}) WHERE entrada < cantidad ORDER BY fecha_hora`),
  enSal: db.prepare(`SELECT * FROM (${SALDOS}) WHERE entrada > salida ORDER BY primera_entrada`),
  saldoDe: db.prepare(`SELECT * FROM (${SALDOS}) WHERE id = ?`),
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
app.get('/api/saladero/pendientes', (_req, res) => {
  res.json(
    qSal.pendientes.all().map((t) => ({
      ...t,
      falta: t.cantidad - t.entrada,
      minutos_desde_produccion: minutosDesde(t.fecha_hora),
    }))
  )
})

app.get('/api/saladero/en-sal', (_req, res) => {
  res.json(
    qSal.enSal.all().map((t) => ({
      ...t,
      en_sal: t.entrada - t.salida,
      minutos_en_sal: t.primera_entrada ? minutosDesde(t.primera_entrada) : null,
    }))
  )
})

app.post('/api/saladero', (req, res) => {
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

  const previo = qSal.porClientId.get(client_id)
  if (previo) return res.json({ ...qSal.detalle.get(previo.id), duplicado: true })

  if (!existe('operarios', operario_id)) return res.status(400).json({ error: 'operario inexistente' })

  const saldo = qSal.saldoDe.get(tina_id)
  if (!saldo) return res.status(400).json({ error: 'tina inexistente o anulada' })

  // No se puede salar mas de lo que se produjo, ni sacar mas de lo que hay adentro.
  const tope = tipo === 'entrada' ? saldo.cantidad - saldo.entrada : saldo.entrada - saldo.salida
  if (cantidad > tope) {
    return res.status(409).json({
      error: tipo === 'entrada' ? 'excede lo producido en la tina' : 'excede lo que hay en sal',
      disponible: tope,
    })
  }

  const info = qSal.insertar.run({
    client_id,
    ...marcaDeTiempo(fecha_hora_cliente),
    operario_id,
    tina_id,
    tipo,
    cantidad,
  })
  res.status(201).json(qSal.detalle.get(info.lastInsertRowid))
})

app.get('/api/saladero', (req, res) => {
  const fecha = req.query.fecha ?? hoyLocal()
  const movimientos = qSal.delDia.all(fecha)
  const vivos = movimientos.filter((m) => !m.anulado)
  const sumar = (tipo) =>
    vivos.filter((m) => m.tipo === tipo).reduce((n, m) => n + m.cantidad, 0)
  res.json({ fecha, entradas: sumar('entrada'), salidas: sumar('salida'), movimientos })
})

app.post('/api/saladero/:id/anular', (req, res) => {
  const id = Number(req.params.id)
  if (qSal.anular.run(ahora(), id).changes === 0) {
    return res.status(404).json({ error: 'no existe o ya estaba anulado' })
  }
  res.json(qSal.detalle.get(id))
})

// ---------------------------------------------------------------- maduracion

// "Si yo sé los que hay ahí y sé CUÁNDO ENTRARON, sé cuántos días tienen los pategrás
// de maduración, para saber si van a abrir ojos" [A5 00:39-00:51].
//
// El reloj arranca al ENTRAR a la cámara, no al producir: entre producir y madurar hay
// saladero, y contar esos días como maduración declararía apto un queso todavía verde.
//
// SUPUESTO DE CIRCUITO (pregunta B3, sin confirmar): sal → maduración → envasado.
// Un queso que madura entra a cámara al salir de sal, y recién cuando sale de cámara
// queda disponible para envasar. El sardo, que no se envasa, sale de cámara y ya está
// listo. Si el circuito real resulta ser otro, se cambia en esta sección y en
// ENVASADO_SALDOS; nada más depende de esto.

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
    SELECT * FROM (${MADURACION_SALDOS})
     WHERE madura = 1 AND salio_de_sal > entro_camara
     ORDER BY fecha_hora
  `),
  // Adentro de la cámara ahora.
  enCamara: db.prepare(`
    SELECT * FROM (${MADURACION_SALDOS})
     WHERE entro_camara > salio_camara
     ORDER BY entrada_camara
  `),
  saldoDe: db.prepare(`SELECT * FROM (${MADURACION_SALDOS}) WHERE id = ?`),
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

app.get('/api/maduracion/pendientes', (_req, res) => {
  res.json(
    qMad.paraEntrar.all().map((t) => ({
      ...t,
      falta: t.salio_de_sal - t.entro_camara,
      minutos_desde_sal: null,
    }))
  )
})

app.get('/api/maduracion/camara', (_req, res) => {
  const lotes = qMad.enCamara.all().map((t) => {
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

app.post('/api/maduracion', (req, res) => {
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

  const previo = qMad.porClientId.get(client_id)
  if (previo) return res.json({ ...qMad.detalle.get(previo.id), duplicado: true })

  if (!existe('operarios', operario_id)) return res.status(400).json({ error: 'operario inexistente' })

  const saldo = qMad.saldoDe.get(tina_id)
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

  const info = qMad.insertar.run({
    client_id,
    ...marcaDeTiempo(fecha_hora_cliente),
    operario_id,
    tina_id,
    tipo,
    cantidad,
    dias_reales: diasReales,
  })
  res.status(201).json(qMad.detalle.get(info.lastInsertRowid))
})

app.get('/api/maduracion', (req, res) => {
  const fecha = req.query.fecha ?? hoyLocal()
  const movimientos = qMad.delDia.all(fecha)
  const vivos = movimientos.filter((m) => !m.anulado)
  const sumar = (tipo) => vivos.filter((m) => m.tipo === tipo).reduce((n, m) => n + m.cantidad, 0)
  res.json({ fecha, entradas: sumar('entrada'), salidas: sumar('salida'), movimientos })
})

app.post('/api/maduracion/:id/anular', (req, res) => {
  const id = Number(req.params.id)
  if (qMad.anular.run(ahora(), id).changes === 0) {
    return res.status(404).json({ error: 'no existe o ya estaba anulado' })
  }
  res.json(qMad.detalle.get(id))
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

app.get('/api/quesos/dias', (_req, res) => {
  res.json({
    quesos: qDias.todos.all(),
    // Lo que tardaron de verdad, para contrastar contra el número cargado.
    reales: qMad.realesPorQueso.all(),
  })
})

app.put('/api/quesos/:id/dias', (req, res) => {
  const { madura, dias_minimos, dias_optimos, dias_maximos } = req.body ?? {}
  const id = Number(req.params.id)
  if (!existe('tipos_queso', id)) return res.status(404).json({ error: 'queso inexistente' })

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
  qDias.actualizar.run({ id, madura: madura ? 1 : 0, min, opt, max })
  res.json(qDias.todos.all().find((q) => q.id === id))
})

// ---------------------------------------------------------------- envasado

// "Una vez que sale del saladero, el queso desnudo va a una camara de desnudo, y
// desde esa camara el flaco que los envasa envasa las barras, envasa el cremoso.
// Los sardos no se envasan" [A4 00:31-00:52].
//
// Disponible para envasar = lo que salio de sal - lo ya envasado.

// De dónde toma el envasado depende de si el queso madura:
//   - no madura (cremoso, mozzarella): se envasa apenas sale de sal
//   - madura (pategrás, reggianito): primero pasa por cámara, se envasa al salir
// Ese "disponible" es el único lugar donde vive el supuesto de circuito de la
// pregunta B3. Si resulta que en la planta se envasa antes de madurar, se cambia acá.
const ENVASADO_SALDOS = `
  SELECT t.id, t.fecha_hora, t.cantidad, q.nombre AS queso, q.familia, q.se_envasa, q.madura,
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

const DISPONIBLE_ENVASAR = 'CASE WHEN madura = 1 THEN salio_camara ELSE salio_de_sal END'

const qEnv = {
  // Solo lo que efectivamente se envasa Y ya está disponible segun su circuito.
  // El sardo (se_envasa = 0) nunca aparece: sale de cámara y ya está listo.
  pendientes: db.prepare(`
    SELECT *, ${DISPONIBLE_ENVASAR} AS disponible,
           COALESCE(salida_camara_fecha, ultima_salida) AS espera_desde
      FROM (${ENVASADO_SALDOS})
     WHERE se_envasa = 1 AND ${DISPONIBLE_ENVASAR} > envasado
     ORDER BY espera_desde
  `),
  saldoDe: db.prepare(`SELECT * FROM (${ENVASADO_SALDOS}) WHERE id = ?`),
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

app.get('/api/envasado/pendientes', (_req, res) => {
  res.json({
    pendientes: qEnv.pendientes.all().map((t) => ({
      ...t,
      falta: t.disponible - t.envasado,
      minutos_desde_sal: t.espera_desde ? minutosDesde(t.espera_desde) : null,
      // De dónde viene: cambia el texto que ve el operario.
      viene_de: t.madura ? 'maduración' : 'saladero',
    })),
  })
})

app.post('/api/envasado', (req, res) => {
  const { client_id, operario_id, tina_id, cantidad, fecha_hora_cliente } = req.body ?? {}

  if (!client_id || !operario_id || !tina_id) {
    return res.status(400).json({ error: 'faltan campos obligatorios' })
  }
  if (!Number.isInteger(cantidad) || cantidad < 1) {
    return res.status(400).json({ error: 'cantidad debe ser un entero mayor a cero' })
  }

  const previo = qEnv.porClientId.get(client_id)
  if (previo) return res.json({ ...qEnv.detalle.get(previo.id), duplicado: true })

  if (!existe('operarios', operario_id)) return res.status(400).json({ error: 'operario inexistente' })

  const saldo = qEnv.saldoDe.get(tina_id)
  if (!saldo) return res.status(400).json({ error: 'tina inexistente o anulada' })
  if (!saldo.se_envasa) {
    return res.status(409).json({ error: `el ${saldo.queso} no se envasa` })
  }

  // No se puede envasar mas de lo disponible segun el circuito del queso.
  const base = saldo.madura ? saldo.salio_camara : saldo.salio_de_sal
  const disponible = base - saldo.envasado
  if (cantidad > disponible) {
    return res.status(409).json({
      error: saldo.madura ? 'excede lo que salió de la cámara' : 'excede lo que salió de sal',
      disponible,
    })
  }

  const info = qEnv.insertar.run({
    client_id,
    ...marcaDeTiempo(fecha_hora_cliente),
    operario_id,
    tina_id,
    cantidad,
  })
  res.status(201).json(qEnv.detalle.get(info.lastInsertRowid))
})

app.get('/api/envasado', (req, res) => {
  const fecha = req.query.fecha ?? hoyLocal()
  const movimientos = qEnv.delDia.all(fecha)
  const vivos = movimientos.filter((m) => !m.anulado)
  res.json({
    fecha,
    envasado: vivos.reduce((n, m) => n + m.cantidad, 0),
    movimientos,
  })
})

app.post('/api/envasado/:id/anular', (req, res) => {
  const id = Number(req.params.id)
  if (qEnv.anular.run(ahora(), id).changes === 0) {
    return res.status(404).json({ error: 'no existe o ya estaba anulado' })
  }
  res.json(qEnv.detalle.get(id))
})

// ---------------------------------------------------------------- pedidos

// El problema que resuelve este modulo esta en el audio 6: hoy el encargado baja un
// papel, el operario pesa los quesos y los anota a mano, sube el papel, y recien ahi
// se puede facturar. El cuello de botella no es anotar: es que Andres no puede
// facturar NADA hasta que suban todos los pedidos juntos [A6 01:33].

const qPed = {
  clientes: db.prepare('SELECT id, nombre FROM clientes WHERE activo = 1 ORDER BY orden, nombre'),
  porClientId: db.prepare('SELECT id FROM pedidos WHERE client_id = ?'),

  crear: db.prepare(`
    INSERT INTO pedidos (client_id, cliente_id, estado, origen, creado_en, nota)
    VALUES (@client_id, @cliente_id, @estado, @origen, @creado_en, @nota)
  `),
  crearLinea: db.prepare(`
    INSERT INTO pedido_lineas (pedido_id, tipo_queso_id, cantidad_pedida)
    VALUES (?, ?, ?)
  `),

  cabecera: db.prepare(`
    SELECT p.id, p.client_id, p.estado, p.origen, p.creado_en, p.armado_en, p.facturado_en,
           p.nota, p.anulado, c.nombre AS cliente, o.nombre AS armador
      FROM pedidos p
      JOIN clientes c ON c.id = p.cliente_id
      LEFT JOIN operarios o ON o.id = p.armado_por
     WHERE p.id = ?
  `),
  lineas: db.prepare(`
    SELECT l.id, l.tipo_queso_id, l.cantidad_pedida, q.nombre AS queso, q.familia
      FROM pedido_lineas l
      JOIN tipos_queso q ON q.id = l.tipo_queso_id
     WHERE l.pedido_id = ?
     ORDER BY l.id
  `),
  pesosDe: db.prepare(`
    SELECT id, client_id, gramos, fecha_hora, origen
      FROM pedido_pesos
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
  lineaDe: db.prepare('SELECT l.id, l.pedido_id FROM pedido_lineas l WHERE l.id = ?'),
  agregarPeso: db.prepare(`
    INSERT INTO pedido_pesos (client_id, linea_id, gramos, fecha_hora, origen)
    VALUES (@client_id, @linea_id, @gramos, @fecha_hora, @origen)
  `),
  anularPeso: db.prepare(
    'UPDATE pedido_pesos SET anulado = 1, anulado_en = ? WHERE id = ? AND anulado = 0'
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
function pedidoCompleto(id) {
  const cab = qPed.cabecera.get(id)
  if (!cab) return null

  const lineas = qPed.lineas.all(id).map((l) => {
    const pesos = qPed.pesosDe.all(l.id)
    const gramos = pesos.reduce((n, p) => n + p.gramos, 0)
    return {
      ...l,
      pesos,
      piezas: pesos.length,
      gramos,
      // Diferencia entre lo pedido y lo que se esta entregando. Puede ser negativa:
      // si en la camara hay 2 y pidieron 3, el sistema no lo impide, lo muestra.
      diferencia: pesos.length - l.cantidad_pedida,
    }
  })

  return {
    ...cab,
    lineas,
    piezas: lineas.reduce((n, l) => n + l.piezas, 0),
    piezas_pedidas: lineas.reduce((n, l) => n + l.cantidad_pedida, 0),
    gramos: lineas.reduce((n, l) => n + l.gramos, 0),
  }
}

app.get('/api/clientes', (_req, res) => res.json(qPed.clientes.all()))

app.post('/api/pedidos', (req, res) => {
  const { client_id, cliente_id, lineas, origen, nota } = req.body ?? {}

  if (!client_id || !cliente_id || !Array.isArray(lineas) || !lineas.length) {
    return res.status(400).json({ error: 'faltan cliente o líneas' })
  }
  for (const l of lineas) {
    if (!l.tipo_queso_id || !Number.isInteger(l.cantidad_pedida) || l.cantidad_pedida < 1) {
      return res.status(400).json({ error: 'línea inválida' })
    }
    if (!existe('tipos_queso', l.tipo_queso_id)) {
      return res.status(400).json({ error: 'queso inexistente' })
    }
  }

  const previo = qPed.porClientId.get(client_id)
  if (previo) return res.json({ ...pedidoCompleto(previo.id), duplicado: true })

  if (!existe('clientes', cliente_id)) return res.status(400).json({ error: 'cliente inexistente' })

  const alta = db.transaction(() => {
    const info = qPed.crear.run({
      client_id,
      cliente_id,
      estado: 'pendiente',
      origen: origen === 'tablet' ? 'tablet' : 'encargado',
      creado_en: ahora(),
      nota: nota ?? null,
    })
    for (const l of lineas) qPed.crearLinea.run(info.lastInsertRowid, l.tipo_queso_id, l.cantidad_pedida)
    return info.lastInsertRowid
  })

  res.status(201).json(pedidoCompleto(alta()))
})

app.get('/api/pedidos', (req, res) => {
  const estado = req.query.estado ?? ''
  const pedidos = qPed.listar.all(estado, estado).map((p) => {
    const completo = pedidoCompleto(p.id)
    return {
      ...p,
      piezas: completo.piezas,
      piezas_pedidas: completo.piezas_pedidas,
      gramos: completo.gramos,
      lineas: completo.lineas.length,
    }
  })
  res.json({ pedidos })
})

app.get('/api/pedidos/:id', (req, res) => {
  const p = pedidoCompleto(Number(req.params.id))
  if (!p) return res.status(404).json({ error: 'no existe' })
  res.json(p)
})

app.post('/api/pedidos/:id/tomar', (req, res) => {
  const id = Number(req.params.id)
  qPed.marcarArmando.run(req.body?.operario_id ?? null, id)
  const p = pedidoCompleto(id)
  if (!p) return res.status(404).json({ error: 'no existe' })
  res.json(p)
})

// Una fila por pieza pesada. client_id unico = la cola offline puede reenviar sin
// duplicar, igual que en el resto del sistema.
app.post('/api/pedidos/pesos', (req, res) => {
  const { client_id, linea_id, gramos, fecha_hora_cliente } = req.body ?? {}

  if (!client_id || !linea_id) return res.status(400).json({ error: 'faltan campos obligatorios' })
  if (!Number.isInteger(gramos) || gramos < 1 || gramos > 200000) {
    return res.status(400).json({ error: 'peso fuera de rango' })
  }

  const previo = qPed.pesoPorClientId.get(client_id)
  if (previo) return res.json({ id: previo.id, duplicado: true })

  const linea = qPed.lineaDe.get(linea_id)
  if (!linea) return res.status(400).json({ error: 'línea inexistente' })

  const marca = marcaDeTiempo(fecha_hora_cliente)
  const info = qPed.agregarPeso.run({
    client_id,
    linea_id,
    gramos,
    fecha_hora: marca.fecha_hora,
    origen: marca.origen,
  })
  res.status(201).json({ id: info.lastInsertRowid, pedido: pedidoCompleto(linea.pedido_id) })
})

app.post('/api/pedidos/pesos/:id/anular', (req, res) => {
  const id = Number(req.params.id)
  if (qPed.anularPeso.run(ahora(), id).changes === 0) {
    return res.status(404).json({ error: 'no existe o ya estaba anulado' })
  }
  res.json({ ok: true })
})

app.post('/api/pedidos/:id/cerrar', (req, res) => {
  const id = Number(req.params.id)
  if (qPed.cerrar.run(ahora(), req.body?.operario_id ?? null, id).changes === 0) {
    return res.status(409).json({ error: 'el pedido no está en condiciones de cerrarse' })
  }
  res.json(pedidoCompleto(id))
})

app.post('/api/pedidos/:id/reabrir', (req, res) => {
  const id = Number(req.params.id)
  if (qPed.reabrir.run(id).changes === 0) {
    return res.status(409).json({ error: 'solo se puede reabrir un pedido listo' })
  }
  res.json(pedidoCompleto(id))
})

app.post('/api/pedidos/:id/facturar', (req, res) => {
  const id = Number(req.params.id)
  if (qPed.facturar.run(ahora(), id).changes === 0) {
    return res.status(409).json({ error: 'solo se puede facturar un pedido listo' })
  }
  res.json(pedidoCompleto(id))
})

app.post('/api/pedidos/:id/anular', (req, res) => {
  const id = Number(req.params.id)
  if (qPed.anular.run(ahora(), id).changes === 0) {
    return res.status(404).json({ error: 'no existe o ya estaba anulado' })
  }
  res.json({ ok: true })
})

// Lo que el encargado necesita para facturar, en el formato mas plano posible.
app.get('/api/pedidos/:id/remito.csv', (req, res) => {
  const p = pedidoCompleto(Number(req.params.id))
  if (!p) return res.status(404).send('no existe')
  const filas = ['cliente,queso,piezas_pedidas,piezas_entregadas,kilos']
  for (const l of p.lineas) {
    filas.push([p.cliente, l.queso, l.cantidad_pedida, l.piezas, (l.gramos / 1000).toFixed(3)].join(','))
  }
  filas.push(['', 'TOTAL', p.piezas_pedidas, p.piezas, (p.gramos / 1000).toFixed(3)].join(','))
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
    HAVING piezas > 0
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
    )
  `),
}

// Umbrales provisorios: no sabemos los reales todavia (pregunta B6).
const ALERTA_SAL_MIN = 4 * 60
const ALERTA_DESNUDO_MIN = 48 * 60

app.get('/api/tablero', (_req, res) => {
  const hoy = hoyLocal()

  const movSal = qTab.movSaladeroHoy.all(hoy)
  const dePedidos = qTab.pedidosPorEstado.all()
  const cuenta = (estado) => dePedidos.find((p) => p.estado === estado)?.n ?? 0

  const enSal = qTab.enSalAhora.all()
  const paraEnvasar = qTab.paraEnvasar.all()
  const producido = qTab.producidoHoy.all(hoy)
  const esperandoSal = qTab.esperandoSal.all()

  const demoradasSal = esperandoSal
    .map((t) => ({ ...t, minutos: minutosDesde(t.fecha_hora) }))
    .filter((t) => t.minutos >= ALERTA_SAL_MIN)

  const desnudoViejo = paraEnvasar
    .filter((t) => t.se_envasa && t.mas_viejo && minutosDesde(t.mas_viejo) >= ALERTA_DESNUDO_MIN)
    .map((t) => ({ ...t, minutos: minutosDesde(t.mas_viejo) }))

  res.json({
    hora: ahora(),
    fecha: hoy,

    lecheria: (() => {
      const detalle = qTab.palletsHoy.all(hoy)
      return {
        detalle,
        total: detalle.reduce((n, r) => n + r.pallets, 0),
        litros: detalle.reduce((n, r) => n + r.litros, 0),
      }
    })(),

    // FLUJO del dia
    hoy: {
      piezas: producido.reduce((n, r) => n + r.piezas, 0),
      tinas: producido.reduce((n, r) => n + r.tinas, 0),
      por_queso: producido,
      entro_a_sal: movSal.find((m) => m.tipo === 'entrada')?.piezas ?? 0,
      salio_de_sal: movSal.find((m) => m.tipo === 'salida')?.piezas ?? 0,
      envasado: qTab.envasadoHoy.get(hoy).piezas,
      pedidos_terminados: qTab.pedidosHoy.get(hoy).n,
      promedio_piezas: qTab.promedioDiario.get(hoy, hoy)?.promedio ?? null,
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
      kilos_listos: qTab.kilosListos.get().gramos / 1000,
    },

    // Lo que hay que mirar, no solo lo que paso.
    alertas: {
      esperando_sal: demoradasSal.map((t) => ({ queso: t.queso, piezas: t.falta, minutos: t.minutos })),
      desnudo_viejo: desnudoViejo.map((t) => ({ queso: t.queso, piezas: t.piezas, minutos: t.minutos })),
    },
  })
})

// ---------------------------------------------------------------- reportes

// Todo lo de aca abajo responde a un rango de fechas. El encargado nunca pidió un
// reporte concreto (pregunta C1), asi que estos son los que se desprenden de los
// datos que ya se capturan. El de rendimiento por tina es el unico que muestra algo
// que hoy la fabrica no puede ver de ninguna manera.

const qRep = {
  piezasPorDia: db.prepare(`
    SELECT date(fecha_hora, 'localtime') AS fecha,
           COUNT(*)      AS tinas,
           SUM(cantidad) AS piezas
      FROM tinas
     WHERE anulado = 0
       AND date(fecha_hora, 'localtime') BETWEEN ? AND ?
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
     GROUP BY q.id
     ORDER BY piezas DESC
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
     WHERE t.anulado = 0
       AND date(t.fecha_hora, 'localtime') BETWEEN ? AND ?
     GROUP BY t.id
     ORDER BY minutos
  `),
  enSalAhora: db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN m.tipo = 'entrada' THEN m.cantidad ELSE -m.cantidad END), 0) AS n
      FROM movimientos_saladero m
      JOIN tinas t ON t.id = m.tina_id
     WHERE m.anulado = 0 AND t.anulado = 0
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

// Rango por defecto: ultimos 30 dias.
function rango(req) {
  const hasta = req.query.hasta ?? hoyLocal()
  const desde =
    req.query.desde ??
    new Date(Date.parse(`${hasta}T00:00:00`) - 29 * 864e5).toLocaleDateString('sv-SE')
  return [desde, hasta]
}

app.get('/api/reportes', (req, res) => {
  const [desde, hasta] = rango(req)
  const queso = req.query.queso ?? ''

  const porDiaTinas = qRep.piezasPorDia.all(desde, hasta)
  const porDiaPallets = qRep.palletsPorDia.all(desde, hasta)

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

  const rendimiento = qRep.rendimiento.all(desde, hasta)

  // Umbral de "marcado tarde": mas de 12 h entre producir y salar no es un tiempo de
  // proceso, es un olvido. Provisorio hasta saber el intervalo real (pregunta nueva).
  const TARDE = 12 * 60
  const tiempos = qRep.tiemposASal.all(desde, hasta).map((x) => x.minutos)
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
      en_sal: qRep.enSalAhora.get().n,
      minutos_a_sal: mediana,
      muestras_a_sal: tiempos.length,
      tardias: tiempos.filter((m) => m > TARDE).length,
    },
    dias,
    rendimiento,
    lecheria: qRep.lecheria.all(desde, hasta),
    // Orden canonico de los productos, independiente de lo que traiga el filtro.
    // El color de cada tipo de leche se asigna por esta lista y no por el orden de
    // aparicion: si cambiar el rango repintara las series, comparar dos periodos
    // seria enganoso.
    productos: qCatalogo.productos.all('leche').map((p) => p.nombre),
    detalle: qRep.detalleTinas.all(desde, hasta, queso, queso),
  })
})

app.get('/api/reportes.csv', (req, res) => {
  const [desde, hasta] = rango(req)
  const queso = req.query.queso ?? ''
  const filas = qRep.detalleTinas.all(desde, hasta, queso, queso)
  const csv = [
    'fecha_hora,queso,cantidad,operario,origen',
    ...filas.map((r) => [r.fecha_hora, r.queso, r.cantidad, r.operario, r.origen].join(',')),
  ].join('\n')
  res.type('text/csv').attachment(`produccion-${desde}_${hasta}.csv`).send(csv)
})

// ---------------------------------------------------------------- estatico

app.use(express.static(join(root, 'public')))

const port = process.env.PORT ?? 3000
app.listen(port, () => {
  console.log(`Fabrica Belgrano - http://localhost:${port}`)
  avisarAcceso()
  programarBackups()
})
