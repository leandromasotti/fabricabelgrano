// Recepción de leche cruda, en planilla.
//
// PARA QUE EXISTE, Y POR QUE NO REEMPLAZA A /recepcion.html TODAVIA
//
// El puesto de laboratorio copia de 6 a 10 entregas seguidas de un ticket. Un asistente
// —un paso por pantalla— es lo correcto cuando se registra UNA cosa y se vuelve al
// trabajo, como en lecheria; acá es al reves: lo que hace falta es ver el conjunto, cual
// falta y cuanto va. Pedido por el cliente el 2026-10-10.
//
// Va como pantalla NUEVA y no cambiando la que existe porque la vieja se esta usando
// todos los dias para probar: si esta sale mal, nadie se queda sin la que funciona.
//
// QUE SE CONSERVA de la pantalla original, a proposito:
//   - la temperatura, que esta cargada en el 100% de las entregas
//   - las observaciones (cortada, con olor) con su lista de motivos
//   - el dia de la entrega, para la leche del fin de semana
//   - la cola offline y el client_id que la hace idempotente

import {
  $, hhmm, cola, red, horaServidor, pintarEstado, postear, sincronizar,
  cargarCatalogo, configurarTablet, botones, hacerPasos, pintarMigas, registrarSW,
  configurarVuelta, armarTecladoLetras,
} from '/comun.js'

const TOPE_DIAS_ATRAS = 30
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

const est = {
  operario: null,
  dia: null, // null = hoy
  planilla: null, // lo que devolvio el servidor
  // La celda abierta: que tambo, que entrega (null = nueva) y lo que se esta tecleando.
  edicion: null,
  campo: 'litros',
  litrosStr: '',
  tempStr: '',
  motivo: null,
  nota: '',
}

// Como se nombra un tambo en pantalla. El numero primero: es la clave con la que la
// fabrica los conoce y lo que dice el remito.
const comoSeLlama = (t) => `${t.numero}${t.nombre ? ` · ${t.nombre}` : ''}`

const PASOS = ['operario', 'planilla', 'carga', 'fecha', 'ocasional', 'observacion', 'nota']
const PASO_ANTERIOR = {
  carga: 'planilla',
  fecha: 'planilla',
  ocasional: 'planilla',
}

const mostrar = hacerPasos(PASOS, ['carga', 'fecha', 'ocasional', 'observacion', 'nota'])
const pasoActual = () => PASOS.find((p) => !$(`paso-${p}`).hidden)

const num = (n) => Number(n ?? 0).toLocaleString('es-AR')
const gradosDe = (str) => (Number(str || '0') / 10).toFixed(1).replace('.', ',')

const isoLocal = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const diaCorto = (iso) => {
  const d = new Date(`${iso}T12:00:00`)
  return `${DIAS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`
}

function irA(paso) {
  mostrar(paso)
  $('btn-reiniciar').hidden = paso !== 'planilla'
  $('btn-volver').hidden = !PASO_ANTERIOR[paso] && !['observacion', 'nota'].includes(paso)
  pintarMigas([
    est.operario?.nombre,
    est.dia && diaCorto(est.dia),
    est.edicion && `Tambo ${est.edicion.tambo.numero}`,
  ])
}

// ---------------------------------------------------------------- la planilla

async function traerPlanilla() {
  if (!red.hay) return
  try {
    const q = est.dia ? `?fecha=${est.dia}` : ''
    est.planilla = await (await fetch(`/api/recepciones/planilla${q}`)).json()
    red.hay = true
  } catch {
    red.hay = false
    pintarEstado()
    return
  }
  pintarPlanilla()
  pintarEstado()
}

// Una fila por tambo: el semaforo, el nombre y una celda por entrega.
//
// Van los HABITUALES —los de todos los dias— mas cualquiera que hoy tenga algo cargado.
// Lo segundo importa: un excepcional que se sumo desde "Otros tambos" tiene que seguir
// viendose el resto del dia, igual que uno dado de baja que entrego antes de darse.
function filasVisibles() {
  return (est.planilla?.tambos ?? []).filter(
    (t) => (t.activo && !t.ocasional) || t.entregas.length,
  )
}

