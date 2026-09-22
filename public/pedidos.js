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
  cargarCatalogo, configurarTablet, botones, hacerPasos, pintarMigas, cuentaRegresiva, registrarSW,
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
  contarStr: '',
  // alta de un pedido nuevo
  nuevo: null,
  quesoNuevo: null,
  cantStr: '',
  ultimo: null,
  timer: null,
}

const PASOS = ['operario', 'lista', 'armado', 'pesaje', 'contar', 'cliente', 'nuevo-queso', 'nuevo-cant', 'listo']
const PASOS_ANCHOS = ['lista', 'armado', 'pesaje', 'contar', 'cliente', 'nuevo-queso', 'nuevo-cant']

const mostrar = hacerPasos(PASOS, PASOS_ANCHOS)

const kg = (gramos) => (gramos / 1000).toFixed(3).replace('.', ',')

function irA(paso) {
  mostrar(paso)
  $('btn-reiniciar').hidden = paso !== 'lista'
  $('btn-volver').hidden = !['armado', 'pesaje', 'contar', 'cliente', 'nuevo-queso', 'nuevo-cant'].includes(paso)
  pintarMigas([est.operario?.nombre, est.pedido?.cliente ?? est.nuevo?.cliente?.nombre, est.linea?.descripcion])
}

function volver() {
  if (['cliente', 'nuevo-queso', 'nuevo-cant'].includes(pasoActual())) {
    if (pasoActual() === 'nuevo-cant') return irA('nuevo-queso')
    est.nuevo = null
    return abrirLista()
  }
  if (['pesaje', 'contar'].includes(pasoActual())) {
    est.linea = null
    return pintarArmado()
  }
  est.pedido = null
  abrirLista()
}

const pasoActual = () => PASOS.find((p) => !$(`paso-${p}`).hidden)

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

// Como se resume un pedido en una linea. Un pedido puede ser de queso, de leche, de
// yogur o de las tres, y mostrar siempre "piezas / kg" dejaba un "0 / 0 · sin pesar"
// arriba de un pedido de leche entero.
//
// Trabaja con los totales que ya manda el servidor, no con las lineas: la lista de
// pedidos no las trae.
function resumen(p) {
  const partes = []
  const avance = []
  if (p.piezas_pedidas) {
    avance.push(`${p.piezas} / ${p.piezas_pedidas} pz`)
    partes.push(p.gramos ? `${kg(p.gramos)} kg` : 'sin pesar')
  }
  if (p.bultos_pedidos) {
    avance.push(`${p.bultos} / ${p.bultos_pedidos} bultos`)
    if (p.litros) partes.push(`${p.litros} L`)
  }
  if (p.unidades_yogur_pedidas) {
    avance.push(`${p.unidades_yogur} / ${p.unidades_yogur_pedidas} u`)
  }
  return {
    avance: avance.join(' · ') || '—',
    total: partes.join(' · ') || 'sin preparar',
  }
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
  const r = resumen(p)
  fuerte.textContent = r.avance
  meta.append(fuerte, document.createTextNode(r.total))

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
    // `entregado` en vez de `piezas`: el servidor ya resolvio si eso son piezas pesadas
    // o bultos contados, y la tablet no tiene por que volver a decidirlo.
    const completa = l.entregado === l.cantidad_pedida
    const difiere = l.entregado > 0 && l.entregado !== l.cantidad_pedida
    b.className = `linea${completa ? ' completa' : ''}${difiere ? ' difiere' : ''}`

    const queso = document.createElement('span')
    queso.className = 'queso'
    queso.textContent = l.descripcion

    const prog = document.createElement('span')
    prog.className = 'progreso'
    prog.textContent = `${l.entregado} / ${l.cantidad_pedida}`

    const kilos = document.createElement('span')
    kilos.className = 'kilos'
    kilos.textContent =
      l.clase === 'queso' ? (l.gramos ? `${kg(l.gramos)} kg` : '—')
      : l.clase === 'leche' ? (l.litros ? `${l.litros} L` : '—')
      : l.unidad

    b.append(queso, prog, kilos)
    // El queso se pesa, la leche y el yogur se cuentan. Es la unica bifurcacion del
    // flujo, y ocurre aca.
    b.onclick = () => (l.clase === 'queso' ? abrirPesaje(l) : abrirContar(l))
    return b
  }))

  // El pie muestra lo que el pedido realmente tiene. Un pedido de sola leche mostraba
  // "0 piezas · 0,000 kg", que se lee como que no se armo nada.
  //
  // Los totales se SUMAN DE LAS LINEAS y no se leen de p.gramos / p.litros. Esos dos
  // vienen del servidor y quedan viejos: las cargas optimistas actualizan la linea para
  // que el operario vea el cambio al instante, y el pie mostraba 0 L con 25 cajones ya
  // contados. Derivarlos no puede desincronizarse.
  const suma = (f) => p.lineas.reduce((n, l) => n + f(l), 0)
  const entregado = suma((l) => l.entregado)
  const gramos = suma((l) => l.gramos)
  const litros = suma((l) => l.litros)
  const soloQueso = p.lineas.every((l) => l.clase === 'queso')
  const soloLeche = p.lineas.every((l) => l.clase === 'leche')

  $('total-piezas').textContent = entregado
  $('total-piezas-u').textContent = soloQueso ? 'piezas' : soloLeche ? 'bultos' : 'preparado'

  if (soloQueso) {
    $('total-kilos').textContent = kg(gramos)
    $('total-kilos-u').textContent = 'kilos'
  } else if (soloLeche) {
    $('total-kilos').textContent = litros || '—'
    $('total-kilos-u').textContent = 'litros'
  } else {
    // Mixto: sumar kilos de queso con litros de leche no da nada, asi que se muestran
    // los dos por separado en vez de un total inventado.
    $('total-kilos').textContent = `${kg(gramos)} kg · ${litros} L`
    $('total-kilos-u').textContent = 'queso · leche'
  }

  $('btn-cerrar').disabled = entregado === 0
}

