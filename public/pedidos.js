// Armado de pedidos: el operario arma, pesa pieza por pieza y cierra. Andres lo ve
// arriba en el momento, sin esperar a que suba ningun papel [A6 01:11].
//
// LA DECISION DE DISENO DE ESTA PANTALLA es como se carga el peso. No hay tecla de
// coma: los digitos entran desde la DERECHA, como en una balanza o una registradora.
// Teclear 3-4-5-0 da 3,450 kg. Un operario con guantes y las manos mojadas no tiene
// que apuntarle a un separador decimal, y no existe el error de poner la coma mal
// —que en este sistema seria un error de diez veces en una factura—.

import {
  $, hhmm, cola, red, horaServidor, pintarEstado, postear, sincronizar,
  cargarCatalogo, botones, hacerPasos, pintarMigas, cuentaRegresiva, registrarSW,
} from '/comun.js'

const VENTANA_DESHACER = 60
const FAMILIAS = [
  ['blando', 'Pasta blanda'],
  ['semiduro', 'Pasta semidura'],
  ['duro', 'Pasta dura'],
]

const est = {
  operario: null,
  pedido: null,
  linea: null,
  gramosStr: '',
  // alta de un pedido nuevo
  nuevo: null,
  quesoNuevo: null,
  cantStr: '',
  ultimo: null,
  timer: null,
}

const mostrar = hacerPasos(
  ['operario', 'lista', 'armado', 'pesaje', 'cliente', 'nuevo-queso', 'nuevo-cant', 'listo'],
  ['lista', 'armado', 'pesaje', 'cliente', 'nuevo-queso', 'nuevo-cant']
)

const kg = (gramos) => (gramos / 1000).toFixed(3).replace('.', ',')

function irA(paso) {
  mostrar(paso)
  $('btn-reiniciar').hidden = paso !== 'lista'
  $('btn-volver').hidden = !['armado', 'pesaje', 'cliente', 'nuevo-queso', 'nuevo-cant'].includes(paso)
  pintarMigas([est.operario?.nombre, est.pedido?.cliente ?? est.nuevo?.cliente?.nombre, est.linea?.queso])
}

function volver() {
  if (['cliente', 'nuevo-queso', 'nuevo-cant'].includes(pasoActual())) {
    if (pasoActual() === 'nuevo-cant') return irA('nuevo-queso')
    est.nuevo = null
    return abrirLista()
  }
  if (pasoActual() === 'pesaje') {
    est.linea = null
    return pintarArmado()
  }
  est.pedido = null
  abrirLista()
}

const pasoActual = () =>
  ['operario', 'lista', 'armado', 'pesaje', 'cliente', 'nuevo-queso', 'nuevo-cant', 'listo']
    .find((p) => !$(`paso-${p}`).hidden)

// ---------------------------------------------------------------- lista

async function abrirLista() {
  est.pedido = null
  est.linea = null
  irA('lista')
  const cont = $('lista-pedidos')
  cont.replaceChildren(aviso('Buscando…'))

  let pedidos = []
  try {
    pedidos = (await (await fetch('/api/pedidos')).json()).pedidos
    red.hay = true
  } catch {
    red.hay = false
    pintarEstado()
    // Sin red no se sabe que pedidos hay ni cuales ya tomó otro. Armar a ciegas
    // generaria pedidos duplicados entre dos operarios.
    cont.replaceChildren(aviso('Sin conexión: no se pueden ver los pedidos. Reintentá cuando haya red.'))
    return
  }

  const abiertos = pedidos.filter((p) => p.estado === 'pendiente' || p.estado === 'armando')
  if (!abiertos.length) {
    cont.replaceChildren(aviso('No hay pedidos para armar.'))
    return
  }
  cont.replaceChildren(...abiertos.map(tarjetaPedido))
}