function pintarPlanilla() {
  const cont = $('planilla')
  const filas = filasVisibles()

  // Cuantas celdas tiene CADA fila: las entregas que ya hay mas una para la siguiente.
  // Dos de base —una segunda entrega pasa como mucho una vez por dia— y crece sola si
  // algun tambo trajo mas. Todas las filas usan el mismo numero para que las columnas
  // queden alineadas; de eso vive la lectura de una planilla.
  const slots = Math.max(2, ...filas.map((t) => t.entregas.length + 1))

  cont.replaceChildren(...filas.map((t) => {
    const fila = document.createElement('div')
    const cargado = t.entregas.length > 0
    // Rojo SOLO si se esperaba: ver el comentario del semaforo en styles.css.
    const falta = !cargado && t.habitual && t.activo
    fila.className = `fila-tambo${cargado ? ' cargado' : ''}${falta ? ' falta' : ''}`

    const quien = document.createElement('div')
    quien.className = 'quien'
    const luz = document.createElement('span')
    luz.className = 'luz'
    const numero = document.createElement('span')
    numero.className = 'numero'
    numero.textContent = t.numero
    const nombre = document.createElement('span')
    nombre.className = 'nombre'
    // El excepcional que entrego hoy se ve en la planilla como cualquier otro, pero
    // marcado: quien mira la planilla tiene que poder distinguir una entrega que se
    // esperaba de una que no.
    nombre.textContent = t.ocasional
      ? `${t.nombre ? `${t.nombre} · ` : ''}excepcional`
      : (t.nombre ?? '')
    quien.append(luz, numero, nombre)
    fila.append(quien)

    // Las entregas, despues UN solo "+" —el de la siguiente— y el resto huecos para que
    // la grilla no se desarme.
    fila.style.setProperty('--entregas', slots)
    for (let i = 0; i < slots; i++) {
      if (i < t.entregas.length) fila.append(celdaCargada(t, t.entregas[i]))
      else if (i === t.entregas.length) fila.append(celdaVacia(t))
      else {
        const hueco = document.createElement('span')
        hueco.className = 'celda hueco'
        fila.append(hueco)
      }
    }

    return fila
  }))

  $('total-litros').textContent = num(est.planilla?.total_litros)
  $('contador-tambos').textContent = `${est.planilla?.cargados ?? 0} / ${est.planilla?.esperados ?? 0}`
  pintarUltimo()
}

function celdaCargada(tambo, entrega) {
  const b = document.createElement('button')
  b.className = `celda llena${entrega.motivo || entrega.observacion ? ' observada' : ''}`
  const l = document.createElement('span')
  l.textContent = num(entrega.litros)
  const t = document.createElement('small')
  t.textContent = entrega.temperatura != null ? `${String(entrega.temperatura).replace('.', ',')} °C` : '—'
  b.append(l, t)
  b.title = `${hhmm(entrega.fecha_hora)}${entrega.motivo ? ` · ${entrega.motivo}` : ''}`
  b.onclick = () => abrirCelda(tambo, entrega)
  return b
}

function celdaVacia(tambo) {
  const b = document.createElement('button')
  b.className = 'celda sumar'
  b.textContent = '+'
  b.onclick = () => abrirCelda(tambo, null)
  return b
}

function pintarUltimo() {
  const u = $('ultimo-cargado')
  const todas = filasVisibles().flatMap((t) => t.entregas)
  if (!todas.length) {
    u.textContent = est.dia
      ? `Todavía no se cargó nada del ${diaCorto(est.dia)}`
      : 'Todavía no se cargó ningún tambo hoy'
    return
  }
  // `delDiaCompleto` viene ordenado por hora: la ultima es la que se acaba de cargar.
  const ult = todas[todas.length - 1]
  u.replaceChildren()
  const f = document.createElement('strong')
  f.textContent = `Último: Tambo ${ult.tambo} · ${num(ult.litros)} L`
  u.append(f, document.createTextNode(` · ${hhmm(ult.fecha_hora)}`))
}

// ---------------------------------------------------------------- cargar una celda

