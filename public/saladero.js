// Saladero: marcar lo que entra a sal y lo que sale [A3 01:24].
//
// La pantalla no muestra una lista pelada de tinas: muestra cuanto hace que cada una
// espera. Ese es el motivo por el que el horario se registra — "eso te da un tiempo,
// entre que el pH llega donde tiene que llegar" [A3 01:08]. Una lista ordenada por
// antiguedad convierte el registro en una herramienta de trabajo.

import {
  $, hhmm, transcurrido, cola, red, horaServidor, pintarEstado, postear, sincronizar,
  cargarCatalogo, botones, hacerPasos, pintarMigas, cuentaRegresiva, registrarSW,
} from '/comun.js'

const VENTANA_DESHACER = 60
// Umbral para resaltar una tina que lleva mucho esperando. Provisorio: falta saber
// cual es el tiempo real entre produccion y salado (no salio en los audios).
const MINUTOS_DEMORA = 240

const est = { operario: null, tipo: null, tina: null, cantidad: '', ultimo: null, timer: null }
const mostrar = hacerPasos(['operario', 'tipo', 'tina', 'cantidad', 'listo'], ['tina', 'cantidad'])

const etiquetaTipo = (t) => (t === 'entrada' ? 'Entra a sal' : 'Sale de sal')