function tarjetaPedido(p) {
  const b = document.createElement('button')
  b.className = `tarjeta-pedido${p.estado === 'armando' ? ' en-curso' : ''}`

  const cliente = document.createElement('span')
  cliente.className = 'cliente'
  cliente.textContent = p.cliente

  const chip = document.createElement('span')
  chip.className = `chip${p.estado === 'armando' ? ' armando' : ''}`
  chip.textContent = p.estado === 'armando' ? 'En curso' : 'Pendiente'

  const meta = document.createElement('span')
  meta.className = 'meta'
  const fuerte = document.createElement('strong')
  fuerte.textContent = `${p.piezas} / ${p.piezas_pedidas}`
  meta.append(fuerte, document.createTextNode(p.gramos ? `${kg(p.gramos)} kg` : 'sin pesar'))

  b.append(cliente, chip, meta)
  b.onclick = () => abrirPedido(p.id)
  return b
}

// ---------------------------------------------------------------- armado

async function abrirPedido(id) {
  try {
    est.pedido = await postear(`/api/pedidos/${id}/tomar`, { operario_id: est.operario.id })
  } catch {
    red.hay = false
    pintarEstado()
    return
  }
  pintarArmado()
}

function pintarArmado() {
  est.linea = null
  irA('armado')
  const p = est.pedido
  $('titulo-armado').textContent = p.cliente

  $('lista-lineas').replaceChildren(...p.lineas.map((l) => {
    const b = document.createElement('button')
    const completa = l.piezas === l.cantidad_pedida
    const difiere = l.piezas > 0 && l.piezas !== l.cantidad_pedida
    b.className = `linea${completa ? ' completa' : ''}${difiere ? ' difiere' : ''}`

    const queso = document.createElement('span')
    queso.className = 'queso'
    queso.textContent = l.queso

    const prog = document.createElement('span')
    prog.className = 'progreso'
    prog.textContent = `${l.piezas} / ${l.cantidad_pedida}`

    const kilos = document.createElement('span')
    kilos.className = 'kilos'
    kilos.textContent = l.gramos ? `${kg(l.gramos)} kg` : '—'

    b.append(queso, prog, kilos)
    b.onclick = () => abrirPesaje(l)
    return b
  }))

  $('total-piezas').textContent = p.piezas
  $('total-kilos').textContent = kg(p.gramos)
  $('btn-cerrar').disabled = p.piezas === 0
}

// ---------------------------------------------------------------- pesaje

function abrirPesaje(linea) {
  est.linea = linea
  est.gramosStr = ''
  irA('pesaje')
  $('titulo-pesaje').textContent = `${linea.queso} · pedidas ${linea.cantidad_pedida}`
  $('pesadas-pedidas').textContent = linea.cantidad_pedida
  pintarPeso()
  pintarPesadas()
}

function pintarPeso() {
  const g = Number(est.gramosStr || '0')
  const v = $('peso-valor')
  v.textContent = kg(g)
  v.classList.toggle('cero', g === 0)
  $('tecla-agregar').disabled = g < 1
}

function teclaPeso(valor) {
  if (valor === 'borrar') est.gramosStr = est.gramosStr.slice(0, -1)
  // 5 digitos = hasta 99,999 kg. Ninguna pieza de queso se acerca; el tope esta para
  // que un dedo trabado no cargue un numero absurdo.
  else if (est.gramosStr.length < 5) est.gramosStr = (est.gramosStr + valor).replace(/^0+/, '')
  pintarPeso()
}

function pintarPesadas() {
  const l = est.linea
  $('pesadas-n').textContent = l.pesos.length
  $('linea-kilos').textContent = kg(l.gramos)

  $('lista-pesadas').replaceChildren(...l.pesos.map((p, i) => {
    const d = document.createElement('div')
    d.className = 'pesada'
    const idx = document.createElement('span')
    idx.className = 'i'
    idx.textContent = `${i + 1}.`
    const val = document.createElement('span')
    val.className = 'kg'
    val.textContent = `${kg(p.gramos)} kg`
    const x = document.createElement('button')
    x.textContent = '✕'
    x.title = 'Quitar esta pieza'
    x.onclick = () => quitarPesada(p)
    d.append(idx, val, x)
    return d
  }).reverse())
}

