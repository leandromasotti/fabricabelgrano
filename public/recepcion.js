// Recepción de leche cruda. El inicio real del circuito: hasta ahora el sistema sabía
// cuántas piezas salían, pero no de cuánta leche entró.
//
// El caudalímetro imprime un ticket y alguien lo tipea — no tiene salida de datos
// todavía, la fábrica está trabajando en automatizarlo. Por eso esta pantalla está
// hecha para copiar el ticket rápido: los pasos van en el MISMO ORDEN en que salen
// impresos (tambo, litros, temperatura), así se copia de arriba a abajo sin buscar.
//
// La temperatura se carga como en la balanza de pedidos: dígitos desde la derecha, sin
// tecla de coma. Teclear 1-2-3 da 12,3 °C. No existe el error de correr el decimal.

import {
  $, hhmm, cola, red, horaServidor, pintarEstado, postear, sincronizar,
  cargarCatalogo, botones, hacerPasos, pintarMigas, cuentaRegresiva, registrarSW,
} from '/comun.js'

const VENTANA_DESHACER = 60
// La leche debe llegar fría. Por encima de esto se resalta: es un control de calidad,
// no un dato decorativo. Umbral provisorio — falta el límite real de la fábrica.
const TEMP_ALTA = 8

const est = {
  operario: null, tambo: null,
  litrosStr: '', tempStr: '',
  ultimo: null, timer: null,
}

const mostrar = hacerPasos(
  ['operario', 'tambo', 'litros', 'temperatura', 'listo'],
  ['litros', 'temperatura']
)

const gradosDe = (str) => (Number(str || '0') / 10).toFixed(1).replace('.', ',')

function irA(paso) {
  mostrar(paso)
  $('btn-reiniciar').hidden = paso !== 'tambo'
  $('btn-volver').hidden = !['litros', 'temperatura'].includes(paso)
  pintarMigas([est.operario?.nombre, est.tambo && `Tambo ${est.tambo.numero}`])
}

function reiniciar(conservarOperario = true) {
  clearInterval(est.timer)
  est.tambo = null
  est.litrosStr = ''
  est.tempStr = ''
  if (!conservarOperario) est.operario = null
  irA(est.operario ? 'tambo' : 'operario')
}

// ---------------------------------------------------------------- teclados

function pintarLitros() {
  const v = $('litros-valor')
  v.textContent = est.litrosStr ? Number(est.litrosStr).toLocaleString('es-AR') : '0'
  v.classList.toggle('vacio', !est.litrosStr)
  $('tecla-litros').disabled = Number(est.litrosStr || 0) < 50
}

function pintarTemp() {
  const v = $('temp-valor')
  v.textContent = gradosDe(est.tempStr)
  v.classList.toggle('vacio', !est.tempStr)
  $('tecla-temp').disabled = !est.tempStr
}

function teclaLitros(valor) {
  if (valor === 'borrar') est.litrosStr = est.litrosStr.slice(0, -1)
  else if (est.litrosStr.length < 5) est.litrosStr = (est.litrosStr + valor).replace(/^0+/, '')
  pintarLitros()
}

function teclaTemp(valor) {
  // 3 dígitos = hasta 99,9 °C, de sobra. Entran desde la derecha: 1-2-3 da 12,3.
  if (valor === 'borrar') est.tempStr = est.tempStr.slice(0, -1)
  else if (est.tempStr.length < 3) est.tempStr = (est.tempStr + valor).replace(/^0+/, '')
  pintarTemp()
}

function armarTeclado(nodo, alTocar, idOk, textoOk) {
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
  ok.className = 'tecla ok'
  ok.id = idOk
  ok.textContent = textoOk
  ok.disabled = true
  nodo.append(borrar, cero, ok)
  return ok
}

// ---------------------------------------------------------------- registrar

