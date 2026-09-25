// ABM de los datos maestros: operarios, clientes, tambos y marcas.
//
// Hasta ahora agregar un operario o un cliente necesitaba un desarrollador con una
// terminal abierta. Eso convierte en un pedido por chat lo que debería ser un minuto de
// la persona que sabe cómo se llama su gente, y garantiza que el sistema arranque con
// "Operario 1" y "Cliente 3" en la pantalla.
//
// NADA SE BORRA. Se da de baja con `activo`, exactamente por la misma razón por la que
// no se borra un pallet: un operario que ya registró producción tiene que seguir
// existiendo para que su nombre aparezca en el historial. La baja lo saca de las
// pantallas, no de la historia.
//
// Las definiciones son declarativas y la tabla NUNCA sale del request: sólo de este
// mapa. Es lo que hace que un handler genérico no sea una puerta de entrada.

const FAMILIAS = ['leche', 'yogur']

export const SECTORES = [
  { clave: 'lecheria', nombre: 'Lechería' },
  { clave: 'yogures', nombre: 'Yogures' },
  { clave: 'recepcion', nombre: 'Recepción de leche' },
  { clave: 'queseria', nombre: 'Quesería' },
  { clave: 'saladero', nombre: 'Saladero' },
  { clave: 'maduracion', nombre: 'Maduración' },
  { clave: 'envasado', nombre: 'Envasado' },
  { clave: 'pedidos', nombre: 'Armado de pedidos' },
]

const texto = (v) => (typeof v === 'string' ? v.trim() : '')

/**
 * Cada maestro declara: cómo se lista (con su cuenta de uso), qué campos acepta, cómo
 * se validan y cómo se cuenta un duplicado. El resto —alta, edición, baja, orden— es
 * igual para los cuatro y vive una sola vez, más abajo.
 */