// ---------------------------------------------------------------- pesaje

function abrirPesaje(linea) {
  est.linea = linea
  est.gramosStr = ''
  irA('pesaje')
  $('titulo-pesaje').textContent = `${linea.descripcion} · pedidas ${linea.cantidad_pedida}`
  $('pesadas-pedidas').textContent = linea.cantidad_pedida
  pintarPeso()
  pintarPesadas()
}

// ---------------------------------------------------------------- contar
//
// Leche y yogur no pasan por balanza: un carton de 1 L es 1 L. Lo que puede variar es
// cuantos bultos se llegaron a preparar, que es el caso que describio el cliente —"a lo
// ultimo de la produccion puede pedir un pallet con 20 cajones solamente"—.
//
// Es el mismo teclado numerico que el resto del sistema, pero SIN la entrada por la
// derecha del pesaje: ahi los digitos entran como en una balanza porque hay decimales.
// Un cajon no tiene medio cajon, asi que aca se teclea derecho.

function abrirContar(linea) {
  est.linea = linea
  est.contarStr = ''
  irA('contar')
  $('titulo-contar').textContent = `${linea.descripcion} · pedidos ${linea.cantidad_pedida}`
  $('contar-unidad').textContent = linea.unidad
  $('contar-pedidas').textContent = linea.cantidad_pedida
  pintarCantidad()
  pintarCargas()
}

function pintarCantidad() {
  const n = Number(est.contarStr || '0')
  const v = $('contar-valor')
  v.textContent = n
  v.classList.toggle('cero', n === 0)
  $('tecla-contar-ok').disabled = n < 1

  // Los litros mientras se teclea, igual que en lecheria: es donde todavia se puede
  // notar que 400 cajones eran 40.
  const l = est.linea
  const porBulto = (l.unidades_por_bulto ?? 0) * Number(l.litros_por_unidad ?? 0)
  $('linea-litros').textContent =
    l.clase === 'leche' && porBulto ? `${Math.round(n * porBulto)} L` : ''
}