async function agregarPeso() {
  const gramos = Number(est.gramosStr || '0')
  if (gramos < 1) return

  const fecha = horaServidor()
  const cuerpo = { client_id: crypto.randomUUID(), linea_id: est.linea.id, gramos }

  // Optimista: la pieza aparece en la lista al instante. El operario ya la puso en
  // la caja y agarro la siguiente.
  est.linea.pesos.push({ id: null, client_id: cuerpo.client_id, gramos })
  est.linea.gramos += gramos
  est.linea.piezas = est.linea.pesos.length
  est.pedido.gramos += gramos
  est.pedido.piezas += 1
  est.gramosStr = ''
  pintarPeso()
  pintarPesadas()

  try {
    if (!red.hay) throw new Error('sin red')
    const r = await postear('/api/pedidos/pesos', cuerpo)
    const guardada = est.linea.pesos.find((p) => p.client_id === cuerpo.client_id)
    if (guardada) guardada.id = r.id
  } catch (e) {
    if (!e.definitivo) {
      cola.agregar({
        ruta: '/api/pedidos/pesos',
        cuerpo: { ...cuerpo, fecha_hora_cliente: fecha.toISOString() },
      })
      red.hay = false
    }
  }
  pintarEstado()
}

async function quitarPesada(peso) {
  est.linea.pesos = est.linea.pesos.filter((p) => p.client_id !== peso.client_id)
  est.linea.gramos -= peso.gramos
  est.linea.piezas = est.linea.pesos.length
  est.pedido.gramos -= peso.gramos
  est.pedido.piezas -= 1
  pintarPesadas()

  if (peso.id) {
    await fetch(`/api/pedidos/pesos/${peso.id}/anular`, { method: 'POST' }).catch(() => {})
  } else {
    cola.quitar(peso.client_id)
  }
  pintarEstado()
}

// ---------------------------------------------------------------- cerrar

async function cerrarPedido() {
  const p = est.pedido
  try {
    const cerrado = await postear(`/api/pedidos/${p.id}/cerrar`, { operario_id: est.operario.id })
    est.ultimo = cerrado
    $('listo-titulo').textContent = 'PEDIDO LISTO'
    $('listo-kilos').textContent = `${kg(cerrado.gramos)} kg`
    $('listo-detalle').textContent =
      `${cerrado.cliente} · ${cerrado.piezas} piezas · ya lo ve el encargado`
    irA('listo')
    clearInterval(est.timer)
    est.timer = cuentaRegresiva(VENTANA_DESHACER, $('deshacer-seg'), abrirLista)
  } catch (e) {
    red.hay = false
    pintarEstado()
  }
}

// Reabrir es el deshacer de cerrar: el pedido vuelve a "en curso" y desaparece de la
// pantalla del encargado antes de que lo facture.
async function deshacerCierre() {
  clearInterval(est.timer)
  if (est.ultimo) {
    await fetch(`/api/pedidos/${est.ultimo.id}/reabrir`, { method: 'POST' }).catch(() => {})
    const id = est.ultimo.id
    est.ultimo = null
    return abrirPedido(id)
  }
  abrirLista()
}

// ---------------------------------------------------------------- pedido nuevo

async function empezarNuevo() {
  est.nuevo = { cliente: null, lineas: [] }
  irA('cliente')
  try {
    const clientes = await (await fetch('/api/clientes')).json()
    botones($('op-clientes'), clientes, (c) => {
      est.nuevo.cliente = c
      irA('nuevo-queso')
      pintarPieNuevo()
    })
  } catch {
    red.hay = false
    pintarEstado()
    $('op-clientes').replaceChildren(aviso('Sin conexión: no se puede cargar la lista de clientes.'))
  }
}

function pintarQuesosNuevo(quesos) {
  const cont = $('op-quesos-nuevo')
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
      est.quesoNuevo = q
      est.cantStr = ''
      $('titulo-nuevo-cant').textContent = `${q.nombre} · ¿cuántas piezas?`
      pintarCant()
      irA('nuevo-cant')
    })
    grilla.querySelectorAll('.opcion').forEach((b) => b.classList.add('chica'))
    grupo.append(h, grilla)
    cont.append(grupo)
  }
}