function abrirCelda(tambo, entrega) {
  est.edicion = { tambo, entrega }
  est.campo = 'litros'
  est.litrosStr = entrega ? String(entrega.litros) : ''
  est.tempStr = entrega?.temperatura != null ? String(Math.round(entrega.temperatura * 10)) : ''
  est.motivo = entrega?.motivo_id ? { id: entrega.motivo_id, nombre: entrega.motivo } : null
  est.nota = entrega?.observacion ?? ''

  const cual = entrega ? 'Corregir' : `${tambo.entregas.length + 1}ª entrega`
  $('titulo-carga').textContent =
    `Tambo ${comoSeLlama(tambo)} — ${cual}`
  // Borrar sólo tiene sentido sobre algo ya cargado.
  $('btn-borrar-entrega').hidden = !entrega
  pintarCampos()
  irA('carga')
}

function pintarCampos() {
  const l = $('litros-valor')
  l.textContent = est.litrosStr ? num(est.litrosStr) : '0'
  l.classList.toggle('vacio', !est.litrosStr)
  const t = $('temp-valor')
  t.textContent = gradosDe(est.tempStr)
  t.classList.toggle('vacio', !est.tempStr)

  $('campo-litros').classList.toggle('activo', est.campo === 'litros')
  $('campo-temp').classList.toggle('activo', est.campo === 'temp')

  // La tecla OK cambia según dónde estás, y con eso el Enter del numpad hace lo
  // natural: primero pasa a la temperatura, y recién después guarda. Si siempre dijera
  // GUARDAR, tipear 4200 y Enter grabaría la entrega sin temperatura, que es el dato
  // que está cargado en el 100% de las que hay.
  const ok = $('tecla-guardar')
  const faltaTemp = est.campo === 'litros' && !est.tempStr
  ok.textContent = faltaTemp ? 'SIGUE' : 'GUARDAR'
  ok.classList.toggle('agregar', faltaTemp)
  // Guardar recién cuando los litros son plausibles. La temperatura queda opcional
  // aunque en la práctica siempre se cargue: trabar la planilla por un dato que falta
  // sería peor que guardarla sin él y completarla después.
  ok.disabled = Number(est.litrosStr || 0) < 50
}

// Lo que hace la tecla OK: depende de si todavía falta la temperatura.
function confirmar() {
  if (est.campo === 'litros' && !est.tempStr) {
    est.campo = 'temp'
    pintarCampos()
    return
  }
  guardar()
}

function tecla(valor) {
  const campo = est.campo
  if (valor === 'borrar') {
    if (campo === 'litros') est.litrosStr = est.litrosStr.slice(0, -1)
    else est.tempStr = est.tempStr.slice(0, -1)
  } else if (campo === 'litros') {
    if (est.litrosStr.length < 5) est.litrosStr = (est.litrosStr + valor).replace(/^0+/, '')
  } else if (est.tempStr.length < 3) {
    // Los digitos entran desde la derecha, como en la pantalla original: 1-2-3 da 12,3.
    est.tempStr = (est.tempStr + valor).replace(/^0+/, '')
  }
  pintarCampos()
}

