// Lecheria: registrar cada pallet armado, por marca y tipo de leche.
// Es el sector mas simple del circuito y por eso es el piloto: el proceso ya esta
// estandarizado en papel ("precario pero bastante aceitado" [A2 00:21]).

import {
  $, hhmm, cola, red, horaServidor, pintarEstado, postear, sincronizar,
  cargarCatalogo, botones, hacerPasos, pintarMigas, cuentaRegresiva, registrarSW,
} from '/comun.js'

const VENTANA_DESHACER = 60

const est = { operario: null, marca: null, producto: null, envase: null, ultimo: null, timer: null }
// El paso de envase tiene 3 opciones: entra sin ocultar el historial.
// 'ajustar' va a pantalla completa: el teclado numerico no entra junto con el
// historial, y ademas es un momento de foco — se esta corrigiendo un numero.
const mostrar = hacerPasos(
  ['operario', 'marca', 'producto', 'envase', 'listo', 'ajustar'],
  ['ajustar']
)

function irA(paso) {
  mostrar(paso)
  $('btn-reiniciar').hidden = paso === 'operario'
  pintarMigas([est.operario?.nombre, est.marca?.nombre, est.producto?.nombre, est.envase?.nombre])
}

function reiniciar(conservarOperario = true) {
  clearInterval(est.timer)
  est.marca = null
  est.producto = null
  est.envase = null
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
    envase_id: est.envase.id,
  }
  const local = {
    ...cuerpo,
    fecha_hora: fecha.toISOString(),
    operario: est.operario.nombre,
    marca: est.marca.nombre,
    producto: est.producto.nombre,
    envase: est.envase.nombre,
    // Lo que el formato dice que entra. Si el pallet no fue completo se corrige desde
    // la misma pantalla de confirmacion, sin volver a empezar.
    bultos: est.envase.bultos_por_pallet ?? null,
    unidades_por_bulto: est.envase.unidades_por_bulto ?? null,
    litros: est.envase.litros_por_pallet,
  }

  // Optimista: el operario ve la confirmacion ya. Que el POST llegue o se encole es
  // problema nuestro, no suyo - el ya solto el pallet y agarro el siguiente.
  est.ultimo = local
  $('listo-hora').textContent = hhmm(fecha)
  // Los litros se muestran si el formato los tiene cargados. Si es uno todavía sin
  // números, el pallet se registra igual y no se inventa nada.
  pintarConfirmacion()
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

// ---------------------------------------------------------------- pallet incompleto

// "A lo ultimo de la produccion puede suceder que pidan un pallet con 20 cajones
// solamente, o 15 cajones por 18 unidades. Pasa pocas veces al dia." [Alexis, 16/9]
//
// Por eso NO es un paso del flujo: el 99% de los pallets son completos y pagarian un
// toque de mas por el 1% que no lo es. Se registra el pallet completo y, si no lo fue,
// se corrige desde la misma confirmacion, dentro de la ventana que ya existe.

const ajuste = { campo: 'bultos', valor: '' }

function pintarConfirmacion() {
  const u = est.ultimo
  if (!u) return
  const partes = [u.marca, u.producto, u.envase]
  // "40 × 18" solo aparece cuando se sabe; si el formato esta a confirmar no se
  // inventa nada, igual que con los litros.
  if (u.bultos && u.unidades_por_bulto) partes.push(`${u.bultos} × ${u.unidades_por_bulto}`)
  if (u.litros) partes.push(`${u.litros.toLocaleString('es-AR')} L`)
  $('listo-detalle').textContent = partes.join(' · ')
  // Sin formato cargado no hay nada que ajustar: no se sabe cuanto es "completo".
  $('btn-ajustar').hidden = !u.bultos
}

function litrosDe(bultos, unidades) {
  const l = est.envase?.litros_por_unidad
  if (!bultos || !unidades || !l) return null
  return Math.round(bultos * unidades * l)
}

function pintarAjuste() {
  const esBultos = ajuste.campo === 'bultos'
  const u = est.ultimo
  $('ajustar-pregunta').textContent = esBultos
    ? '¿Cuántos bultos entraron?'
    : '¿Cuántas unidades por bulto?'
  const v = $('ajustar-valor')
  v.textContent = ajuste.valor || '0'
  v.classList.toggle('vacio', !ajuste.valor)
  $('ajustar-unidad').textContent = esBultos ? 'bultos' : 'unidades c/u'
  $('btn-cambiar-campo').textContent = esBultos
    ? `Cambiar unidades por bulto (${u.unidades_por_bulto ?? '?'})`
    : `Cambiar cantidad de bultos (${u.bultos ?? '?'})`

  const n = Number(ajuste.valor)
  const bultos = esBultos ? n : u.bultos
  const unidades = esBultos ? u.unidades_por_bulto : n
  const litros = litrosDe(bultos, unidades)
  $('ajustar-equivale').textContent =
    n >= 1 && litros ? `${bultos} × ${unidades} = ${litros.toLocaleString('es-AR')} L` : ''
  $('ajustar-ok').disabled = !(n >= 1)
}

function teclaAjuste(valor) {
  if (valor === 'borrar') ajuste.valor = ajuste.valor.slice(0, -1)
  else if (ajuste.valor.length < 3) ajuste.valor = (ajuste.valor + valor).replace(/^0+/, '')
  pintarAjuste()
}

