// Maduración. El reloj arranca al ENTRAR a la cámara, no al producir: "sé cuándo
// entraron, sé cuántos días tienen los pategrás de maduración" [A5 00:43].
//
// La pantalla muestra CUATRO estados, no dos. Un queso no pasa de "no apto" a "apto"
// un martes a las 8: hay un mínimo antes del cual no se vende, un punto óptimo, y un
// momento en que se pasó. Con un solo umbral el sistema falla justo en los bordes,
// que es donde se decide.
//
// Y sobre todo: esto SUGIERE, no decide. La maduración real depende de la cámara, de
// la estación y de la pieza; el quesero decide golpeando el queso, no mirando un
// calendario. Si la tablet dijera "apto" como una orden y él no estuviera de acuerdo,
// dejaría de mirarla en una semana. Por eso el estado es una referencia visible y la
// salida se registra cuando él lo decide — y el sistema aprende de eso.

import {
  $, hhmm, cola, red, horaServidor, pintarEstado, postear, sincronizar,
  cargarCatalogo, botones, hacerPasos, pintarMigas, cuentaRegresiva, registrarSW,
} from '/comun.js'

const VENTANA_DESHACER = 60

const ESTADOS = {
  falta:    { texto: 'Falta',      clase: 'estado-falta' },
  apto:     { texto: 'Apto',       clase: 'estado-apto' },
  optimo:   { texto: 'En su punto', clase: 'estado-optimo' },
  pasado:   { texto: 'Se pasa',    clase: 'estado-pasado' },
  sin_dato: { texto: 'Sin dato',   clase: 'estado-sin_dato' },
}

const est = { operario: null, tipo: null, tina: null, cantidad: '', recienCargado: false, ultimo: null, timer: null }
const mostrar = hacerPasos(['operario', 'tipo', 'tina', 'cantidad', 'listo'], ['tina', 'cantidad'])

const etiquetaTipo = (t) => (t === 'entrada' ? 'Entra a cámara' : 'Sale de cámara')

function irA(paso) {
  mostrar(paso)
  $('btn-reiniciar').hidden = paso !== 'tipo'
  $('btn-volver').hidden = !['tina', 'cantidad'].includes(paso)
  pintarMigas([est.operario?.nombre, est.tipo && etiquetaTipo(est.tipo), est.tina?.queso])
}

function reiniciar(conservarOperario = true) {
  clearInterval(est.timer)
  est.tipo = null
  est.tina = null
  est.cantidad = ''
  est.recienCargado = false
  if (!conservarOperario) est.operario = null
  irA(est.operario ? 'tipo' : 'operario')
}

function aviso(texto) {
  const d = document.createElement('div')
  d.className = 'aviso'
  d.textContent = texto
  return d
}

// ---------------------------------------------------------------- elegir lote

async function elegirTipo(tipo) {
  est.tipo = tipo
  est.tina = null
  irA('tina')

  $('pregunta-tina').textContent =
    tipo === 'entrada' ? '¿Qué lote entra a cámara?' : '¿Qué lote sale de cámara?'
  $('resumen').hidden = tipo === 'entrada'

  const cont = $('lista-tinas')
  cont.replaceChildren(aviso('Buscando…'))

  try {
    if (tipo === 'entrada') {
      const lotes = await (await fetch('/api/maduracion/pendientes')).json()
      red.hay = true
      if (!lotes.length) return cont.replaceChildren(aviso('No hay queso esperando entrar a cámara.'))
      cont.replaceChildren(...lotes.map(tarjetaEntrada))
    } else {
      const { lotes, resumen } = await (await fetch('/api/maduracion/camara')).json()
      red.hay = true
      pintarResumen(resumen)
      if (!lotes.length) return cont.replaceChildren(aviso('No hay nada en cámara.'))
      cont.replaceChildren(...lotes.map(tarjetaCamara))
    }
  } catch {
    red.hay = false
    pintarEstado()
    cont.replaceChildren(aviso('Sin conexión: no se puede ver la cámara. Reintentá cuando haya red.'))
  }
}

