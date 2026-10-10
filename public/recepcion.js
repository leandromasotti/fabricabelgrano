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
  configurarVuelta,
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
  // OJO: `ultimo` y `ultimoDelDia` NO son lo mismo, y confundirlos ya rompio algo.
  //
  //   ultimo       la entrega que acaba de registrar ESTA tablet. Lleva client_id, y de
  //                ahi dependen el DESHACER y la observacion.
  //   ultimoDelDia la ultima del dia segun el servidor, que puede ser de otra tablet y
  //                NO trae client_id. Es solo para mostrarla en la franja.
  //
  // Al agregar la franja, refrescarHoy pisaba `ultimo` con la fila del servidor y la
  // observacion salia sin client_id: el servidor la rechazaba con 400 y la nota se
  // perdia en silencio.
  ultimoDelDia: null,
  // De que dia se esta cargando. null = hoy, que es el caso normal.
  //
  // Persiste entre cargas A PROPOSITO: el lunes se cargan varias entregas del sabado
  // seguidas, y volver a elegir el dia en cada una seria la definicion de engorroso.
  // El precio de que persista es que hay que gritarlo, y por eso el boton cambia de
  // color mientras no sea hoy.
  dia: null,
  // Lo que ya entro hoy, por numero de tambo. Se usa para marcar los botones.
  cargadoHoy: new Map(),
}

// La lista de pasos, UNA sola vez. Estaba escrita en tres lugares y al agregar el paso
// de fecha hubo que acordarse de los tres: justo el tipo de duplicado que se
// desincroniza sin avisar.
const PASOS = ['operario', 'tambo', 'fecha', 'litros', 'temperatura', 'listo', 'observacion', 'nota']

// A dónde vuelve cada paso. Explícito y no deducido del estado: antes el botón miraba si
// había una temperatura tecleada para adivinar dónde estaba parado, y fallaba en los dos
// sentidos —desde temperatura sin teclear nada se saltaba los litros, y desde litros con
// una temperatura previa no hacía nada—. Reportado desde la planta el 2026-10-10.
const PASO_ANTERIOR = {
  fecha: 'tambo',
  litros: 'tambo',
  temperatura: 'litros',
}

const mostrar = hacerPasos(PASOS, ['litros', 'temperatura', 'observacion', 'nota'])

const pasoActual = () => PASOS.find((p) => !$(`paso-${p}`).hidden)

const gradosDe = (str) => (Number(str || '0') / 10).toFixed(1).replace('.', ',')

