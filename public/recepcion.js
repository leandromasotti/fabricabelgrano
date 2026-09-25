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
  cargarCatalogo, configurarTablet, botones, hacerPasos, pintarMigas, cuentaRegresiva, registrarSW,
  armarTecladoLetras,
} from '/comun.js'

const VENTANA_DESHACER = 60
// La leche debe llegar fría. Por encima de esto se resalta: es un control de calidad,
// no un dato decorativo. Umbral provisorio — falta el límite real de la fábrica.
const TEMP_ALTA = 8

const est = {
  operario: null, tambo: null,
  litrosStr: '', tempStr: '',
  ultimo: null, timer: null,
  // Lo observado de la entrega que se acaba de registrar.
  motivo: null, nota: '',
}

const mostrar = hacerPasos(
  ['operario', 'tambo', 'litros', 'temperatura', 'listo', 'observacion', 'nota'],
  ['litros', 'temperatura', 'observacion', 'nota']
)

const gradosDe = (str) => (Number(str || '0') / 10).toFixed(1).replace('.', ',')

function irA(paso) {
  mostrar(paso)
  $('btn-reiniciar').hidden = paso !== 'tambo'
  $('btn-volver').hidden = !['litros', 'temperatura', 'observacion', 'nota'].includes(paso)
  pintarMigas([est.operario?.nombre, est.tambo && `Tambo ${est.tambo.numero}`])
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

// ---------------------------------------------------------------- observacion
//
// "Puede entrar una leche del tambo y que este cortada, hoy no tenemos donde guardar esa
// informacion." [el cliente, 25/9]
//
// Son dos cosas y no una: un MOTIVO de una lista corta —que se puede contar por tambo,
// que es de donde sale el valor— y una NOTA libre para lo que no entre en la lista. El
// motivo es un toque; la nota solo aparece si alguien la pide.
//
// Todo esto va DESPUES de registrar. La leche que llega bien es la enorme mayoria y no
// puede pagar un paso extra por la excepcion.

function pintarConfirmacion() {
  const u = est.ultimo
  if (!u) return
  const partes = [`Tambo ${u.tambo}`]
  if (u.temperatura != null) partes.push(`${gradosDe(est.tempStr)} °C`)
  if (est.motivo) partes.push(est.motivo.nombre.toUpperCase())
  if (est.nota) partes.push(`"${est.nota}"`)
  $('listo-detalle').textContent = partes.join(' · ')
  // El boton cambia de texto segun si ya hay algo observado: "agregar" cuando no hay
  // nada, "cambiar" cuando si, para que no parezca que se va a duplicar.
  $('btn-observar').textContent =
    est.motivo || est.nota ? 'Cambiar la observación' : 'Agregar una observación'
}

// Manda lo observado. Por client_id, no por id: la entrega puede seguir en la cola
// offline y todavia no tener id del servidor.
async function guardarObservacion() {
  const u = est.ultimo
  if (!u) return
  const cuerpo = {
    client_id: u.client_id,
    motivo_id: est.motivo?.id ?? null,
    observacion: est.nota || null,
  }
  pintarConfirmacion()

  // Si el alta todavia esta en la cola, se corrige ahi y viaja una sola vez ya completa.
  if (cola.actualizar(u.client_id, { motivo_id: cuerpo.motivo_id, observacion: cuerpo.observacion })) {
    return
  }
  try {
    await fetch('/api/recepciones/observacion', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cuerpo),
    })
    refrescarHoy()
  } catch {
    red.hay = false
    pintarEstado()
  }
}

function abrirObservacion() {
  // Se congela la cuenta regresiva: con el teclado abierto, que el DESHACER venza por
  // debajo dejaria la observacion a medias y sin forma de terminarla.
  clearInterval(est.timer)
  irA('observacion')
}

function elegirMotivo(m) {
  est.motivo = m
  guardarObservacion()
  volverAConfirmacion()
}

function volverAConfirmacion() {
  pintarConfirmacion()
  irA('listo')
  clearInterval(est.timer)
  est.timer = cuentaRegresiva(VENTANA_DESHACER, $('deshacer-seg'), reiniciar)
}

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
  est.motivo = null
  est.nota = ''
  $('listo-litros').textContent = `${litros.toLocaleString('es-AR')} L`
  pintarConfirmacion()
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
  if (!u) return reiniciar(true)
  if (u.id) {
    await fetch(`/api/recepciones/${u.id}/anular`, { method: 'POST' }).catch(() => {})
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
configurarTablet(catalogo)
const tambos = await (await fetch('/api/tambos')).json().catch(() => [])

botones($('op-operarios'), catalogo.operarios, (o) => {
  est.operario = o
  irA('tambo')
})
// Los motivos vienen con el catalogo, que ya se pide al arrancar: la observacion tiene
// que poder cargarse sin red, y pedir la lista justo en ese momento seria pedirla
// exactamente cuando puede no haber conexion.
botones($('op-motivos'), catalogo.motivos_recepcion ?? [], elegirMotivo)
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
$('btn-volver').addEventListener('click', () => {
  // Desde la observación se vuelve a la confirmación, no al flujo de carga: la entrega
  // ya está registrada y volver a los litros daría a entender que se está rehaciendo.
  const paso = ['operario', 'tambo', 'litros', 'temperatura', 'listo', 'observacion', 'nota']
    .find((p) => !$(`paso-${p}`).hidden)
  if (paso === 'nota') return irA('observacion')
  if (paso === 'observacion') return volverAConfirmacion()
  irA(est.tempStr !== '' ? 'litros' : 'tambo')
})
$('btn-reiniciar').addEventListener('click', () => reiniciar(false))

// ---------------------------------------------------------------- observacion
$('btn-observar').addEventListener('click', abrirObservacion)
$('btn-sin-observacion').addEventListener('click', () => {
  est.motivo = null
  est.nota = ''
  guardarObservacion()
  volverAConfirmacion()
})

const tecladoNota = armarTecladoLetras($('teclado-nota'), (t) => {
  const v = $('nota-valor')
  v.textContent = t || '…'
  v.classList.toggle('vacio', !t)
  $('btn-nota-ok').disabled = false
})

$('btn-escribir').addEventListener('click', () => {
  tecladoNota.poner(est.nota)
  irA('nota')
})
$('btn-nota-ok').addEventListener('click', () => {
  est.nota = tecladoNota.texto.trim()
  guardarObservacion()
  volverAConfirmacion()
})

red.alCambiar = refrescarHoy

irA('operario')
pintarEstado()
await sincronizar()
await refrescarHoy()
registrarSW()