async function guardar() {
  const litros = Number(est.litrosStr)
  if (litros < 50) return
  const temperatura = est.tempStr ? Number(est.tempStr) / 10 : null
  const { tambo, entrega } = est.edicion

  // Corregir = anular y volver a cargar. No se edita la fila: un registro de produccion
  // no se reescribe, y asi el historial muestra que hubo una correccion.
  if (entrega?.id) {
    await fetch(`/api/recepciones/${entrega.id}/anular`, { method: 'POST' }).catch(() => {})
  }

  const fecha = horaServidor()
  const cuerpo = {
    client_id: crypto.randomUUID(),
    operario_id: est.operario.id,
    tambo_id: tambo.id,
    litros,
    temperatura,
    motivo_id: est.motivo?.id ?? null,
    observacion: est.nota || null,
    ...(est.dia ? { fecha_entrega: new Date(`${est.dia}T12:00:00`).toISOString() } : {}),
  }

  // Optimista: la celda se pinta antes de que el POST vuelva. El operario ya leyo el
  // ticket y va por el siguiente.
  pintarOptimista(tambo, entrega, { ...cuerpo, fecha_hora: fecha.toISOString() })
  irA('planilla')

  try {
    if (!red.hay) throw new Error('sin red')
    await postear('/api/recepciones', cuerpo)
    traerPlanilla()
  } catch (e) {
    if (e.definitivo) {
      // Lo rechazo el servidor: se recarga para no dejar en pantalla algo que no existe.
      traerPlanilla()
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

// Mete la entrega en la planilla que ya esta en memoria, para que la celda se pinte sin
// esperar al servidor. Sin esto, offline no se veria nada de lo cargado.
function pintarOptimista(tambo, anterior, nueva) {
  const fila = (est.planilla?.tambos ?? []).find((t) => t.id === tambo.id)
  if (!fila) return
  const entrada = {
    id: null,
    client_id: nueva.client_id,
    tambo: tambo.numero,
    fecha_hora: nueva.fecha_hora,
    litros: nueva.litros,
    temperatura: nueva.temperatura,
    motivo_id: nueva.motivo_id,
    motivo: est.motivo?.nombre ?? null,
    observacion: nueva.observacion,
  }
  if (anterior) {
    const i = fila.entregas.indexOf(anterior)
    if (i !== -1) fila.entregas.splice(i, 1, entrada)
  } else {
    fila.entregas.push(entrada)
  }
  est.planilla.total_litros =
    filasVisibles().reduce((n, t) => n + t.entregas.reduce((m, e) => m + e.litros, 0), 0)
  est.planilla.cargados = filasVisibles().filter((t) => t.entregas.length).length
  pintarPlanilla()
}

async function borrarEntrega() {
  const { entrega } = est.edicion
  if (!entrega) return
  if (entrega.id) {
    await fetch(`/api/recepciones/${entrega.id}/anular`, { method: 'POST' }).catch(() => {})
  } else {
    cola.quitar(entrega.client_id)
  }
  irA('planilla')
  traerPlanilla()
}

// ---------------------------------------------------------------- dia

function avisoLimite() {
  const tope = new Date()
  tope.setDate(tope.getDate() - TOPE_DIAS_ATRAS)
  $('limite-fecha').textContent =
    `Desde el ${diaCorto(isoLocal(tope))} en adelante. Para algo más viejo, se corrige desde el escritorio.`
}

function pintarFecha() {
  const b = $('btn-fecha')
  b.textContent = est.dia ? diaCorto(est.dia) : 'Hoy'
  b.classList.toggle('otro-dia', Boolean(est.dia))
}

function elegirDia(iso) {
  est.dia = iso === isoLocal(new Date()) ? null : iso
  pintarFecha()
  irA('planilla')
  est.planilla = null
  $('planilla').replaceChildren()
  traerPlanilla()
}

function pintarFechas() {
  const hoy = new Date()
  const opciones = [{ iso: null, nombre: 'Hoy' }]
  for (let i = 1; i <= 6; i++) {
    const d = new Date(hoy)
    d.setDate(d.getDate() - i)
    opciones.push({
      iso: isoLocal(d),
      nombre: i === 1 ? `Ayer · ${diaCorto(isoLocal(d))}` : diaCorto(isoLocal(d)),
    })
  }
  botones($('op-fechas'), opciones, (o) => elegirDia(o.iso), (o) => o.nombre)
}

function configurarFechaLibre() {
  const input = $('fecha-libre')
  const hoy = new Date()
  const tope = new Date(hoy)
  tope.setDate(tope.getDate() - TOPE_DIAS_ATRAS)
  input.max = isoLocal(hoy)
  input.min = isoLocal(tope)
  input.value = isoLocal(hoy)
  avisoLimite()
  $('btn-fecha-libre').addEventListener('click', () => {
    const v = input.value
    if (!v || v < input.min || v > input.max) {
      $('limite-fecha').textContent = `Esa fecha no se puede: tiene que estar entre el ${diaCorto(input.min)} y hoy.`
      return
    }
    elegirDia(v)
  })
}

// ---------------------------------------------------------------- otros tambos
//
// Los que entregan de vez en cuando. No van en la planilla de todos los dias —ahi un
// casillero que casi nunca se usa es ruido— pero tienen que poder sumarse al dia en que
// aparecen.
//
// Si el que llego no esta en la lista, hay que darlo de alta en /app/maestros. Es a
// proposito: un tambo tiene numero, y el numero es la clave con la que llega el dato
// —el remito del caudalimetro dice "tambo 14", no un nombre—. Inventarlo desde la tablet
// significaba inventar tambien el numero.

function pintarOcasionales() {
  const otros = (est.planilla?.tambos ?? []).filter((t) => t.activo && t.ocasional)
  const aviso = $('aviso-ocasional')
  aviso.textContent = otros.length
    ? 'Si el tambo que entregó no está en esta lista, hay que darlo de alta en Datos maestros.'
    : 'Todavía no hay tambos excepcionales cargados. Se agregan desde Datos maestros: ' +
      'así no aparecen todos los días y se pueden sumar al día que entregan.'
  botones($('op-ocasionales'), otros, (t) => {
    irA('planilla')
    abrirCelda(t, null)
  }, comoSeLlama)
}

// ---------------------------------------------------------------- observacion

function abrirObservacion() {
  irA('observacion')
}

function volverALaCarga() {
  pintarCampos()
  irA('carga')
}

// ---------------------------------------------------------------- teclado

function armarTeclado(nodo) {
  nodo.replaceChildren()
  for (const n of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) {
    const b = document.createElement('button')
    b.className = 'tecla'
    b.textContent = n
    b.onclick = () => tecla(n)
    nodo.append(b)
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
  ok.id = 'tecla-guardar'
  ok.textContent = 'GUARDAR'
  ok.disabled = true
  ok.onclick = confirmar

  nodo.append(borrar, cero, ok)
}

// ---------------------------------------------------------------- arranque

const catalogo = await cargarCatalogo('recepcion')
configurarTablet(catalogo)
configurarVuelta()

botones($('op-operarios'), catalogo.operarios, (o) => {
  est.operario = o
  irA('planilla')
  traerPlanilla()
})
botones($('op-motivos'), catalogo.motivos_recepcion ?? [], (m) => {
  est.motivo = m
  volverALaCarga()
})

armarTeclado($('teclado-carga'))
pintarFechas()
pintarFecha()
configurarFechaLibre()

$('campo-litros').addEventListener('click', () => { est.campo = 'litros'; pintarCampos() })
$('campo-temp').addEventListener('click', () => { est.campo = 'temp'; pintarCampos() })
$('btn-fecha').addEventListener('click', () => {
  $('fecha-libre').value = est.dia ?? isoLocal(new Date())
  avisoLimite()
  irA('fecha')
})
$('btn-ocasional').addEventListener('click', () => {
  pintarOcasionales()
  irA('ocasional')
})
$('btn-borrar-entrega').addEventListener('click', borrarEntrega)
$('btn-obs-carga').addEventListener('click', abrirObservacion)
$('btn-sin-observacion').addEventListener('click', () => {
  est.motivo = null
  est.nota = ''
  volverALaCarga()
})

const tecladoNota = armarTecladoLetras($('teclado-nota'), (t) => {
  const v = $('nota-valor')
  v.textContent = t || '…'
  v.classList.toggle('vacio', !t)
})
$('btn-escribir').addEventListener('click', () => {
  tecladoNota.poner(est.nota)
  irA('nota')
})
$('btn-nota-ok').addEventListener('click', () => {
  est.nota = tecladoNota.texto.trim()
  volverALaCarga()
})

$('btn-volver').addEventListener('click', () => {
  const paso = pasoActual()
  if (paso === 'nota') return irA('observacion')
  if (paso === 'observacion') return volverALaCarga()
  const atras = PASO_ANTERIOR[paso]
  if (atras) irA(atras)
})
$('btn-reiniciar').addEventListener('click', () => {
  est.operario = null
  irA('operario')
})

red.alCambiar = traerPlanilla
irA('operario')
pintarEstado()
await sincronizar()
registrarSW()