function armarTecladoAjuste() {
  const t = $('ajustar-teclado')
  t.replaceChildren()
  for (const n of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) {
    const b = document.createElement('button')
    b.className = 'tecla'
    b.textContent = n
    b.onclick = () => teclaAjuste(n)
    t.append(b)
  }
  const borrar = document.createElement('button')
  borrar.className = 'tecla borrar'
  borrar.textContent = '⌫'
  borrar.onclick = () => teclaAjuste('borrar')

  const cero = document.createElement('button')
  cero.className = 'tecla'
  cero.textContent = '0'
  cero.onclick = () => teclaAjuste('0')

  const ok = document.createElement('button')
  ok.className = 'tecla ok'
  ok.id = 'ajustar-ok'
  ok.textContent = 'LISTO'
  ok.disabled = true
  ok.onclick = confirmarAjuste

  t.append(borrar, cero, ok)
}

function abrirAjuste(campo) {
  // Se congela la cuenta regresiva: con el teclado abierto, que el DESHACER venza
  // debajo dejaria la correccion a medias y sin manera de completarla.
  clearInterval(est.timer)
  ajuste.campo = campo
  ajuste.valor = ''
  pintarAjuste()
  irA('ajustar')
}

async function confirmarAjuste() {
  const n = Number(ajuste.valor)
  if (!(n >= 1)) return
  const u = est.ultimo
  const cambios =
    ajuste.campo === 'bultos' ? { bultos: n } : { unidades_por_bulto: n }

  Object.assign(u, cambios)
  u.litros = litrosDe(u.bultos, u.unidades_por_bulto)
  pintarConfirmacion()
  actualizarFila(u)
  irA('listo')
  est.timer = cuentaRegresiva(VENTANA_DESHACER, $('deshacer-seg'), reiniciar)

  // Si el alta todavia esta en la cola, se corrige ahi y viaja una sola vez ya
  // correcta. Si ya viajo, se manda la correccion por client_id.
  if (cola.actualizar(u.client_id, cambios)) return
  try {
    await fetch('/api/registros/cantidades', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: u.client_id, ...cambios }),
    })
    refrescarHoy()
  } catch {
    red.hay = false
    pintarEstado()
  }
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
  el.dataset.clientId = r.client_id ?? ''
  el.innerHTML = '<span class="h"></span><span class="q"></span><span class="op"></span>'
  el.querySelector('.h').textContent = hhmm(r.fecha_hora)
  // El "15 × 18" solo se muestra cuando el pallet NO fue el formato completo: ponerlo
  // en todas las filas convierte en ruido lo que justamente hay que poder distinguir.
  const incompleto =
    r.bultos && r.bultos_formato && r.bultos !== r.bultos_formato
      ? ` · ${r.bultos} × ${r.unidades_por_bulto}`
      : ''
  el.querySelector('.q').textContent =
    `${r.marca} · ${r.producto}` + (r.envase ? ` · ${r.envase}` : '') + incompleto
  el.querySelector('.op').textContent = r.operario
  return el
}

function agregarFila(r, pendiente) {
  $('lista-hoy').prepend(fila(r, pendiente))
  $('total-hoy').textContent = Number($('total-hoy').textContent) + 1
}

// Repinta la fila del pallet que se acaba de corregir, sin esperar al refresco: el
// operario tiene que ver en la lista lo mismo que acaba de confirmar en pantalla.
function actualizarFila(r) {
  const vieja = $('lista-hoy').querySelector(`[data-client-id="${r.client_id}"]`)
  if (vieja) vieja.replaceWith(fila({ ...r, bultos_formato: est.envase?.bultos_por_pallet }, true))
}

async function refrescarHoy() {
  if (!red.hay) return
  try {
    const { registros, total, litros } = await (await fetch('/api/registros')).json()
    $('total-hoy').textContent = total
    $('litros-hoy').textContent = (litros ?? 0).toLocaleString('es-AR')
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
  irA('envase')
})
// El envase define los litros del pallet. Los que todavía no tienen los números
// cargados se marcan, para que el operario sepa que ese formato está a confirmar.
botones($('op-envases'), catalogo.envases, (e) => {
  est.envase = e
  registrar()
}, (e) => {
  const partes = [document.createTextNode(e.nombre)]
  const chico = document.createElement('small')
  chico.style.cssText = 'display:block;font-size:15px;font-weight:600;opacity:.65;margin-top:6px'
  chico.textContent = e.litros_por_pallet
    ? `${e.litros_por_pallet.toLocaleString('es-AR')} litros`
    : 'litros a confirmar'
  partes.push(chico)
  return partes
})

armarTecladoAjuste()
$('btn-ajustar').addEventListener('click', () => abrirAjuste('bultos'))
$('btn-cambiar-campo').addEventListener('click', () =>
  abrirAjuste(ajuste.campo === 'bultos' ? 'unidades' : 'bultos')
)
$('btn-ajustar-cancelar').addEventListener('click', () => {
  irA('listo')
  est.timer = cuentaRegresiva(VENTANA_DESHACER, $('deshacer-seg'), reiniciar)
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
