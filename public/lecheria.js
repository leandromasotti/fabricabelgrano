// Lecheria: registrar cada pallet armado, por marca y tipo de leche.
// Es el sector mas simple del circuito y por eso es el piloto: el proceso ya esta
// estandarizado en papel ("precario pero bastante aceitado" [A2 00:21]).

import {
  $, hhmm, cola, red, horaServidor, pintarEstado, postear, sincronizar,
  cargarCatalogo, botones, hacerPasos, pintarMigas, cuentaRegresiva, registrarSW,
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
  const local = {
    ...cuerpo,
    fecha_hora: fecha.toISOString(),
    operario: est.operario.nombre,
    marca: est.marca.nombre,
    producto: est.producto.nombre,
  }

  // Optimista: el operario ve la confirmacion ya. Que el POST llegue o se encole es
  // problema nuestro, no suyo - el ya solto el pallet y agarro el siguiente.
  est.ultimo = local
  $('listo-hora').textContent = hhmm(fecha)
  $('listo-detalle').textContent = `${local.marca} · ${local.producto} · ${local.operario}`
  irA('listo')
  clearInterval(est.timer)
  est.timer = cuentaRegresiva(VENTANA_DESHACER, $('deshacer-seg'), reiniciar)
  agregarFila(local, true)

  try {
    if (!red.hay) throw new Error('sin red')
    const guardado = await postear('/api/registros', cuerpo)
    est.ultimo.id = guardado.id
    refrescarHoy()
  } catch {
    cola.agregar({
      ruta: '/api/registros',
      cuerpo: { ...cuerpo, fecha_hora_cliente: fecha.toISOString() },
    })
    red.hay = false
  }
  pintarEstado()
}

// El deshacer cubre el error real: "toque el boton de al lado". Lo que cae fuera de la
// ventana se corrige desde la pantalla del encargado.
async function deshacer() {
  clearInterval(est.timer)
  const u = est.ultimo
  if (!u) return reiniciar()
  if (u.id) {
    await fetch(`/api/registros/${u.id}/anular`, { method: 'POST' }).catch(() => {})
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
  el.querySelector('.q').textContent = `${r.marca} · ${r.producto}`
  el.querySelector('.op').textContent = r.operario
  return el
}

function agregarFila(r, pendiente) {
  $('lista-hoy').prepend(fila(r, pendiente))
  $('total-hoy').textContent = Number($('total-hoy').textContent) + 1
}

async function refrescarHoy() {
  if (!red.hay) return
  try {
    const { registros, total } = await (await fetch('/api/registros')).json()
    $('total-hoy').textContent = total
    $('lista-hoy').replaceChildren(...registros.slice(0, 20).map((r) => fila(r)))
  } catch {
    red.hay = false
    pintarEstado()
  }
}

// ---------------------------------------------------------------- arranque

const catalogo = await cargarCatalogo('lecheria')

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