function pintarResumen(r) {
  const items = [
    { n: r.falta, t: 'Falta' },
    { n: r.apto, t: 'Aptos' },
    { n: r.optimo, t: 'En su punto' },
    { n: r.pasado, t: 'Se pasan' },
  ]
  if (r.sin_dato) items.push({ n: r.sin_dato, t: 'Sin dato' })

  $('resumen').replaceChildren(...items.map((i) => {
    const d = document.createElement('div')
    const n = document.createElement('div')
    n.className = 'n'
    n.textContent = i.n
    const t = document.createElement('div')
    t.className = 't'
    t.textContent = i.t
    d.append(n, t)
    return d
  }))
}

function tarjetaBase(queso, cantidad) {
  const b = document.createElement('button')
  b.className = 'tarjeta-tina'
  const q = document.createElement('span')
  q.className = 'queso'
  q.textContent = queso
  const c = document.createElement('span')
  c.className = 'cant'
  c.textContent = cantidad
  b.append(q, c)
  return b
}

function tarjetaEntrada(t) {
  const b = tarjetaBase(t.queso, t.falta)
  const dias = document.createElement('span')
  dias.className = 'dias'
  dias.textContent = t.dias_minimos ? `madura ${t.dias_minimos}-${t.dias_optimos} días` : 'sin días cargados'
  b.append(dias)
  b.onclick = () => abrirCantidad(t, t.falta, `${t.queso} · ¿cuántas entran? (hay ${t.falta})`)
  return b
}

function tarjetaCamara(t) {
  const b = tarjetaBase(t.queso, t.en_camara)
  if (t.estado === 'optimo') b.classList.add('optimo')
  if (t.estado === 'pasado') b.classList.add('pasado')

  const chip = document.createElement('span')
  const e = ESTADOS[t.estado] ?? ESTADOS.sin_dato
  chip.className = `estado-chip ${e.clase}`
  chip.textContent = e.texto

  const dias = document.createElement('span')
  dias.className = 'dias'
  const fuerte = document.createElement('strong')
  fuerte.textContent = `${t.dias_adentro} día${t.dias_adentro === 1 ? '' : 's'}`
  dias.append(fuerte)
  dias.append(
    document.createTextNode(
      t.estado === 'falta' ? `faltan ${t.falta}` : t.dias_optimos ? `punto: ${t.dias_optimos}` : 'sin referencia'
    )
  )

  b.append(chip, dias)
  b.onclick = () => abrirCantidad(t, t.en_camara, `${t.queso} · ¿cuántas salen? (hay ${t.en_camara})`)
  return b
}

function abrirCantidad(t, disponible, titulo) {
  est.tina = { ...t, disponible }
  est.cantidad = String(disponible)
  est.recienCargado = true
  $('pregunta-cantidad').textContent = titulo
  pintarCantidad()
  irA('cantidad')
}

// ---------------------------------------------------------------- teclado

function pintarCantidad() {
  const n = Number(est.cantidad)
  const v = $('valor')
  v.textContent = est.cantidad || '0'
  v.classList.toggle('vacio', !est.cantidad)
  $('unidad').textContent = n === 1 ? 'pieza' : 'piezas'
  $('tecla-ok').disabled = !n || n > est.tina.disponible
}

function tecla(valor) {
  // El primer dígito reemplaza el precargado: sin esto hay que borrar el total
  // dígito por dígito, con guantes.
  if (est.recienCargado && valor !== 'borrar') {
    est.cantidad = ''
    est.recienCargado = false
  }
  if (valor === 'borrar') {
    est.recienCargado = false
    est.cantidad = est.cantidad.slice(0, -1)
  } else if (est.cantidad.length < 4) {
    est.cantidad = (est.cantidad + valor).replace(/^0+/, '')
  }
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
  ok.onclick = registrar

  t.append(borrar, cero, ok)
}

// ---------------------------------------------------------------- registrar