function irA(paso) {
  mostrar(paso)
  $('btn-reiniciar').hidden = paso !== 'tambo'
  $('btn-volver').hidden = !['fecha', 'litros', 'temperatura', 'observacion', 'nota'].includes(paso)
  pintarMigas([
    est.operario?.nombre,
    // El dia distinto de hoy tambien va en las migas: es parte de que se esta cargando.
    est.dia && diaCorto(est.dia),
    est.tambo && `Tambo ${est.tambo.numero}`,
  ])
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

// ---------------------------------------------------------------- el dia y lo cargado
//
// Dos cosas que esta pantalla no tenia y la hacian dificil de usar de verdad:
//
//   1. De que DIA se esta cargando. Los tambos entregan el fin de semana y el camion
//      trae la leche, pero el laboratorio la pasa el lunes. Sin esto, la leche del
//      sabado cuenta como del lunes y la liquidacion al tambo sale mal.
//
//   2. QUE SE CARGO YA. "Justo estan cargando los litros y hay que ir a cambiar una
//      canilla; lo mas probable es que se olviden por que tambo iban y lo carguen de
//      nuevo o se lo salteen."
//
// Lo segundo se resuelve en los dos lados: el ultimo cargado arriba, y una marca en el
// boton de cada tambo que ya entro. Con la marca no hay nada que recordar.

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

// Fecha local de la tablet, no UTC: la tablet esta EN la fabrica, asi que su dia es el
// dia de la fabrica. `toISOString()` daria el dia de Greenwich y de madrugada se corre.
const isoLocal = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const diaCorto = (iso) => {
  const d = new Date(`${iso}T12:00:00`)
  return `${DIAS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`
}

function pintarFecha() {
  const b = $('btn-fecha')
  b.textContent = est.dia ? diaCorto(est.dia) : 'Hoy'
  b.classList.toggle('otro-dia', Boolean(est.dia))
}

function pintarUltimo() {
  const u = $('ultimo-cargado')
  const n = est.cargadoHoy.size
  const ult = est.ultimoDelDia
  if (!ult) {
    u.textContent = n ? `${n} tambo${n === 1 ? '' : 's'} cargados hoy` : 'Todavía no se cargó ningún tambo hoy'
    return
  }
  u.replaceChildren()
  const f = document.createElement('strong')
  f.textContent = `Último: Tambo ${ult.tambo} · ${Number(ult.litros).toLocaleString('es-AR')} L`
  u.append(f, document.createTextNode(` · ${hhmm(ult.fecha_hora)}`))
}

// Los botones de tambo se repintan despues de cada carga para que la marca este al dia.
function pintarTambos() {
  botones($('op-tambos'), tambos, (t) => {
    est.tambo = t
    est.litrosStr = ''
    pintarLitros()
    irA('litros')
  }, (t) => {
    const partes = [document.createTextNode(t.nombre ? `${t.numero} · ${t.nombre}` : String(t.numero))]
    const ya = est.cargadoHoy.get(t.numero)
    if (ya) {
      const marca = document.createElement('span')
      marca.className = 'ya-cargado'
      marca.textContent = `✓ ${ya.litros.toLocaleString('es-AR')} L${ya.veces > 1 ? ` · ${ya.veces} entregas` : ''}`
      partes.push(marca)
    }
    return partes
  })
}

// Los ultimos siete dias. Alcanza para el fin de semana largo y evita un calendario.
function pintarFechas() {
  const hoy = new Date()
  const opciones = [{ iso: null, nombre: 'Hoy' }]
  for (let i = 1; i <= 6; i++) {
    const d = new Date(hoy)
    d.setDate(d.getDate() - i)
    opciones.push({ iso: isoLocal(d), nombre: i === 1 ? `Ayer · ${diaCorto(isoLocal(d))}` : diaCorto(isoLocal(d)) })
  }
  botones($('op-fechas'), opciones, (o) => {
    est.dia = o.iso
    pintarFecha()
    irA('tambo')
    // Las marcas tienen que pasar a ser las de ESE día: si no, elegir el sábado dejaría
    // los tildes del lunes y el operario saltearía tambos que todavía no cargó.
    est.cargadoHoy = new Map()
    est.ultimoDelDia = null
    pintarTambos()
    pintarUltimo()
    refrescarHoy()
  }, (o) => o.nombre)
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
  // Lo mismo que SEGUIR: en recepcion el operario se conserva (ver el comentario de
  // btn-seguir). El que se va de verdad usa "Cambiar".
  est.timer = cuentaRegresiva(VENTANA_DESHACER, $('deshacer-seg'), () => reiniciar(true))
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
    // Sólo si se está cargando otro día. Va al mediodía local: lo que importa es que
    // caiga en el día correcto, y el mediodía queda lejos de cualquier borde.
    ...(est.dia ? { fecha_entrega: new Date(`${est.dia}T12:00:00`).toISOString() } : {}),
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
  // Lo mismo que SEGUIR: en recepcion el operario se conserva (ver el comentario de
  // btn-seguir). El que se va de verdad usa "Cambiar".
  est.timer = cuentaRegresiva(VENTANA_DESHACER, $('deshacer-seg'), () => reiniciar(true))
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

  // La marca del tambo y el "último" se actualizan acá y no sólo en refrescarHoy: sin
  // red refrescarHoy no corre, y sin red es justo cuando no hay otra forma de saber qué
  // se cargó ya. Es lo mismo que evita cargar dos veces el mismo tambo.
  const previo = est.cargadoHoy.get(r.tambo) ?? { litros: 0, veces: 0 }
  est.cargadoHoy.set(r.tambo, { litros: previo.litros + r.litros, veces: previo.veces + 1 })
  est.ultimoDelDia = r
  pintarTambos()
  pintarUltimo()
}

async function refrescarHoy() {
  if (!red.hay) return
  try {
    // Se pide el día que se está cargando, no siempre hoy: si el lunes se cargan las
    // entregas del sábado, lo que importa ver es qué tambos del SÁBADO ya entraron.
    const q = est.dia ? `?fecha=${est.dia}` : ''
    const { recepciones, entregas, litros } = await (await fetch(`/api/recepciones${q}`)).json()
    $('entregas-hoy').textContent = entregas
    $('litros-hoy').textContent = litros.toLocaleString('es-AR')
    $('lista-hoy').replaceChildren(...recepciones.slice(0, 20).map((r) => fila(r)))

    // Un tambo puede entregar dos veces en el mismo día, así que se acumula en vez de
    // pisarse: marcar "✓ 1.200 L" cuando entraron 1.200 + 900 escondería la segunda.
    const vivas = recepciones.filter((r) => !r.anulado)
    est.cargadoHoy = new Map()
    for (const r of vivas) {
      const previo = est.cargadoHoy.get(r.tambo) ?? { litros: 0, veces: 0 }
      est.cargadoHoy.set(r.tambo, { litros: previo.litros + r.litros, veces: previo.veces + 1 })
    }
    // `recepciones` viene ordenado por fecha_hora DESC: el primero es el último cargado.
    // Va a ultimoDelDia y NO a ultimo: esta fila viene del servidor y no trae client_id,
    // que es lo que necesitan el DESHACER y la observación.
    est.ultimoDelDia = vivas[0] ?? null
    pintarTambos()
    pintarUltimo()
  } catch {
    red.hay = false
    pintarEstado()
  }
}

// ---------------------------------------------------------------- arranque

const catalogo = await cargarCatalogo('recepcion')
configurarTablet(catalogo)
configurarVuelta()
const tambos = await (await fetch('/api/tambos')).json().catch(() => [])

botones($('op-operarios'), catalogo.operarios, (o) => {
  est.operario = o
  irA('tambo')
})
// Los motivos vienen con el catalogo, que ya se pide al arrancar: la observacion tiene
// que poder cargarse sin red, y pedir la lista justo en ese momento seria pedirla
// exactamente cuando puede no haber conexion.
botones($('op-motivos'), catalogo.motivos_recepcion ?? [], elegirMotivo)
pintarTambos()
pintarFechas()
pintarFecha()
pintarUltimo()
$('btn-fecha').addEventListener('click', () => irA('fecha'))

armarTeclado($('teclado-litros'), teclaLitros, 'tecla-litros', 'SIGUE').onclick = () => {
  est.tempStr = ''
  pintarTemp()
  irA('temperatura')
}
armarTeclado($('teclado-temp'), teclaTemp, 'tecla-temp', 'LISTO').onclick = registrar

$('btn-deshacer').addEventListener('click', deshacer)

// EXCEPCIÓN a la regla del resto de las tablets, pedida por el cliente el 1/10:
//
//   "No es como en la armada de pallets porque solo son 2 personas en laboratorio.
//    Luego de la carga, quiero que la pantalla que aparezca sean los nombres de los
//    tambos."
//
// En las demás tablets el operario se vuelve a pedir después de cada registro, porque
// son puestos compartidos y el riesgo es cargar a nombre de otro. Acá son dos personas
// y el camión descarga tambo tras tambo: volver a elegir el nombre en cada entrega
// cuesta más que el riesgo que evita.
//
// Para cambiar de operario sigue estando "Cambiar", que es lo que pasa `false`.
$('btn-seguir').addEventListener('click', () => {
  clearInterval(est.timer)
  reiniciar(true)
})
$('btn-volver').addEventListener('click', () => {
  const paso = pasoActual()
  // La observación y la nota son aparte: la entrega YA está registrada, así que volver
  // al flujo de carga daría a entender que se está rehaciendo.
  if (paso === 'nota') return irA('observacion')
  if (paso === 'observacion') return volverAConfirmacion()
  // El resto sale de la tabla, un paso para atrás y sin adivinar.
  const atras = PASO_ANTERIOR[paso]
  if (atras) irA(atras)
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
