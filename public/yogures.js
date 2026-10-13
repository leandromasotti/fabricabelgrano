// Producción de yogures. Tablet separada de la de leches, como se acordó con el
// cliente: son dos puestos distintos y mezclarlos obligaría a elegir "leche o yogur"
// en cada registro, un toque de más todo el día para nada.
//
// Se registra BIN POR BIN. El recipiente es un bin plástico de 500 litros, así que
// entran ~500 sachets de 1 litro; esa cantidad está configurada, y el operario solo
// elige marca y sabor: dos toques y listo.
//
// EL BIN ES UN HECHO, LOS SACHETS Y LOS KILOS SON ESTIMACIONES. El cliente confirmó
// que la cantidad por bin varía y decidió usar 500 como valor de trabajo hasta tener
// precisión. Por eso los derivados se muestran con "≈": un número redondo sin marcar
// se lee como medido, y alguien va a terminar facturando o planificando con él.
//
// Solo dos sabores (vainilla y frutilla) y dos marcas: Obenac no hace yogur. El
// catálogo ya viene filtrado por el servidor, así que acá no hay ninguna regla escrita
// a mano.

import {
  $, hhmm, cola, red, horaServidor, pintarEstado, postear, sincronizar,
  cargarCatalogo, configurarTablet, botones, hacerPasos, pintarMigas, cuentaRegresiva, registrarSW,
  configurarVuelta,
  pintarDesglose, sumarDesglose,
} from '/comun.js'

const VENTANA_DESHACER = 60

// Lo que el operario puede decir mirando un bin. Cuatro opciones y no un numero: nadie
// distingue 60 de 65 a ojo, y pedirle precision que no tiene solo disfraza de medido un
// numero que sigue siendo estimado.
const LLENADOS = [100, 75, 50, 25]
const COMO_SE_DICE = { 100: 'Lleno', 75: 'Tres cuartos', 50: 'La mitad', 25: 'Un cuarto' }

const est = {
  operario: null, marca: null, producto: null, ultimo: null, timer: null,
  // Lo que se esta tecleando en el paso de cajas (solo potes).
  cajasStr: '',
  // El llenado elegido mientras se corrige un bin, antes de saber el motivo.
  llenadoElegido: null,
}
const mostrar = hacerPasos(['operario', 'marca', 'producto', 'cajas', 'llenado', 'motivo', 'listo'])

const esPote = (p) => p?.presentacion === 'caja'

function irA(paso) {
  mostrar(paso)
  $('btn-reiniciar').hidden = paso === 'operario'
  pintarMigas([est.operario?.nombre, est.marca?.nombre, est.producto?.nombre])
}

// Vuelve a pedir el operario POR DEFECTO.
//
// Las tablets son puestos compartidos colgados de la pared: si el nombre queda elegido
// despues de registrar, el siguiente que pasa carga a nombre del anterior sin enterarse.
// Reportado desde la planta el 2026-09-24.
//
// El default es el comportamiento seguro a proposito: un llamador nuevo que se olvide de
// pasar el parametro vuelve a preguntar el nombre, que es el error barato. La unica
// excepcion es el DESHACER, que pasa `true` porque ahi es la misma persona corrigiendo
// lo que acaba de cargar.
function reiniciar(conservarOperario = false) {
  clearInterval(est.timer)
  est.marca = null
  est.producto = null
  est.cajasStr = ''
  est.llenadoElegido = null
  if (!conservarOperario) est.operario = null
  irA(est.operario ? 'marca' : 'operario')
}

// Que sabores ve esta marca.
//
// Los potes los hace una sola marca, asi que la lista de productos depende de cual se
// eligio. Se pinta en cada paso y no una vez al arrancar: con una lista fija, Central
// Lechera veria potes que no produce y el servidor se los rechazaria despues.
function pintarProductos() {
  const suyos = catalogo.productos.filter(
    (p) => p.marca_id == null || Number(p.marca_id) === Number(est.marca.id),
  )
  botones($('op-productos'), suyos, (p) => {
    est.producto = p
    if (esPote(p)) {
      est.cajasStr = ''
      pintarCajas()
      return irA('cajas')
    }
    registrar()
  })
}

// ---------------------------------------------------------------- registrar