function teclaContar(valor) {
  if (valor === 'borrar') est.contarStr = est.contarStr.slice(0, -1)
  // 5 digitos: nadie prepara 100.000 cajones. El tope esta para que un dedo trabado no
  // cargue un numero absurdo, igual que en el pesaje.
  else if (est.contarStr.length < 5) est.contarStr = (est.contarStr + valor).replace(/^0+/, '')
  pintarCantidad()
}

function pintarCargas() {
  const l = est.linea
  $('contar-n').textContent = l.entregado

  $('lista-cargas').replaceChildren(...l.cantidades.map((c, i) => {
    const d = document.createElement('div')
    d.className = 'pesada'
    const idx = document.createElement('span')
    idx.className = 'i'
    idx.textContent = `${i + 1}.`
    const val = document.createElement('span')
    val.className = 'kg'
    val.textContent = `${c.cantidad} ${l.unidad}`
    const x = document.createElement('button')
    x.textContent = '✕'
    x.title = 'Quitar esta carga'
    x.onclick = () => quitarCarga(c)
    d.append(idx, val, x)
    return d
  }).reverse())
}

async function agregarCantidad() {
  const cantidad = Number(est.contarStr || '0')
  if (cantidad < 1) return

  const fecha = horaServidor()
  const cuerpo = { client_id: crypto.randomUUID(), linea_id: est.linea.id, cantidad }

  // Optimista, igual que el pesaje: el operario ya movio los cajones.
  est.linea.cantidades.push({ id: null, client_id: cuerpo.client_id, cantidad })
  est.linea.entregado += cantidad
  const porBulto = (est.linea.unidades_por_bulto ?? 0) * Number(est.linea.litros_por_unidad ?? 0)
  if (est.linea.clase === 'leche') est.linea.litros += Math.round(cantidad * porBulto)
  est.contarStr = ''
  pintarCantidad()
  pintarCargas()

  try {
    if (!red.hay) throw new Error('sin red')
    const r = await postear('/api/pedidos/cantidades', cuerpo)
    const guardada = est.linea.cantidades.find((c) => c.client_id === cuerpo.client_id)
    if (guardada) guardada.id = r.id
  } catch (e) {
    if (!e.definitivo) {
      cola.agregar({
        ruta: '/api/pedidos/cantidades',
        cuerpo: { ...cuerpo, fecha_hora_cliente: fecha.toISOString() },
      })
      red.hay = false
    }
  }
  pintarEstado()
}

async function quitarCarga(carga) {
  est.linea.cantidades = est.linea.cantidades.filter((c) => c.client_id !== carga.client_id)
  est.linea.entregado -= carga.cantidad
  const porBulto = (est.linea.unidades_por_bulto ?? 0) * Number(est.linea.litros_por_unidad ?? 0)
  if (est.linea.clase === 'leche') est.linea.litros -= Math.round(carga.cantidad * porBulto)
  pintarCargas()

  if (carga.id) {
    await fetch(`/api/pedidos/cantidades/${carga.id}/anular`, { method: 'POST' }).catch(() => {})
  } else {
    cola.quitar(carga.client_id)
  }
  pintarEstado()
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
    const r = resumen(cerrado)
    $('listo-titulo').textContent = 'PEDIDO LISTO'
    $('listo-kilos').textContent = r.total
    $('listo-detalle').textContent = `${cerrado.cliente} · ${r.avance} · ya lo ve el encargado`
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
  // Ojo: `cant-valor` es el del alta de pedido nuevo; el del conteo de leche es
  // `contar-valor`. Son dos pantallas distintas y llegaron a tener el mismo id.
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
configurarTablet(catalogo)

botones($('op-operarios'), catalogo.operarios, (o) => {
  est.operario = o
  abrirLista()
})
pintarQuesosNuevo(catalogo.quesos)

armarTeclado($('teclado-peso'), teclaPeso, 'tecla-agregar', 'AGREGAR', 'agregar').onclick = agregarPeso
armarTeclado($('teclado-cant'), teclaCant, 'tecla-cant-ok', 'LISTO', 'ok').onclick = agregarLineaNueva
armarTeclado($('teclado-contar'), teclaContar, 'tecla-contar-ok', 'AGREGAR', 'agregar').onclick = agregarCantidad

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
