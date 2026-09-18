// Produccion de queseria: el quesero registra la tina y cuantas piezas salieron.
// La cantidad no se puede pre-cargar ni sugerir: "no siempre salen las mismas, depende
// de la altura de la masa, de lo que rindio" [A3 00:24]. Sugerir un numero sesgaria
// justo el dato que se quiere medir.

import {
  $, hhmm, cola, red, horaServidor, pintarEstado, postear, sincronizar,
  cargarCatalogo, configurarTablet, botones, hacerPasos, pintarMigas, cuentaRegresiva, registrarSW,
} from '/comun.js'

const VENTANA_DESHACER = 60
const FAMILIAS = [
  ['blando', 'Pasta blanda'],
  ['semiduro', 'Pasta semidura'],
  ['duro', 'Pasta dura'],
]

const est = { operario: null, queso: null, cantidad: '', ultimo: null, timer: null }
const mostrar = hacerPasos(['operario', 'queso', 'cantidad', 'listo'], ['queso', 'cantidad'])

function irA(paso) {
  mostrar(paso)
  $('btn-reiniciar').hidden = paso === 'operario'
  pintarMigas([est.operario?.nombre, est.queso?.nombre])
}

function reiniciar(conservarOperario = true) {
  clearInterval(est.timer)
  est.queso = null
  est.cantidad = ''
  if (!conservarOperario) est.operario = null
  irA(est.operario ? 'queso' : 'operario')
}

// ---------------------------------------------------------------- quesos

// 17 tipos no entran como grilla plana legible: se agrupan por familia para que el
// quesero encuentre el suyo sin leer los 17.
function pintarQuesos(quesos) {
  const cont = $('op-quesos')
  cont.replaceChildren()
  for (const [familia, titulo] of FAMILIAS) {
    const delGrupo = quesos.filter((q) => q.familia === familia)
    if (!delGrupo.length) continue

    const grupo = document.createElement('div')
    grupo.className = 'grupo'
    const h = document.createElement('div')
    h.className = 'grupo-titulo'
    h.textContent = titulo
    const grilla = document.createElement('div')
    grilla.className = 'opciones'
    botones(grilla, delGrupo, (q) => {
      est.queso = q
      est.cantidad = ''
      pintarCantidad()
      irA('cantidad')
    })
    grilla.querySelectorAll('.opcion').forEach((b) => b.classList.add('chica'))
    grupo.append(h, grilla)
    cont.append(grupo)
  }
}

// ---------------------------------------------------------------- teclado

function pintarCantidad() {
  const v = $('valor')
  v.textContent = est.cantidad || '0'
  v.classList.toggle('vacio', !est.cantidad)
  $('unidad').textContent = est.cantidad === '1' ? 'pieza' : 'piezas'
  $('tecla-ok').disabled = !est.cantidad || Number(est.cantidad) < 1
}

function tecla(valor) {
  if (valor === 'borrar') est.cantidad = est.cantidad.slice(0, -1)
  else if (est.cantidad.length < 4) est.cantidad = (est.cantidad + valor).replace(/^0+/, '')
  pintarCantidad()
}

function armarTeclado() {
  const t = $('teclado')
  t.replaceChildren()
  for (const n of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) {
    const b = document.createElement('button')
    b.className = 'tecla'
    b.textContent = n
    b.onclick = () => tecla(n)
    t.append(b)
  }
  const borrar = document.createElement('button')
  borrar.className = 'tecla borrar'
  borrar.textContent = '⌫'
  borrar.onclick = () => tecla('borrar')

  const cero = document.createElement('button')
  cero.className = 'tecla'
  cero.textContent = '0'
  cero.onclick = () => tecla('0')

  const ok = document.createElement('button')
  ok.className = 'tecla ok'
  ok.id = 'tecla-ok'
  ok.textContent = 'LISTO'
  ok.disabled = true
  ok.onclick = registrar

  t.append(borrar, cero, ok)
}

// ---------------------------------------------------------------- registrar

async function registrar() {
  const cantidad = Number(est.cantidad)
  if (!cantidad) return

  const fecha = horaServidor()
  const cuerpo = {
    client_id: crypto.randomUUID(),
    operario_id: est.operario.id,
    tipo_queso_id: est.queso.id,
    cantidad,
  }

  const local = {
    ...cuerpo,
    fecha_hora: fecha.toISOString(),
    operario: est.operario.nombre,
    queso: est.queso.nombre,
    cantidad,
  }

  // Optimista: el quesero ya cerro la tina y sigue trabajando.
  est.ultimo = local
  $('listo-hora').textContent = hhmm(fecha)
  $('listo-detalle').textContent = `${local.queso} · ${cantidad} piezas · ${local.operario}`
  irA('listo')
  clearInterval(est.timer)
  est.timer = cuentaRegresiva(VENTANA_DESHACER, $('deshacer-seg'), reiniciar)
  agregarFila(local, true)

  try {
    if (!red.hay) throw new Error('sin red')
    const guardado = await postear('/api/tinas', cuerpo)
    est.ultimo.id = guardado.id
    refrescarHoy()
  } catch {
    cola.agregar({ ruta: '/api/tinas', cuerpo: { ...cuerpo, fecha_hora_cliente: fecha.toISOString() } })
    red.hay = false
  }
  pintarEstado()
}

async function deshacer() {
  clearInterval(est.timer)
  const u = est.ultimo
  if (!u) return reiniciar()
  if (u.id) {
    await fetch(`/api/tinas/${u.id}/anular`, { method: 'POST' }).catch(() => {})
  } else {
    cola.quitar(u.client_id)
  }
  est.ultimo = null
  pintarEstado()
  refrescarHoy()
  reiniciar()
}

// ---------------------------------------------------------------- historial

function fila(t, pendiente = false) {
  const el = document.createElement('div')
  el.className = `fila${pendiente ? ' pendiente' : ''}${t.anulado ? ' anulada' : ''}`
  el.innerHTML = '<span class="h"></span><span class="q"></span><span class="op"></span>'
  el.querySelector('.h').textContent = hhmm(t.fecha_hora)
  el.querySelector('.q').textContent = `${t.queso} · ${t.cantidad}`
  el.querySelector('.op').textContent = t.operario
  return el
}

function agregarFila(t, pendiente) {
  $('lista-hoy').prepend(fila(t, pendiente))
  $('total-hoy').textContent = Number($('total-hoy').textContent) + 1
  $('piezas-hoy').textContent = Number($('piezas-hoy').textContent) + t.cantidad
}

async function refrescarHoy() {
  if (!red.hay) return
  try {
    const { tinas, total, piezas } = await (await fetch('/api/tinas')).json()
    $('total-hoy').textContent = total
    $('piezas-hoy').textContent = piezas
    $('lista-hoy').replaceChildren(...tinas.slice(0, 20).map((t) => fila(t)))
  } catch {
    red.hay = false
    pintarEstado()
  }
}

// ---------------------------------------------------------------- arranque

const catalogo = await cargarCatalogo('queseria')
configurarTablet(catalogo)

botones($('op-operarios'), catalogo.operarios, (o) => {
  est.operario = o
  irA('queso')
})
pintarQuesos(catalogo.quesos)
armarTeclado()

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