async function registrar() {
  const fecha = horaServidor()
  const pote = esPote(est.producto)
  const cajas = pote ? Number(est.cajasStr) : null
  const cuerpo = {
    client_id: crypto.randomUUID(),
    operario_id: est.operario.id,
    marca_id: est.marca.id,
    producto_id: est.producto.id,
    ...(pote ? { cajas } : {}),
  }
  // El bin arranca lleno SIEMPRE. Si no lo estaba se corrige desde la confirmación, que
  // es el caso raro; ver el comentario de btn-no-lleno.
  const unidades = pote
    ? cajas * (est.producto.unidades_por_bulto ?? 0)
    : (est.producto.unidades_por_bin ?? 0)
  const kilos = est.producto.kilos_por_unidad ? est.producto.kilos_por_unidad * unidades : null

  const local = {
    ...cuerpo,
    fecha_hora: fecha.toISOString(),
    operario: est.operario.nombre,
    marca: est.marca.nombre,
    producto: est.producto.nombre,
    presentacion: est.producto.presentacion ?? 'bin',
    llenado: 100,
    cajas,
    unidades,
    kilos,
  }

  est.ultimo = local
  $('listo-hora').textContent = hhmm(fecha)
  // Los kilos solo se muestran si el peso del sachet está confirmado. Mientras no lo
  // esté, mostrar un número redondo sería peor que no mostrar ninguno.
  pintarConfirmacion()
  irA('listo')
  clearInterval(est.timer)
  est.timer = cuentaRegresiva(VENTANA_DESHACER, $('deshacer-seg'), reiniciar)
  agregarFila(local, true)

  try {
    if (!red.hay) throw new Error('sin red')
    const guardado = await postear('/api/yogur', cuerpo)
    est.ultimo.id = guardado.id
    refrescarHoy()
  } catch {
    cola.agregar({
      ruta: '/api/yogur',
      cuerpo: { ...cuerpo, fecha_hora_cliente: fecha.toISOString() },
    })
    red.hay = false
  }
  pintarEstado()
}

// ---------------------------------------------------------------- cajas (potes)

function pintarCajas() {
  const v = $('cajas-valor')
  v.textContent = est.cajasStr || '0'
  v.classList.toggle('vacio', !est.cajasStr)
  const n = Number(est.cajasStr)
  const porCaja = est.producto?.unidades_por_bulto ?? 0
  $('cajas-equivale').textContent =
    n >= 1 && porCaja ? `${n} × ${porCaja} = ${(n * porCaja).toLocaleString('es-AR')} potes` : ''
  const ok = $('cajas-ok')
  if (ok) ok.disabled = !(n >= 1)
}

function teclaCajas(valor) {
  if (valor === 'borrar') est.cajasStr = est.cajasStr.slice(0, -1)
  // Tres digitos: 999 cajas son 24.000 potes, muy por encima de cualquier produccion de
  // un dia. El tope evita el cero de mas que nadie revisa.
  else if (est.cajasStr.length < 3) est.cajasStr = (est.cajasStr + valor).replace(/^0+/, '')
  pintarCajas()
}

function armarTecladoCajas() {
  const t = $('cajas-teclado')
  t.replaceChildren()
  for (const n of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) {
    const b = document.createElement('button')
    b.className = 'tecla'
    b.textContent = n
    b.onclick = () => teclaCajas(n)
    t.append(b)
  }
  const borrar = document.createElement('button')
  borrar.className = 'tecla borrar'
  borrar.textContent = '⌫'
  borrar.onclick = () => teclaCajas('borrar')

  const cero = document.createElement('button')
  cero.className = 'tecla'
  cero.textContent = '0'
  cero.onclick = () => teclaCajas('0')

  const ok = document.createElement('button')
  ok.className = 'tecla ok'
  ok.id = 'cajas-ok'
  ok.textContent = 'LISTO'
  ok.disabled = true
  ok.onclick = () => { if (Number(est.cajasStr) >= 1) registrar() }

  t.append(borrar, cero, ok)
}

// ---------------------------------------------------------------- la confirmacion