function pintarCant() {
  const v = $('cant-valor')
  v.textContent = est.cantStr || '0'
  v.classList.toggle('vacio', !est.cantStr)
  $('tecla-cant-ok').disabled = !Number(est.cantStr)
}

function teclaCant(valor) {
  if (valor === 'borrar') est.cantStr = est.cantStr.slice(0, -1)
  else if (est.cantStr.length < 3) est.cantStr = (est.cantStr + valor).replace(/^0+/, '')
  pintarCant()
}

function agregarLineaNueva() {
  const cantidad = Number(est.cantStr)
  if (!cantidad) return
  est.nuevo.lineas.push({ tipo_queso_id: est.quesoNuevo.id, cantidad_pedida: cantidad, queso: est.quesoNuevo.nombre })
  pintarPieNuevo()
  irA('nuevo-queso')
}

function pintarPieNuevo() {
  const n = est.nuevo?.lineas.length ?? 0
  $('pie-nuevo').hidden = n === 0
  $('nuevo-lineas').textContent = n
}

async function crearPedido() {
  const cuerpo = {
    client_id: crypto.randomUUID(),
    cliente_id: est.nuevo.cliente.id,
    origen: 'tablet',
    lineas: est.nuevo.lineas.map(({ tipo_queso_id, cantidad_pedida }) => ({ tipo_queso_id, cantidad_pedida })),
  }
  try {
    const p = await postear('/api/pedidos', cuerpo)
    est.nuevo = null
    est.pedido = p
    pintarArmado()
  } catch {
    red.hay = false
    pintarEstado()
  }
}

// ---------------------------------------------------------------- teclados

function armarTeclado(nodo, alTocar, idOk, textoOk, claseOk) {
  nodo.replaceChildren()
  for (const n of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) {
    const b = document.createElement('button')
    b.className = 'tecla'
    b.textContent = n
    b.onclick = () => alTocar(n)
    nodo.append(b)
  }
  const borrar = document.createElement('button')
  borrar.className = 'tecla borrar'
  borrar.textContent = '⌫'
  borrar.onclick = () => alTocar('borrar')

  const cero = document.createElement('button')
  cero.className = 'tecla'
  cero.textContent = '0'
  cero.onclick = () => alTocar('0')

  const ok = document.createElement('button')
  ok.className = `tecla ${claseOk}`
  ok.id = idOk
  ok.textContent = textoOk
  ok.disabled = true
  nodo.append(borrar, cero, ok)
  return ok
}

function aviso(texto) {
  const d = document.createElement('div')
  d.className = 'aviso'
  d.textContent = texto
  return d
}

// ---------------------------------------------------------------- arranque

const catalogo = await cargarCatalogo('pedidos')

botones($('op-operarios'), catalogo.operarios, (o) => {
  est.operario = o
  abrirLista()
})
pintarQuesosNuevo(catalogo.quesos)

armarTeclado($('teclado-peso'), teclaPeso, 'tecla-agregar', 'AGREGAR', 'agregar').onclick = agregarPeso
armarTeclado($('teclado-cant'), teclaCant, 'tecla-cant-ok', 'LISTO', 'ok').onclick = agregarLineaNueva

$('btn-nuevo').addEventListener('click', empezarNuevo)
$('btn-cerrar').addEventListener('click', cerrarPedido)
$('btn-crear').addEventListener('click', crearPedido)
$('btn-deshacer').addEventListener('click', deshacerCierre)
$('btn-seguir').addEventListener('click', () => {
  clearInterval(est.timer)
  abrirLista()
})
$('btn-volver').addEventListener('click', volver)
$('btn-reiniciar').addEventListener('click', () => {
  est.operario = null
  irA('operario')
})
red.alCambiar = () => {}

irA('operario')
pintarEstado()
await sincronizar()
registrarSW()