async function registrar() {
  const litros = Number(est.litrosStr)
  const temperatura = est.tempStr ? Number(est.tempStr) / 10 : null
  if (!litros) return

  const fecha = horaServidor()
  const cuerpo = {
    client_id: crypto.randomUUID(),
    operario_id: est.operario.id,
    tambo_id: est.tambo.id,
    litros,
    temperatura,
  }
  const local = {
    ...cuerpo,
    fecha_hora: fecha.toISOString(),
    operario: est.operario.nombre,
    tambo: est.tambo.numero,
  }

  est.ultimo = local
  $('listo-litros').textContent = `${litros.toLocaleString('es-AR')} L`
  $('listo-detalle').textContent =
    `Tambo ${local.tambo}` + (temperatura != null ? ` · ${gradosDe(est.tempStr)} °C` : '')
  irA('listo')
  clearInterval(est.timer)
  est.timer = cuentaRegresiva(VENTANA_DESHACER, $('deshacer-seg'), reiniciar)
  agregarFila(local, true)

  try {
    if (!red.hay) throw new Error('sin red')
    const guardado = await postear('/api/recepciones', cuerpo)
    est.ultimo.id = guardado.id
    refrescarHoy()
  } catch (e) {
    if (e.definitivo) {
      $('listo-detalle').textContent = e.detalle?.error ?? 'No se pudo registrar'
      est.ultimo = null
    } else {
      cola.agregar({
        ruta: '/api/recepciones',
        cuerpo: { ...cuerpo, fecha_hora_cliente: fecha.toISOString() },
      })
      red.hay = false
    }
  }
  pintarEstado()
}

async function deshacer() {
  clearInterval(est.timer)
  const u = est.ultimo
  if (!u) return reiniciar()
  if (u.id) {
    await fetch(`/api/recepciones/${u.id}/anular`, { method: 'POST' }).catch(() => {})
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
  const temp = r.temperatura != null
    ? ` · ${r.temperatura.toFixed(1).replace('.', ',')} °C`
    : ''
  el.querySelector('.q').textContent =
    `Tambo ${r.tambo} · ${r.litros.toLocaleString('es-AR')} L${temp}`
  // La leche que llegó caliente se marca: es lo único de esta pantalla que alguien
  // tiene que mirar dos veces.
  if (r.temperatura != null && r.temperatura > TEMP_ALTA) {
    el.querySelector('.q').style.color = 'var(--alerta)'
  }
  el.querySelector('.op').textContent = r.operario
  return el
}

function agregarFila(r, pendiente) {
  $('lista-hoy').prepend(fila(r, pendiente))
  $('entregas-hoy').textContent = Number($('entregas-hoy').textContent) + 1
  $('litros-hoy').textContent =
    (Number($('litros-hoy').textContent.replace(/\./g, '')) + r.litros).toLocaleString('es-AR')
}

async function refrescarHoy() {
  if (!red.hay) return
  try {
    const { recepciones, entregas, litros } = await (await fetch('/api/recepciones')).json()
    $('entregas-hoy').textContent = entregas
    $('litros-hoy').textContent = litros.toLocaleString('es-AR')
    $('lista-hoy').replaceChildren(...recepciones.slice(0, 20).map((r) => fila(r)))
  } catch {
    red.hay = false
    pintarEstado()
  }
}

// ---------------------------------------------------------------- arranque

const catalogo = await cargarCatalogo('recepcion')
const tambos = await (await fetch('/api/tambos')).json().catch(() => [])

botones($('op-operarios'), catalogo.operarios, (o) => {
  est.operario = o
  irA('tambo')
})
botones($('op-tambos'), tambos, (t) => {
  est.tambo = t
  est.litrosStr = ''
  pintarLitros()
  irA('litros')
}, (t) => (t.nombre ? `${t.numero} · ${t.nombre}` : String(t.numero)))

armarTeclado($('teclado-litros'), teclaLitros, 'tecla-litros', 'SIGUE').onclick = () => {
  est.tempStr = ''
  pintarTemp()
  irA('temperatura')
}
armarTeclado($('teclado-temp'), teclaTemp, 'tecla-temp', 'LISTO').onclick = registrar

$('btn-deshacer').addEventListener('click', deshacer)
$('btn-seguir').addEventListener('click', () => {
  clearInterval(est.timer)
  reiniciar()
})
$('btn-volver').addEventListener('click', () => irA(est.tempStr !== '' ? 'litros' : 'tambo'))
$('btn-reiniciar').addEventListener('click', () => reiniciar(false))
red.alCambiar = refrescarHoy

irA('operario')
pintarEstado()
await sincronizar()
await refrescarHoy()
registrarSW()
