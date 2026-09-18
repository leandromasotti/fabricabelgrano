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
// Solo dos sabores (vainilla y frutilla) y dos marcas: Ovenac no hace yogur. El
// catálogo ya viene filtrado por el servidor, así que acá no hay ninguna regla escrita
// a mano.

import {
  $, hhmm, cola, red, horaServidor, pintarEstado, postear, sincronizar,
  cargarCatalogo, configurarTablet, botones, hacerPasos, pintarMigas, cuentaRegresiva, registrarSW,
} from '/comun.js'

const VENTANA_DESHACER = 60

const est = { operario: null, marca: null, producto: null, ultimo: null, timer: null }
const mostrar = hacerPasos(['operario', 'marca', 'producto', 'listo'])

function irA(paso) {
  mostrar(paso)
  $('btn-reiniciar').hidden = paso === 'operario'
  pintarMigas([est.operario?.nombre, est.marca?.nombre, est.producto?.nombre])
}

function reiniciar(conservarOperario = true) {
  clearInterval(est.timer)
  est.marca = null
  est.producto = null
  if (!conservarOperario) est.operario = null
  irA(est.operario ? 'marca' : 'operario')
}

// ---------------------------------------------------------------- registrar

async function registrar() {
  const fecha = horaServidor()
  const cuerpo = {
    client_id: crypto.randomUUID(),
    operario_id: est.operario.id,
    marca_id: est.marca.id,
    producto_id: est.producto.id,
  }
  const unidades = est.producto.unidades_por_bin ?? 0
  const kilos = est.producto.kilos_por_unidad ? est.producto.kilos_por_unidad * unidades : null

  const local = {
    ...cuerpo,
    fecha_hora: fecha.toISOString(),
    operario: est.operario.nombre,
    marca: est.marca.nombre,
    producto: est.producto.nombre,
    unidades,
    kilos,
  }

  est.ultimo = local
  $('listo-hora').textContent = hhmm(fecha)
  // Los kilos solo se muestran si el peso del sachet está confirmado. Mientras no lo
  // esté, mostrar un número redondo sería peor que no mostrar ninguno.
  $('listo-detalle').textContent =
    `${local.marca} · ${local.producto} · ≈ ${unidades} sachets` +
    (kilos ? ` · ≈ ${kilos.toLocaleString('es-AR')} kg` : '')
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

async function deshacer() {
  clearInterval(est.timer)
  const u = est.ultimo
  if (!u) return reiniciar()
  if (u.id) {
    await fetch(`/api/yogur/${u.id}/anular`, { method: 'POST' }).catch(() => {})
  } else {
    cola.quitar(u.client_id)
  }
  est.ultimo = null
  pintarEstado()
  refrescarHoy()
  reiniciar()
}

// ---------------------------------------------------------------- historial

function fila(r, pendiente = false) {
  const el = document.createElement('div')
  el.className = `fila${pendiente ? ' pendiente' : ''}${r.anulado ? ' anulada' : ''}`
  el.innerHTML = '<span class="h"></span><span class="q"></span><span class="op"></span>'
  el.querySelector('.h').textContent = hhmm(r.fecha_hora)
  el.querySelector('.q').textContent = `${r.marca} · ${r.producto} · ${r.unidades}`
  el.querySelector('.op').textContent = r.operario
  return el
}

function agregarFila(r, pendiente) {
  $('lista-hoy').prepend(fila(r, pendiente))
  $('bins-hoy').textContent = Number($('bins-hoy').textContent) + 1
  $('unidades-hoy').textContent =
    (Number($('unidades-hoy').textContent.replace(/\./g, '')) + r.unidades).toLocaleString('es-AR')
}

async function refrescarHoy() {
  if (!red.hay) return
  try {
    const { registros, bins, unidades, kilos } = await (await fetch('/api/yogur')).json()
    $('bins-hoy').textContent = bins
    $('unidades-hoy').textContent = unidades.toLocaleString('es-AR')
    $('kilos-hoy').textContent = kilos ? ` · ≈ ${kilos.toLocaleString('es-AR')} kg` : ''
    $('lista-hoy').replaceChildren(...registros.slice(0, 20).map((r) => fila(r)))
  } catch {
    red.hay = false
    pintarEstado()
  }
}

// ---------------------------------------------------------------- arranque

const catalogo = await cargarCatalogo('yogures')
configurarTablet(catalogo)

botones($('op-operarios'), catalogo.operarios, (o) => {
  est.operario = o
  irA('marca')
})
botones($('op-marcas'), catalogo.marcas, (m) => {
  est.marca = m
  irA('producto')
})
botones($('op-productos'), catalogo.productos, (p) => {
  est.producto = p
  registrar()
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