export const MAESTROS = {
  operarios: {
    etiqueta: 'operario',
    // El uso suma los siete lugares donde un operario deja rastro. Sirve para una sola
    // cosa, pero importante: ver si alguien ya registró producción antes de tocarlo.
    listar: `
      SELECT o.id, o.nombre, o.sector, o.activo, o.orden,
             (SELECT COUNT(*) FROM registros_pallet      x WHERE x.operario_id = o.id AND x.anulado = 0)
           + (SELECT COUNT(*) FROM registros_yogur       x WHERE x.operario_id = o.id AND x.anulado = 0)
           + (SELECT COUNT(*) FROM recepciones           x WHERE x.operario_id = o.id AND x.anulado = 0)
           + (SELECT COUNT(*) FROM tinas                 x WHERE x.operario_id = o.id AND x.anulado = 0)
           + (SELECT COUNT(*) FROM movimientos_saladero  x WHERE x.operario_id = o.id AND x.anulado = 0)
           + (SELECT COUNT(*) FROM movimientos_maduracion x WHERE x.operario_id = o.id AND x.anulado = 0)
           + (SELECT COUNT(*) FROM movimientos_envasado  x WHERE x.operario_id = o.id AND x.anulado = 0)
             AS usos
        FROM operarios o
       ORDER BY o.sector, o.orden, o.nombre
    `,
    // El orden y la unicidad son POR SECTOR: puede haber un "Juan" en lechería y otro
    // en quesería, y son dos personas distintas con el mismo nombre de pila.
    agrupaPor: 'sector',
    leer(cuerpo, actual) {
      const nombre = texto(cuerpo?.nombre) || actual?.nombre
      const sector = texto(cuerpo?.sector) || actual?.sector
      if (!nombre) return { error: 'falta el nombre' }
      if (nombre.length > 60) return { error: 'nombre demasiado largo' }
      if (!SECTORES.some((s) => s.clave === sector)) return { error: 'sector inválido' }
      return { valores: { nombre, sector } }
    },
    duplicado: 'SELECT id FROM operarios WHERE nombre = @nombre AND sector = @sector',
    insertar: 'INSERT INTO operarios (nombre, sector, activo, orden) VALUES (@nombre, @sector, true, @orden)',
    actualizar: 'UPDATE operarios SET nombre = @nombre, sector = @sector WHERE id = @id',
    maxOrden: 'SELECT COALESCE(MAX(orden), 0) AS n FROM operarios WHERE sector = @sector',
  },

  // Los motivos por los que una entrega de leche cruda queda observada. Van acá porque
  // la lista la conoce la fábrica, no el código: el sembrado ("cortada", "con olor"...)
  // es un punto de partida y el encargado lo ajusta a lo que realmente pasa.
  motivos_recepcion: {
    etiqueta: 'motivo',
    listar: `
      SELECT m.id, m.nombre, m.activo, m.orden,
             (SELECT COUNT(*) FROM recepciones r WHERE r.motivo_id = m.id AND r.anulado = 0) AS usos
        FROM motivos_recepcion m
       ORDER BY m.orden, m.nombre
    `,
    leer(cuerpo, actual) {
      const nombre = texto(cuerpo?.nombre) || actual?.nombre
      if (!nombre) return { error: 'falta el nombre' }
      // Corto a propósito: son botones en una tablet, y un motivo largo no entra.
      if (nombre.length > 40) return { error: 'nombre demasiado largo' }
      return { valores: { nombre } }
    },
    duplicado: 'SELECT id FROM motivos_recepcion WHERE nombre = @nombre',
    insertar: 'INSERT INTO motivos_recepcion (nombre, activo, orden) VALUES (@nombre, true, @orden)',
    actualizar: 'UPDATE motivos_recepcion SET nombre = @nombre WHERE id = @id',
    maxOrden: 'SELECT COALESCE(MAX(orden), 0) AS n FROM motivos_recepcion',
  },

  clientes: {
    etiqueta: 'cliente',
    listar: `
      SELECT c.id, c.nombre, c.activo, c.orden,
             (SELECT COUNT(*) FROM pedidos p WHERE p.cliente_id = c.id AND p.anulado = 0) AS usos
        FROM clientes c
       ORDER BY c.orden, c.nombre
    `,
    leer(cuerpo, actual) {
      const nombre = texto(cuerpo?.nombre) || actual?.nombre
      if (!nombre) return { error: 'falta el nombre' }
      if (nombre.length > 80) return { error: 'nombre demasiado largo' }
      return { valores: { nombre } }
    },
    duplicado: 'SELECT id FROM clientes WHERE nombre = @nombre',
    insertar: 'INSERT INTO clientes (nombre, activo, orden) VALUES (@nombre, true, @orden)',
    actualizar: 'UPDATE clientes SET nombre = @nombre WHERE id = @id',
    maxOrden: 'SELECT COALESCE(MAX(orden), 0) AS n FROM clientes',
  },

  tambos: {
    etiqueta: 'tambo',
    listar: `
      SELECT t.id, t.numero, t.nombre, t.activo, t.orden,
             (SELECT COUNT(*) FROM recepciones r WHERE r.tambo_id = t.id AND r.anulado = 0) AS usos
        FROM tambos t
       ORDER BY t.numero
    `,
    leer(cuerpo, actual) {
      // El número es la clave con la que la fábrica los conoce: en el remito del
      // caudalímetro figura "tambo 14", no un nombre. El nombre es opcional y se agrega
      // cuando alguien lo sabe.
      const crudo = cuerpo?.numero ?? actual?.numero
      const numero = Number(crudo)
      if (!Number.isInteger(numero) || numero < 1 || numero > 9999) {
        return { error: 'número de tambo inválido' }
      }
      const nombre = texto(cuerpo?.nombre) || (cuerpo?.nombre === '' ? null : actual?.nombre ?? null)
      if (nombre && nombre.length > 80) return { error: 'nombre demasiado largo' }
      return { valores: { numero, nombre } }
    },
    duplicado: 'SELECT id FROM tambos WHERE numero = @numero',
    insertar: 'INSERT INTO tambos (numero, nombre, activo, orden) VALUES (@numero, @nombre, true, @orden)',
    actualizar: 'UPDATE tambos SET numero = @numero, nombre = @nombre WHERE id = @id',
    maxOrden: 'SELECT COALESCE(MAX(orden), 0) AS n FROM tambos',
  },

  marcas: {
    etiqueta: 'marca',
    listar: `
      SELECT m.id, m.nombre, m.es_propia, m.activo, m.orden,
             (SELECT COUNT(*) FROM registros_pallet x WHERE x.marca_id = m.id AND x.anulado = 0)
           + (SELECT COUNT(*) FROM registros_yogur  x WHERE x.marca_id = m.id AND x.anulado = 0)
             AS usos
        FROM marcas m
       ORDER BY m.orden, m.nombre
    `,
    leer(cuerpo, actual) {
      const nombre = texto(cuerpo?.nombre) || actual?.nombre
      if (!nombre) return { error: 'falta el nombre' }
      if (nombre.length > 60) return { error: 'nombre demasiado largo' }
      const es_propia =
        cuerpo?.es_propia === undefined ? Boolean(actual?.es_propia) : Boolean(cuerpo.es_propia)
      // Qué familias produce esta marca. La lechería las usa para filtrar: el yogur va
      // en dos marcas y Obenac no lo hace, y sin esto la tablet ofrece marcas que no
      // corresponden.
      const familias = Array.isArray(cuerpo?.familias)
        ? cuerpo.familias.filter((f) => FAMILIAS.includes(f))
        : null
      if (familias && !familias.length) {
        return { error: 'la marca tiene que producir al menos una familia' }
      }
      return { valores: { nombre, es_propia }, familias }
    },
    duplicado: 'SELECT id FROM marcas WHERE nombre = @nombre',
    insertar: 'INSERT INTO marcas (nombre, es_propia, activo, orden) VALUES (@nombre, @es_propia, true, @orden)',
    actualizar: 'UPDATE marcas SET nombre = @nombre, es_propia = @es_propia WHERE id = @id',
    maxOrden: 'SELECT COALESCE(MAX(orden), 0) AS n FROM marcas',
    // Relación aparte, que se reemplaza entera al guardar.
    familiasDe: 'SELECT familia FROM marcas_familias WHERE marca_id = ?',
    borrarFamilias: 'DELETE FROM marcas_familias WHERE marca_id = ?',
    agregarFamilia: 'INSERT INTO marcas_familias (marca_id, familia) VALUES (?, ?)',
  },
}

