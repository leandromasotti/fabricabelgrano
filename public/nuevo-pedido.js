// Carga administrativa de pedidos y hoja de armado imprimible.
//
// POR QUÉ HAY PAPEL SI YA HAY TABLET: las tablets están amuradas a la pared. El
// armador camina por la cámara juntando piezas, así que necesita la lista en la mano.
// La orden baja en papel, los pesos suben por la tablet — y esa vuelta digital es donde
// estaba la ganancia: el encargado factura sin esperar que suba ningún papel.
//
// La hoja deja columnas EN BLANCO a propósito. El armador anota ahí mientras camina y
// después vuelca en la tablet. Una hoja que no se pueda escribir no sirve de nada.

const $ = (s) => document.querySelector(s)
const fmt = (n) => (n ?? 0).toLocaleString('es-AR')

const el = (tag, clase, texto) => {
  const n = document.createElement(tag)
  if (clase) n.className = clase
  if (texto != null) n.textContent = texto
  return n
}

let quesos = []
let lineas = []
let pedidos = []
const seleccion = new Set()

// ---------------------------------------------------------------- alta

function pintarLineas() {
  if (!lineas.length) {
    $('#lineas').replaceChildren(el('div', 'vacio', 'Todavía no agregaste ningún queso.'))
  } else {
    $('#lineas').replaceChildren(...lineas.map((l, i) => {
      const d = document.createElement('div')
      const quitar = el('button', null, 'Quitar')
      quitar.onclick = () => {
        lineas.splice(i, 1)
        pintarLineas()
      }
      d.append(el('span', null, l.queso), el('span', 'n', `${l.cantidad_pedida} pz`), quitar)
      return d
    }))
  }
  $('#btn-crear').disabled = lineas.length === 0
}

$('#btn-add').addEventListener('click', () => {
  const id = Number($('#queso').value)
  const cantidad = Number($('#cantidad').value)
  if (!id || !Number.isInteger(cantidad) || cantidad < 1) return

  // Si el queso ya está en el pedido, se suma en vez de duplicar la línea: el armador
  // no tiene por qué buscar dos veces el mismo queso en la cámara.
  const ya = lineas.find((l) => l.tipo_queso_id === id)
  if (ya) ya.cantidad_pedida += cantidad
  else {
    lineas.push({
      tipo_queso_id: id,
      cantidad_pedida: cantidad,
      queso: quesos.find((q) => q.id === id)?.nombre ?? '',
    })
  }
  $('#cantidad').value = 1
  pintarLineas()
})

$('#btn-crear').addEventListener('click', async () => {
  $('#btn-crear').disabled = true
  const res = await fetch('/api/pedidos', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: crypto.randomUUID(),
      cliente_id: Number($('#cliente').value),
      origen: 'encargado',
      nota: $('#nota').value.trim() || null,
      lineas: lineas.map(({ tipo_queso_id, cantidad_pedida }) => ({ tipo_queso_id, cantidad_pedida })),
    }),
  })
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    alert(e.error ?? 'No se pudo crear el pedido')
    $('#btn-crear').disabled = false
    return
  }
  const creado = await res.json()
  lineas = []
  $('#nota').value = ''
  pintarLineas()
  await cargarPedidos()
  // El pedido recién creado queda seleccionado: lo más probable es que se imprima ya.
  seleccion.add(creado.id)
  pintarPedidos()
})

// ---------------------------------------------------------------- lista

async function cargarPedidos() {
  const r = await (await fetch('/api/pedidos')).json()
  pedidos = r.pedidos.filter((p) => p.estado === 'pendiente' || p.estado === 'armando')
  // Si un pedido seleccionado ya se armó, deja de existir en la lista y su selección
  // tiene que irse con él.
  for (const id of [...seleccion]) if (!pedidos.some((p) => p.id === id)) seleccion.delete(id)
  pintarPedidos()
}