function pintarConfirmacion() {
  const u = est.ultimo
  if (!u) return
  const pote = u.presentacion === 'caja'
  $('listo-titulo').textContent = pote ? 'CAJAS REGISTRADAS' : 'BIN REGISTRADO'

  const partes = [u.marca, u.producto]
  if (pote) partes.push(`${u.cajas} cajas`)
  // El llenado solo se dice cuando NO fue lleno: "bin lleno" en cada registro es ruido
  // que ademas hace que lo excepcional se lea igual que lo normal.
  else if (u.llenado !== 100) partes.push(COMO_SE_DICE[u.llenado] ?? `${u.llenado}%`)
  partes.push(`≈ ${u.unidades.toLocaleString('es-AR')} sachets`)
  if (u.kilos) partes.push(`≈ ${u.kilos.toLocaleString('es-AR')} kg`)
  if (u.motivo) partes.push(u.motivo)
  $('listo-detalle').textContent = partes.join(' · ')

  // Un pote se cuenta por cajas: no hay llenado que ajustar.
  $('btn-no-lleno').hidden = pote
  $('btn-no-lleno').textContent = u.llenado === 100 ? 'No se llenó el bin' : 'Corregir el llenado'
}

// ---------------------------------------------------------------- el bin que no se lleno
//
// "Hay bines que no llegan llenos porque quizás se termina antes el yogurt y te queda
//  1/2 bin." [Alexis, 12/10]
//
// NO es un paso del flujo. La enorme mayoria de los bins salen llenos y pagarian un toque
// de mas todo el dia por la excepcion; se registra el bin lleno y, si no lo fue, se
// corrige desde la misma confirmacion. Mismo criterio que "No fue un pallet completo" de
// lecheria y que la observacion de recepcion.

function pintarLlenados() {
  botones(
    $('op-llenados'),
    LLENADOS.map((v) => ({ v, nombre: `${COMO_SE_DICE[v]} · ${v}%` })),
    (o) => {
      est.llenadoElegido = o.v
      // Un bin lleno no tiene nada que explicar: se guarda y listo.
      if (o.v === 100) return guardarLlenado(100, null)
      irA('motivo')
    },
  )
}

async function guardarLlenado(llenado, motivo) {
  const u = est.ultimo
  if (!u) return
  irA('listo')
  // Se pinta antes de que conteste el servidor: el operario ya tomo la decision y la
  // pantalla tiene que reflejarla. Si falla, se avisa.
  const antes = { unidades: u.unidades, kilos: u.kilos, llenado: u.llenado, motivo: u.motivo }
  const base = est.producto?.unidades_por_bin ?? 0
  u.llenado = llenado
  u.motivo = motivo?.nombre ?? null
  u.unidades = Math.round((base * llenado) / 100)
  u.kilos = est.producto?.kilos_por_unidad ? est.producto.kilos_por_unidad * u.unidades : null
  pintarConfirmacion()

  try {
    if (!red.hay) throw new Error('sin red')
    await fetch('/api/yogur/llenado', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: u.client_id, llenado, motivo_id: motivo?.id ?? null }),
    }).then((r) => { if (!r.ok) throw new Error('rechazado') })
    refrescarHoy()
  } catch {
    // Sin red el registro todavia esta en la cola: se corrige ahi, que es donde vive
    // hasta que haya conexion. El servidor recalcula las unidades con el llenado cuando
    // le llegue, asi que alcanza con mandarle el porcentaje y el motivo.
    const ajustado = cola.actualizar(u.client_id, { llenado, motivo_id: motivo?.id ?? null })
    if (!ajustado) {
      Object.assign(u, antes)
      pintarConfirmacion()
      alert('No se pudo corregir el llenado: sin conexión. Probá de nuevo cuando vuelva.')
    }
  }
}

async function deshacer() {
  clearInterval(est.timer)
  const u = est.ultimo
  if (!u) return reiniciar(true)
  if (u.id) {
    await fetch(`/api/yogur/${u.id}/anular`, { method: 'POST' }).catch(() => {})
  } else {
    cola.quitar(u.client_id)
  }
  est.ultimo = null
  pintarEstado()
  refrescarHoy()
  reiniciar(true)
}

// ---------------------------------------------------------------- historial