export function montarMaestros(app, db) {
  const q = {}
  for (const [tipo, def] of Object.entries(MAESTROS)) {
    q[tipo] = {
      listar: db.prepare(def.listar),
      duplicado: db.prepare(def.duplicado),
      insertar: db.prepare(def.insertar),
      actualizar: db.prepare(def.actualizar),
      maxOrden: db.prepare(def.maxOrden),
      uno: db.prepare(`SELECT * FROM ${tipo} WHERE id = ?`),
      visibilidad: db.prepare(`UPDATE ${tipo} SET activo = @activo, orden = @orden WHERE id = @id`),
      ...(def.familiasDe
        ? {
            familiasDe: db.prepare(def.familiasDe),
            borrarFamilias: db.prepare(def.borrarFamilias),
            agregarFamilia: db.prepare(def.agregarFamilia),
          }
        : {}),
    }
  }

  const definicion = (req, res) => {
    const def = MAESTROS[req.params.tipo]
    if (!def) {
      res.status(404).json({ error: 'maestro inexistente' })
      return null
    }
    return def
  }

  async function listado(tipo) {
    const filas = await q[tipo].listar.all()
    if (!MAESTROS[tipo].familiasDe) return filas
    // Las familias van con cada marca: la pantalla las edita junto al nombre, no en
    // otro lado.
    return Promise.all(
      filas.map(async (m) => ({
        ...m,
        familias: (await q[tipo].familiasDe.all(m.id)).map((f) => f.familia),
      }))
    )
  }

  async function guardarFamilias(tipo, id, familias) {
    if (!familias || !MAESTROS[tipo].familiasDe) return
    await q[tipo].borrarFamilias.run(id)
    for (const f of familias) await q[tipo].agregarFamilia.run(id, f)
  }

  // Todo junto: la pantalla es una sola y pedir cuatro veces sería cuatro idas y
  // vueltas para pintar lo mismo.
  app.get('/api/maestros', async (_req, res) => {
    const salida = { sectores: SECTORES }
    for (const tipo of Object.keys(MAESTROS)) salida[tipo] = await listado(tipo)
    res.json(salida)
  })

  app.post('/api/maestros/:tipo', async (req, res) => {
    const def = definicion(req, res)
    if (!def) return
    const tipo = req.params.tipo

    const leido = def.leer(req.body, null)
    if (leido.error) return res.status(400).json({ error: leido.error })

    if (await q[tipo].duplicado.get(leido.valores)) {
      return res.status(409).json({ error: `ya existe ese ${def.etiqueta}` })
    }

    // El orden arranca al final de su grupo: lo recién creado no se mete en el medio de
    // una lista que alguien ordenó a mano.
    const orden = ((await q[tipo].maxOrden.get(leido.valores)).n ?? 0) + 1
    const info = await q[tipo].insertar.run({ ...leido.valores, orden })
    await guardarFamilias(tipo, info.lastInsertRowid, leido.familias)
    res.status(201).json(await listado(tipo))
  })

  app.put('/api/maestros/:tipo/:id', async (req, res) => {
    const def = definicion(req, res)
    if (!def) return
    const tipo = req.params.tipo
    const id = Number(req.params.id)

    const actual = await q[tipo].uno.get(id)
    if (!actual) return res.status(404).json({ error: `${def.etiqueta} inexistente` })

    const leido = def.leer(req.body, actual)
    if (leido.error) return res.status(400).json({ error: leido.error })

    const choque = await q[tipo].duplicado.get(leido.valores)
    if (choque && choque.id !== id) {
      return res.status(409).json({ error: `ya existe ese ${def.etiqueta}` })
    }

    await q[tipo].actualizar.run({ ...leido.valores, id })
    await guardarFamilias(tipo, id, leido.familias)
    res.json(await listado(tipo))
  })

  // Alta y baja, separada de los datos: mover algo de lugar o sacarlo de las pantallas
  // no debería obligar a reescribir su nombre.
  app.put('/api/maestros/:tipo/:id/visibilidad', async (req, res) => {
    const def = definicion(req, res)
    if (!def) return
    const tipo = req.params.tipo
    const id = Number(req.params.id)

    const actual = await q[tipo].uno.get(id)
    if (!actual) return res.status(404).json({ error: `${def.etiqueta} inexistente` })

    const activo = req.body?.activo === undefined ? Boolean(actual.activo) : Boolean(req.body.activo)
    const orden = Number(req.body?.orden)
    if (req.body?.orden !== undefined && (!Number.isInteger(orden) || orden < 0 || orden > 999)) {
      return res.status(400).json({ error: 'orden inválido' })
    }

    await q[tipo].visibilidad.run({
      id,
      activo,
      orden: req.body?.orden === undefined ? actual.orden : orden,
    })
    res.json(await listado(tipo))
  })
}
