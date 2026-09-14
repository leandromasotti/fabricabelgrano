// Envasado. Tercera etapa del circuito: el queso sale del saladero "desnudo", espera
// en la camara de desnudo y de ahi se envasa. Envasarlo equivale a declararlo listo
// para vender, en la camara de preparacion de pedidos [A4 01:00-01:09].
//
// Igual que el saladero, la lista no es un catalogo: son las tinas que estan
// esperando, ordenadas por cuanto hace que salieron de sal. El queso desnudo esperando
// en camara es justamente lo que no conviene que se acumule.

import {
  $, hhmm, transcurrido, cola, red, horaServidor, pintarEstado, postear, sincronizar,
  cargarCatalogo, botones, hacerPasos, pintarMigas, cuentaRegresiva, registrarSW,
} from '/comun.js'

const VENTANA_DESHACER = 60
// Umbral provisorio para resaltar queso desnudo que lleva mucho en camara. Falta el
// dato real, igual que en saladero (pregunta B6).
const MINUTOS_DEMORA = 48 * 60

const est = { operario: null, tina: null, cantidad: '', ultimo: null, timer: null }
const mostrar = hacerPasos(['operario', 'tina', 'cantidad', 'listo'], ['tina', 'cantidad'])

function irA(paso) {
  mostrar(paso)
  $('btn-reiniciar').hidden = paso !== 'tina'
  $('btn-volver').hidden = paso !== 'cantidad'
  pintarMigas([est.operario?.nombre, est.tina?.queso])
}

function reiniciar(conservarOperario = true) {
  clearInterval(est.timer)
  est.tina = null
  est.cantidad = ''
  est.recienCargado = false
  if (!conservarOperario) est.operario = null
  if (est.operario) return abrirLista()
  irA('operario')
}

// ---------------------------------------------------------------- lista

async function abrirLista() {
  est.tina = null
  irA('tina')
  const cont = $('lista-tinas')
  cont.replaceChildren(aviso('Buscando…'))

  let data
  try {
    data = await (await fetch('/api/envasado/pendientes')).json()
    red.hay = true
  } catch {
    red.hay = false
    pintarEstado()
    cont.replaceChildren(
      aviso('Sin conexión: no se puede ver qué hay en la cámara de desnudo. Reintentá cuando haya red.')
    )
    return
  }

  // Ya no hace falta listar aparte lo que no se envasa: ahora eso vive en la pantalla
  // de maduración, que es su destino real.
  const nodos = data.pendientes.map(tarjetaTina)

  if (!nodos.length) {
    cont.replaceChildren(aviso('No hay queso esperando para envasar.'))
  } else {
    cont.replaceChildren(...nodos)
  }

  $('pendiente-total').textContent = data.pendientes.reduce((n, t) => n + t.falta, 0)
  refrescarHoy()
}

function tarjetaTina(t) {
  const b = document.createElement('button')
  b.className = 'tarjeta-tina'
  if (t.minutos_desde_sal >= MINUTOS_DEMORA) b.classList.add('demorada')

  const queso = document.createElement('span')
  queso.className = 'queso'
  queso.textContent = t.queso

  const cant = document.createElement('span')
  cant.className = 'cant'
  cant.textContent = t.falta

  const meta = document.createElement('span')
  meta.className = 'meta'
  const fuerte = document.createElement('strong')
  fuerte.textContent = transcurrido(t.minutos_desde_sal)
  meta.append(fuerte, document.createTextNode(`desde que salió de ${t.viene_de ?? 'sal'}`))

  b.append(queso, cant, meta)
  b.onclick = () => {
    est.tina = { ...t, disponible: t.falta }
    // Lo normal es envasar todo lo que salio. El teclado queda para el caso parcial.
    est.cantidad = String(t.falta)
    est.recienCargado = true
    $('pregunta-cantidad').textContent = `${t.queso} · ¿cuántos envasaste? (hay ${t.falta})`
    pintarCantidad()
    irA('cantidad')
  }
  return b
}

function aviso(texto) {
  const d = document.createElement('div')
  d.className = 'aviso'
  d.textContent = texto
  return d
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
    cantidad,
  }

  est.ultimo = { ...cuerpo, queso: est.tina.queso, operario: est.operario.nombre }
  $('listo-titulo').textContent = 'ENVASADO'
  $('listo-hora').textContent = hhmm(fecha)
  $('listo-detalle').textContent =
    `${est.tina.queso} · ${cantidad} piezas · listo para vender`
  irA('listo')
  clearInterval(est.timer)
  est.timer = cuentaRegresiva(VENTANA_DESHACER, $('deshacer-seg'), reiniciar)

  try {
    if (!red.hay) throw new Error('sin red')
    const guardado = await postear('/api/envasado', cuerpo)
    est.ultimo.id = guardado.id
  } catch (e) {
    if (e.definitivo) {
      // Otro operario ya envasó esa tina, o el queso no se envasa. Encolarlo seria
      // mentirle al operario.
      $('listo-titulo').textContent = 'NO SE PUDO REGISTRAR'
      $('listo-detalle').textContent = e.detalle?.error ?? 'Probá de nuevo'
      est.ultimo = null
    } else {
      cola.agregar({
        ruta: '/api/envasado',
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
    await fetch(`/api/envasado/${u.id}/anular`, { method: 'POST' }).catch(() => {})
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
    const { movimientos, envasado } = await (await fetch('/api/envasado')).json()
    $('envasado-hoy').textContent = envasado
    $('lista-hoy').replaceChildren(...movimientos.slice(0, 20).map((m) => {
      const el = document.createElement('div')
      el.className = `fila${m.anulado ? ' anulada' : ''}`
      el.innerHTML = '<span class="h"></span><span class="q"></span><span class="op"></span>'
      el.querySelector('.h').textContent = hhmm(m.fecha_hora)
      el.querySelector('.q').textContent = `${m.queso} · ${m.cantidad}`
      el.querySelector('.op').textContent = m.operario
      return el
    }))
  } catch {
    red.hay = false
    pintarEstado()
  }
}

// ---------------------------------------------------------------- arranque

const catalogo = await cargarCatalogo('envasado')

botones($('op-operarios'), catalogo.operarios, (o) => {
  est.operario = o
  abrirLista()
})
armarTeclado()

$('btn-deshacer').addEventListener('click', deshacer)
$('btn-seguir').addEventListener('click', () => {
  clearInterval(est.timer)
  reiniciar()
})
$('btn-volver').addEventListener('click', abrirLista)
$('btn-reiniciar').addEventListener('click', () => reiniciar(false))
red.alCambiar = refrescarHoy

irA('operario')
pintarEstado()
await sincronizar()
registrarSW()