async function registrar() {
  const cantidad = Number(est.cantidad)
  if (!cantidad || cantidad > est.tina.disponible) return

  const fecha = horaServidor()
  const cuerpo = {
    client_id: crypto.randomUUID(),
    operario_id: est.operario.id,
    tina_id: est.tina.id,
    tipo: est.tipo,
    cantidad,
  }

  est.ultimo = { ...cuerpo, queso: est.tina.queso }
  $('listo-titulo').textContent = est.tipo === 'entrada' ? 'ENTRÓ A CÁMARA' : 'SALIÓ DE CÁMARA'
  $('listo-hora').textContent = hhmm(fecha)
  $('listo-detalle').textContent =
    est.tipo === 'salida' && est.tina.dias_adentro != null
      ? `${est.tina.queso} · ${cantidad} piezas · maduró ${est.tina.dias_adentro} días`
      : `${est.tina.queso} · ${cantidad} piezas`
  irA('listo')
  clearInterval(est.timer)
  est.timer = cuentaRegresiva(VENTANA_DESHACER, $('deshacer-seg'), reiniciar)

  try {
    if (!red.hay) throw new Error('sin red')
    const guardado = await postear('/api/maduracion', cuerpo)
    est.ultimo.id = guardado.id
  } catch (e) {
    if (e.definitivo) {
      $('listo-titulo').textContent = 'NO SE PUDO REGISTRAR'
      $('listo-detalle').textContent = e.detalle?.error ?? 'Probá de nuevo'
      est.ultimo = null
    } else {
      cola.agregar({
        ruta: '/api/maduracion',
        cuerpo: { ...cuerpo, fecha_hora_cliente: fecha.toISOString() },
      })
      red.hay = false
    }
  }
  pintarEstado()
  refrescarHoy()
}

async function deshacer() {
  clearInterval(est.timer)
  const u = est.ultimo
  if (!u) return reiniciar()
  if (u.id) {
    await fetch(`/api/maduracion/${u.id}/anular`, { method: 'POST' }).catch(() => {})
  } else {
    cola.quitar(u.client_id)
  }
  est.ultimo = null
  pintarEstado()
  reiniciar()
}

// ---------------------------------------------------------------- historial

async function refrescarHoy() {
  if (!red.hay) return
  try {
    const { movimientos, entradas, salidas } = await (await fetch('/api/maduracion')).json()
    $('entradas-hoy').textContent = entradas
    $('salidas-hoy').textContent = salidas

    const { resumen } = await (await fetch('/api/maduracion/camara')).json()
    $('en-camara-total').textContent = resumen.total

    $('lista-hoy').replaceChildren(...movimientos.slice(0, 20).map((m) => {
      const el = document.createElement('div')
      el.className = `fila${m.anulado ? ' anulada' : ''}`
      el.innerHTML = '<span class="h"></span><span class="q"></span><span class="op"></span>'
      el.querySelector('.h').textContent = hhmm(m.fecha_hora)
      el.querySelector('.q').textContent =
        `${m.tipo === 'entrada' ? '→ entró' : '← salió'} · ${m.queso} · ${m.cantidad}` +
        (m.dias_reales != null ? ` · ${m.dias_reales} días` : '')
      el.querySelector('.op').textContent = m.operario
      return el
    }))
  } catch {
    red.hay = false
    pintarEstado()
  }
}

// ---------------------------------------------------------------- arranque

const catalogo = await cargarCatalogo('maduracion')

botones($('op-operarios'), catalogo.operarios, (o) => {
  est.operario = o
  irA('tipo')
})
armarTeclado()

$('btn-entrada').addEventListener('click', () => elegirTipo('entrada'))
$('btn-salida').addEventListener('click', () => elegirTipo('salida'))
$('btn-deshacer').addEventListener('click', deshacer)
$('btn-seguir').addEventListener('click', () => {
  clearInterval(est.timer)
  reiniciar()
})
$('btn-volver').addEventListener('click', () => (est.tipo ? elegirTipo(est.tipo) : irA('tipo')))
$('btn-reiniciar').addEventListener('click', () => reiniciar(false))
red.alCambiar = refrescarHoy

irA('operario')
pintarEstado()
await sincronizar()
await refrescarHoy()
registrarSW()