function pintarPedidos() {
  if (!pedidos.length) {
    $('#filas').replaceChildren()
    const tr = document.createElement('tr')
    const td = el('td', 'vacio', 'No hay pedidos pendientes de armar.')
    td.colSpan = 6
    tr.append(td)
    $('#filas').append(tr)
  } else {
    $('#filas').replaceChildren(...pedidos.map((p) => {
      const tr = document.createElement('tr')
      const chk = document.createElement('input')
      chk.type = 'checkbox'
      chk.checked = seleccion.has(p.id)
      chk.onchange = () => {
        chk.checked ? seleccion.add(p.id) : seleccion.delete(p.id)
        pintarSeleccion()
      }
      const tdChk = el('td')
      tdChk.append(chk)

      const estado = el('span', `chip ${p.estado === 'armando' ? 'armando' : ''}`,
        p.estado === 'armando' ? 'En armado' : 'Pendiente')
      const tdEstado = el('td')
      tdEstado.append(estado)

      tr.append(
        tdChk,
        el('td', null, p.cliente),
        el('td', null, new Date(p.creado_en).toLocaleString('es-AR', {
          day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
        })),
        el('td', 'num', String(p.lineas)),
        el('td', 'num', String(p.piezas_pedidas)),
        tdEstado
      )
      return tr
    }))
  }
  pintarSeleccion()
}

function pintarSeleccion() {
  const n = seleccion.size
  $('#resumen-seleccion').textContent =
    n ? `${n} pedido${n === 1 ? '' : 's'} seleccionado${n === 1 ? '' : 's'}` : ''
  $('#btn-imprimir').disabled = n === 0
}

$('#btn-todos').addEventListener('click', () => {
  pedidos.forEach((p) => seleccion.add(p.id))
  pintarPedidos()
})
$('#btn-ninguno').addEventListener('click', () => {
  seleccion.clear()
  pintarPedidos()
})

// ---------------------------------------------------------------- hoja de armado

function hoja(p) {
  const d = el('div', 'hoja')
  d.append(el('h3', null, p.cliente))
  d.append(el('div', 'meta',
    `Pedido #${p.id} · creado ${new Date(p.creado_en).toLocaleString('es-AR')}` +
    (p.nota ? ` · ${p.nota}` : '')))

  const tabla = document.createElement('table')
  tabla.innerHTML =
    '<thead><tr><th>Queso</th><th class="n">Piezas</th><th>Piezas armadas</th><th>Kilos</th></tr></thead>'
  const tb = document.createElement('tbody')
  for (const l of p.lineas) {
    const tr = document.createElement('tr')
    tr.append(
      el('td', null, l.queso),
      el('td', 'n', String(l.cantidad_pedida)),
      // En blanco: se completan a mano en la cámara y después se vuelcan en la tablet.
      el('td', 'anotar'),
      el('td', 'anotar')
    )
    tb.append(tr)
  }
  const total = document.createElement('tr')
  total.append(
    el('td', null, 'TOTAL'),
    el('td', 'n', String(p.piezas_pedidas)),
    el('td', 'anotar'),
    el('td', 'anotar')
  )
  tb.append(total)
  tabla.append(tb)
  d.append(tabla)

  const pie = el('div', 'pie')
  pie.append(el('div', 'firma', 'Armó'), el('div', 'firma', 'Hora'))
  d.append(pie)
  return d
}

$('#btn-imprimir').addEventListener('click', async () => {
  // Cada pedido se pide completo: la lista solo trae los totales, y la hoja necesita
  // el detalle de líneas.
  const completos = await Promise.all(
    [...seleccion].map((id) => fetch(`/api/pedidos/${id}`).then((r) => r.json()))
  )
  // En el orden en que aparecen en la tabla, no en el que se fueron tildando.
  const orden = pedidos.map((p) => p.id)
  completos.sort((a, b) => orden.indexOf(a.id) - orden.indexOf(b.id))

  // Varios pedidos por hoja es lo que se pidió; la opción fuerza uno por página para
  // cuando hay que repartir hojas sueltas a distintas personas.
  $('#hojas').classList.toggle('separadas', $('#una-por-hoja').checked)
  $('#hojas').replaceChildren(...completos.map(hoja))
  window.print()
})

// ---------------------------------------------------------------- arranque

const [clientes, catalogo] = await Promise.all([
  (await fetch('/api/clientes')).json(),
  (await fetch('/api/catalogo?sector=pedidos')).json(),
])
quesos = catalogo.quesos

$('#cliente').replaceChildren(...clientes.map((c) => {
  const o = document.createElement('option')
  o.value = c.id
  o.textContent = c.nombre
  return o
}))
$('#queso').replaceChildren(...quesos.map((q) => {
  const o = document.createElement('option')
  o.value = q.id
  o.textContent = q.nombre
  return o
}))

pintarLineas()
await cargarPedidos()
// La lista se refresca sola: el armador puede tomar un pedido mientras se está mirando.
setInterval(cargarPedidos, 10000)