function irA(paso) {
  mostrar(paso)
  $('btn-reiniciar').hidden = paso === 'operario'
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

// ---------------------------------------------------------------- elegir tina

async function elegirTipo(tipo) {
  est.tipo = tipo
  est.tina = null
  irA('tina')

  const ruta = tipo === 'entrada' ? '/api/saladero/pendientes' : '/api/saladero/en-sal'
  $('pregunta-tina').textContent =
    tipo === 'entrada' ? '¿Qué tina entra a sal?' : '¿Qué tina sale de sal?'

  const cont = $('lista-tinas')
  cont.replaceChildren(aviso('Buscando…'))

  let tinas = []
  try {
    tinas = await (await fetch(ruta)).json()
    red.hay = true
  } catch {
    red.hay = false
    pintarEstado()
    // Sin red no se puede saber que tinas hay: elegir a ciegas generaria datos falsos.
    cont.replaceChildren(
      aviso('Sin conexión: no se puede ver el estado de las tinas. Volvé a intentar cuando haya red.')
    )
    return
  }

  if (!tinas.length) {
    cont.replaceChildren(
      aviso(tipo === 'entrada' ? 'No hay tinas esperando para salar.' : 'No hay nada en sal.')
    )
    return
  }

  cont.replaceChildren(...tinas.map((t) => tarjetaTina(t, tipo)))
}

function aviso(texto) {
  const d = document.createElement('div')
  d.className = 'aviso'
  d.textContent = texto
  return d
}

function tarjetaTina(t, tipo) {
  const entrando = tipo === 'entrada'
  const disponible = entrando ? t.falta : t.en_sal
  const minutos = entrando ? t.minutos_desde_produccion : t.minutos_en_sal

  const b = document.createElement('button')
  b.className = 'tarjeta-tina'
  if (entrando && minutos >= MINUTOS_DEMORA) b.classList.add('demorada')

  const queso = document.createElement('span')
  queso.className = 'queso'
  queso.textContent = t.queso

  const cant = document.createElement('span')
  cant.className = 'cant'
  cant.textContent = disponible

  const meta = document.createElement('span')
  meta.className = 'meta'
  const fuerte = document.createElement('strong')
  fuerte.textContent = transcurrido(minutos)
  meta.append(fuerte, document.createTextNode(entrando ? 'desde producción' : 'en sal'))

  b.append(queso, cant, meta)
  b.onclick = () => {
    est.tina = { ...t, disponible }
    // Lo normal es mover la tina entera. Se precarga el total y el teclado queda
    // disponible por si se mueve una parte.
    est.cantidad = String(disponible)
    est.recienCargado = true
    $('pregunta-cantidad').textContent = entrando
      ? `¿Cuántas entran? (hay ${disponible})`
      : `¿Cuántas salen? (hay ${disponible})`
    pintarCantidad()
    irA('cantidad')
  }
  return b
}

// ---------------------------------------------------------------- teclado

function pintarCantidad() {
  const n = Number(est.cantidad)
  const v = $('valor')
  v.textContent = est.cantidad || '0'
  v.classList.toggle('vacio', !est.cantidad)
  $('unidad').textContent = n === 1 ? 'pieza' : 'piezas'
  // No se puede salar mas de lo producido ni sacar mas de lo que hay: el servidor lo
  // rechaza, pero mejor que el boton ni siquiera se habilite.
  $('tecla-ok').disabled = !n || n > est.tina.disponible
}

function tecla(valor) {
  // El valor viene precargado con el total disponible, que es lo que se mueve casi
  // siempre. Si el operario empieza a teclear es porque quiere OTRO numero: el primer
  // digito reemplaza el precargado en vez de agregarse. Sin esto hay que borrar el
  // total digito por digito, con guantes, antes de poder escribir.
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
  const local = {
    ...cuerpo,
    fecha_hora: fecha.toISOString(),
    operario: est.operario.nombre,
    queso: est.tina.queso,
  }

  est.ultimo = local
  $('listo-titulo').textContent = est.tipo === 'entrada' ? 'ENTRÓ A SAL' : 'SALIÓ DE SAL'
  $('listo-hora').textContent = hhmm(fecha)
  $('listo-detalle').textContent = `${local.queso} · ${cantidad} piezas · ${local.operario}`
  irA('listo')
  clearInterval(est.timer)
  est.timer = cuentaRegresiva(VENTANA_DESHACER, $('deshacer-seg'), reiniciar)

  try {
    if (!red.hay) throw new Error('sin red')
    const guardado = await postear('/api/saladero', cuerpo)
    est.ultimo.id = guardado.id
  } catch (e) {
    if (e.definitivo) {
      // El servidor lo rechazo (p.ej. otro operario ya movio esa tina). Encolarlo
      // seria mentirle al operario: mejor avisar ahora.
      $('listo-titulo').textContent = 'NO SE PUDO REGISTRAR'
      $('listo-detalle').textContent = e.detalle?.error ?? 'Probá de nuevo'
      est.ultimo = null
    } else {
      cola.agregar({
        ruta: '/api/saladero',
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
    await fetch(`/api/saladero/${u.id}/anular`, { method: 'POST' }).catch(() => {})
  } else {
    cola.quitar(u.client_id)
  }
  est.ultimo = null
  pintarEstado()
  refrescarHoy()
  reiniciar()
}

// ---------------------------------------------------------------- historial

async function refrescarHoy() {
  if (!red.hay) return
  try {
    const { movimientos, entradas, salidas } = await (await fetch('/api/saladero')).json()
    $('entradas-hoy').textContent = entradas
    $('salidas-hoy').textContent = salidas

    const enSal = await (await fetch('/api/saladero/en-sal')).json()
    $('en-sal-total').textContent = enSal.reduce((n, t) => n + t.en_sal, 0)

    $('lista-hoy').replaceChildren(
      ...movimientos.slice(0, 20).map((m) => {
        const el = document.createElement('div')
        el.className = `fila${m.anulado ? ' anulada' : ''}`
        el.innerHTML = '<span class="h"></span><span class="q"></span><span class="op"></span>'
        el.querySelector('.h').textContent = hhmm(m.fecha_hora)
        el.querySelector('.q').textContent =
          `${m.tipo === 'entrada' ? '→ entró' : '← salió'} · ${m.queso} · ${m.cantidad}`
        el.querySelector('.op').textContent = m.operario
        return el
      })
    )
  } catch {
    red.hay = false
    pintarEstado()
  }
}

// ---------------------------------------------------------------- arranque

const catalogo = await cargarCatalogo('saladero')

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
$('btn-reiniciar').addEventListener('click', () => reiniciar(false))
red.alCambiar = refrescarHoy

irA('operario')
pintarEstado()
await sincronizar()
await refrescarHoy()
registrarSW()
