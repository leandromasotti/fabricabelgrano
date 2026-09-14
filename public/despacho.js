// Pantalla del encargado. Resuelve el cuello de botella del audio 6: hoy Andres no
// puede facturar NADA hasta que suban todos los pedidos juntos. Aca los ve llegar de
// a uno, en el momento, y factura el que esta listo sin esperar al resto.

const $ = (s) => document.querySelector(s)
const kg = (g) => (g / 1000).toFixed(3).replace('.', ',')
const hhmm = (d) =>
  new Date(d).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })

const REFRESCO = 5000

let catalogoQuesos = []
let lineasNuevas = []
// Se conserva qué pedidos tenía abierto el detalle: si el refresco los cerrara cada
// 5 segundos, la pantalla seria inusable justo mientras se controla un pedido.
let abiertos = new Set()

// ---------------------------------------------------------------- pintar

function tarjeta(p) {
  const art = document.createElement('article')
  art.className = `pedido${p.estado === 'listo' ? ' listo' : ''}`

  const top = document.createElement('div')
  top.className = 'top'
  const cli = document.createElement('span')
  cli.className = 'cliente'
  cli.textContent = p.cliente
  const hora = document.createElement('span')
  hora.className = 'hora'
  hora.textContent = hhmm(p.armado_en ?? p.creado_en)
  top.append(cli, hora)

  const cifras = document.createElement('div')
  cifras.className = 'cifras'
  const kilos = document.createElement('span')
  kilos.className = 'kilos'
  kilos.textContent = kg(p.gramos)
  const u = document.createElement('small')
  u.textContent = 'kg'
  kilos.append(u)
  const piezas = document.createElement('span')
  piezas.className = 'piezas'
  piezas.textContent = `${p.piezas} de ${p.piezas_pedidas} piezas`
  cifras.append(kilos, piezas)

  art.append(top, cifras)

  if (p.armador) {
    const q = document.createElement('div')
    q.className = 'quien'
    q.textContent = `Armando: ${p.armador}`
    art.append(q)
  }

  // Detalle por línea, para controlar antes de facturar.
  const det = document.createElement('details')
  det.open = abiertos.has(p.id)
  det.addEventListener('toggle', () => (det.open ? abiertos.add(p.id) : abiertos.delete(p.id)))
  const sum = document.createElement('summary')
  sum.textContent = 'Ver detalle'
  det.append(sum)

  const tabla = document.createElement('table')
  tabla.innerHTML =
    '<thead><tr><th>Queso</th><th class="num">Pedidas</th><th class="num">Entregadas</th><th class="num">Kilos</th></tr></thead>'
  const tb = document.createElement('tbody')
  det.append(tabla)
  tabla.append(tb)

  fetch(`/api/pedidos/${p.id}`)
    .then((r) => r.json())
    .then((full) => {
      tb.replaceChildren(...full.lineas.map((l) => {
        const tr = document.createElement('tr')
        const difiere = l.piezas !== l.cantidad_pedida
        tr.innerHTML = `<td></td><td class="num"></td><td class="num${difiere ? ' difiere' : ''}"></td><td class="num"></td>`
        tr.children[0].textContent = l.queso
        tr.children[1].textContent = l.cantidad_pedida
        tr.children[2].textContent = l.piezas
        tr.children[3].textContent = kg(l.gramos)
        return tr
      }))
    })
    .catch(() => {})

  art.append(det)

  const acc = document.createElement('div')
  acc.className = 'acciones'

  if (p.estado === 'listo') {
    const f = document.createElement('button')
    f.className = 'principal'
    f.textContent = 'Marcar facturado'
    f.onclick = async () => {
      await fetch(`/api/pedidos/${p.id}/facturar`, { method: 'POST' })
      cargar()
    }
    const r = document.createElement('button')
    r.textContent = 'Reabrir'
    r.onclick = async () => {
      await fetch(`/api/pedidos/${p.id}/reabrir`, { method: 'POST' })
      cargar()
    }
    const c = document.createElement('button')
    c.textContent = 'Descargar CSV'
    c.onclick = () => (window.location = `/api/pedidos/${p.id}/remito.csv`)
    acc.append(f, c, r)
  } else {
    const a = document.createElement('button')
    a.textContent = 'Anular'
    a.onclick = async () => {
      if (!confirm(`¿Anular el pedido de ${p.cliente}?`)) return
      await fetch(`/api/pedidos/${p.id}/anular`, { method: 'POST' })
      cargar()
    }
    acc.append(a)
  }

  art.append(acc)
  return art
}