function fila(r, pendiente = false) {
  const el = document.createElement('div')
  el.className = `fila${pendiente ? ' pendiente' : ''}${r.anulado ? ' anulada' : ''}`
  el.innerHTML = '<span class="h"></span><span class="q"></span><span class="op"></span>'
  el.querySelector('.h').textContent = hhmm(r.fecha_hora)
  // El llenado solo se escribe cuando NO fue lleno: ponerlo en todas las filas haría que
  // la excepción se lea igual que lo normal, que es lo contrario de lo que sirve.
  const cuanto =
    r.presentacion === 'caja'
      ? `${r.cajas} cajas`
      : (r.llenado ?? 100) === 100
        ? `${r.unidades}`
        : `${COMO_SE_DICE[r.llenado] ?? `${r.llenado}%`} · ${r.unidades}`
  el.querySelector('.q').textContent =
    `${r.marca} · ${r.producto} · ${cuanto}` + (r.motivo ? ` · ${r.motivo}` : '')
  el.querySelector('.op').textContent = r.operario
  return el
}

// Igual que en lecheria: se guarda aparte del DOM para poder sumarle de a uno sin red.
let desgloseHoy = []

function agregarFila(r, pendiente) {
  $('lista-hoy').prepend(fila(r, pendiente))
  // Un pote no suma un bin: suma cajas. Mezclarlos daría un total que no es de nada.
  if (r.presentacion === 'caja') {
    $('cajas-hoy-caja').hidden = false
    $('cajas-hoy').textContent = Number($('cajas-hoy').textContent) + (r.cajas ?? 0)
  } else {
    $('bins-hoy').textContent = Number($('bins-hoy').textContent) + 1
  }
  $('unidades-hoy').textContent =
    (Number($('unidades-hoy').textContent.replace(/\./g, '')) + r.unidades).toLocaleString('es-AR')
  const pote = r.presentacion === 'caja'
  desgloseHoy = sumarDesglose(
    desgloseHoy, r.marca, r.producto, pote ? (r.cajas ?? 0) : 1, pote ? 'cajas' : 'bins',
  )
  pintarDesglose($('desglose-hoy'), desgloseHoy, 'bins')
}

async function refrescarHoy() {
  if (!red.hay) return
  try {
    const { registros, bins, cajas, unidades, kilos, por_marca_producto } =
      await (await fetch('/api/yogur')).json()
    $('bins-hoy').textContent = bins
    $('cajas-hoy').textContent = cajas ?? 0
    // La línea de cajas solo aparece los días que hubo potes, que son pocos: un "0 cajas"
    // permanente le saca lugar a lo que se mira todos los días.
    $('cajas-hoy-caja').hidden = !cajas
    $('unidades-hoy').textContent = unidades.toLocaleString('es-AR')
    $('kilos-hoy').textContent = kilos ? ` · ≈ ${kilos.toLocaleString('es-AR')} kg` : ''
    desgloseHoy = por_marca_producto ?? []
    pintarDesglose($('desglose-hoy'), desgloseHoy, 'bins')
    $('lista-hoy').replaceChildren(...registros.slice(0, 20).map((r) => fila(r)))
  } catch {
    red.hay = false
    pintarEstado()
  }
}

// ---------------------------------------------------------------- arranque

const catalogo = await cargarCatalogo('yogures')
configurarTablet(catalogo)
configurarVuelta()

botones($('op-operarios'), catalogo.operarios, (o) => {
  est.operario = o
  irA('marca')
})
botones($('op-marcas'), catalogo.marcas, (m) => {
  est.marca = m
  pintarProductos()
  irA('producto')
})
armarTecladoCajas()
pintarLlenados()
botones($('op-motivos-yogur'), catalogo.motivos_yogur ?? [], (mo) =>
  guardarLlenado(est.llenadoElegido, mo),
)

$('btn-no-lleno').addEventListener('click', () => {
  // La cuenta regresiva se corta: corregir el llenado no es "deshacer", y que el registro
  // se cierre solo mientras el operario elige seria el peor momento.
  clearInterval(est.timer)
  irA('llenado')
})

$('btn-deshacer').addEventListener('click', deshacer)
$('btn-seguir').addEventListener('click', () => {
  clearInterval(est.timer)
  reiniciar()
})
$('btn-reiniciar').addEventListener('click', () => reiniciar(false))
red.alCambiar = refrescarHoy

irA('operario')
pintarEstado()
await sincronizar()
await refrescarHoy()
registrarSW()