function vacio(txt) {
  const d = document.createElement('div')
  d.className = 'vacio'
  d.textContent = txt
  return d
}

// ---------------------------------------------------------------- cargar

async function cargar() {
  let pedidos
  try {
    pedidos = (await (await fetch('/api/pedidos')).json()).pedidos
    $('#pulso').classList.add('activo')
    $('#vivo-txt').textContent = 'actualizando cada 5 s'
  } catch {
    $('#pulso').classList.remove('activo')
    $('#vivo-txt').textContent = 'sin conexión con el servidor'
    return
  }

  const por = (estado) => pedidos.filter((p) => p.estado === estado)
  const listos = por('listo')

  const cols = [
    ['#col-pendiente', por('pendiente'), 'Nada pendiente.'],
    ['#col-armando', por('armando'), 'Nadie está armando ahora.'],
    ['#col-listo', listos, 'Nada para facturar.'],
  ]
  for (const [sel, arr, msg] of cols) {
    $(sel).replaceChildren(...(arr.length ? arr.map(tarjeta) : [vacio(msg)]))
  }

  const kilos = listos.reduce((n, p) => n + p.gramos, 0)
  $('#resumen').textContent = listos.length
    ? `${listos.length} pedido${listos.length === 1 ? '' : 's'} listo${listos.length === 1 ? '' : 's'} · ${kg(kilos)} kg para facturar`
    : ''
}

// ---------------------------------------------------------------- alta

async function abrirAlta() {
  lineasNuevas = []
  const [clientes, catalogo] = await Promise.all([
    (await fetch('/api/clientes')).json(),
    (await fetch('/api/catalogo?sector=pedidos')).json(),
  ])
  catalogoQuesos = catalogo.quesos

  $('#cliente').replaceChildren(...clientes.map((c) => {
    const o = document.createElement('option')
    o.value = c.id
    o.textContent = c.nombre
    return o
  }))
  $('#queso').replaceChildren(...catalogoQuesos.map((q) => {
    const o = document.createElement('option')
    o.value = q.id
    o.textContent = q.nombre
    return o
  }))
  pintarLineasNuevas()
  $('#dlg').showModal()
}

function pintarLineasNuevas() {
  $('#lineas-nuevas').replaceChildren(...lineasNuevas.map((l, i) => {
    const d = document.createElement('div')
    const s = document.createElement('span')
    s.textContent = `${l.queso} · ${l.cantidad_pedida} piezas`
    const b = document.createElement('button')
    b.textContent = 'Quitar'
    b.onclick = () => {
      lineasNuevas.splice(i, 1)
      pintarLineasNuevas()
    }
    d.append(s, b)
    return d
  }))
  $('#btn-crear').disabled = lineasNuevas.length === 0
}

$('#btn-nuevo').addEventListener('click', abrirAlta)
$('#btn-cancelar').addEventListener('click', () => $('#dlg').close())

$('#btn-add').addEventListener('click', () => {
  const id = Number($('#queso').value)
  const cantidad = Number($('#cantidad').value)
  if (!id || !Number.isInteger(cantidad) || cantidad < 1) return
  lineasNuevas.push({
    tipo_queso_id: id,
    cantidad_pedida: cantidad,
    queso: catalogoQuesos.find((q) => q.id === id)?.nombre ?? '',
  })
  pintarLineasNuevas()
})

$('#btn-crear').addEventListener('click', async () => {
  const res = await fetch('/api/pedidos', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: crypto.randomUUID(),
      cliente_id: Number($('#cliente').value),
      origen: 'encargado',
      lineas: lineasNuevas.map(({ tipo_queso_id, cantidad_pedida }) => ({ tipo_queso_id, cantidad_pedida })),
    }),
  })
  if (res.ok) {
    $('#dlg').close()
    cargar()
  }
})

// ---------------------------------------------------------------- arranque

cargar()
setInterval(cargar, REFRESCO)
