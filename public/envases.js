// Configuración de los formatos de pallet.
//
// El total se recalcula mientras se tipea, antes de guardar: así quien carga el dato
// ve enseguida si le dio 840 o 8.400 y se da cuenta del error de un cero antes de que
// quede grabado en cientos de registros.

const $ = (s) => document.querySelector(s)
const fmt = (n) => n.toLocaleString('es-AR')

const el = (tag, clase, texto) => {
  const n = document.createElement(tag)
  if (clase) n.className = clase
  if (texto != null) n.textContent = texto
  return n
}

function numero(valor, paso = '1') {
  const i = document.createElement('input')
  i.type = 'number'
  i.min = paso === '1' ? '1' : '0.001'
  i.step = paso
  i.value = valor ?? ''
  return i
}

function fila(e) {
  const tr = document.createElement('tr')

  const bultos = numero(e.bultos_por_pallet)
  const unidades = numero(e.unidades_por_bulto)
  const litros = numero(e.litros_por_unidad, '0.001')

  const total = el('div', 'resultado')
  const guardar = document.createElement('button')
  guardar.textContent = 'Guardar'
  guardar.disabled = true

  const tag = el('td')
  const pintarTag = (provisorio) =>
    tag.replaceChildren(
      provisorio ? el('span', 'tag prov', 'a confirmar') : el('span', 'tag ok', 'confirmado')
    )
  pintarTag(e.provisorio)

  function recalcular() {
    const b = Number(bultos.value)
    const u = Number(unidades.value)
    const l = Number(litros.value)
    if (b > 0 && u > 0 && l > 0) {
      total.textContent = `${fmt(Math.round(b * u * l))} L`
      total.classList.remove('vacio')
    } else {
      total.textContent = 'sin datos'
      total.classList.add('vacio')
    }
    guardar.disabled = false
  }
  for (const i of [bultos, unidades, litros]) i.oninput = recalcular

  // Pintado inicial sin habilitar el botón: todavía no cambió nada.
  total.textContent = e.litros_por_pallet ? `${fmt(e.litros_por_pallet)} L` : 'sin datos'
  if (!e.litros_por_pallet) total.classList.add('vacio')

  const uso = el('span', 'uso', e.pallets ? fmt(e.pallets) : '—')

  guardar.onclick = async () => {
    guardar.disabled = true
    const res = await fetch(`/api/envases/${e.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bultos_por_pallet: bultos.value,
        unidades_por_bulto: unidades.value,
        litros_por_unidad: litros.value,
      }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      alert(err.error ?? 'No se pudo guardar')
      guardar.disabled = false
      return
    }
    const r = await res.json()
    pintarTag(false)
    const ok = el('span', 'guardado',
      r.pallets_rellenados
        ? `guardado · ${r.pallets_rellenados} pallets completados`
        : 'guardado')
    guardar.after(ok)
    setTimeout(() => ok.remove(), 4000)
  }

  const celda = (nodo, clase) => {
    const td = el('td', clase)
    td.append(nodo)
    return td
  }

  tr.append(
    el('td', null, e.nombre),
    celda(bultos, 'num'),
    celda(unidades, 'num'),
    celda(litros, 'num'),
    celda(total, 'num'),
    celda(uso, 'num'),
    tag,
    celda(guardar)
  )
  return tr
}

// ---------------------------------------------------------------- yogur

function filaYogur(y) {
  const tr = document.createElement('tr')

  const unidades = numero(y.unidades_por_bin)
  const kilos = numero(y.kilos_por_unidad, '0.001')

  const total = el('div', 'resultado')
  const guardar = document.createElement('button')
  guardar.textContent = 'Guardar'
  guardar.disabled = true

  const tag = el('td')
  const pintarTag = (provisorio) =>
    tag.replaceChildren(
      provisorio ? el('span', 'tag prov', 'a confirmar') : el('span', 'tag ok', 'confirmado')
    )
  pintarTag(y.datos_provisorios)

  function recalcular() {
    const u = Number(unidades.value)
    const k = Number(kilos.value)
    if (u > 0 && k > 0) {
      total.textContent = `${fmt(Math.round(u * k * 100) / 100)} kg`
      total.classList.remove('vacio')
    } else {
      total.textContent = 'sin datos'
      total.classList.add('vacio')
    }
    guardar.disabled = false
  }
  for (const i of [unidades, kilos]) i.oninput = recalcular

  total.textContent = y.kilos_por_bin ? `${fmt(y.kilos_por_bin)} kg` : 'sin datos'
  if (!y.kilos_por_bin) total.classList.add('vacio')

  // Si hay cajas registradas sin kilos, se avisa: completar el peso las va a completar.
  const uso = el('span', 'uso', y.bins ? fmt(y.bins) : '—')
  if (y.bins_sin_kilos) uso.textContent += ` (${y.bins_sin_kilos} sin kilos)`

  guardar.onclick = async () => {
    guardar.disabled = true
    const res = await fetch(`/api/yogur/formato/${y.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        unidades_por_bin: unidades.value,
        kilos_por_unidad: kilos.value,
      }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      alert(err.error ?? 'No se pudo guardar')
      guardar.disabled = false
      return
    }
    const r = await res.json()
    pintarTag(!(Number(unidades.value) > 0 && Number(kilos.value) > 0))
    const ok = el('span', 'guardado',
      r.bins_rellenados ? `guardado · ${r.bins_rellenados} bins completados` : 'guardado')
    guardar.after(ok)
    setTimeout(() => ok.remove(), 4000)
  }

  const celda = (nodo, clase) => {
    const td = el('td', clase)
    td.append(nodo)
    return td
  }

  tr.append(
    el('td', null, y.nombre),
    celda(unidades, 'num'),
    celda(kilos, 'num'),
    celda(total, 'num'),
    celda(uso, 'num'),
    tag,
    celda(guardar)
  )
  return tr
}

async function cargar() {
  const { pallets, yogur } = await (await fetch('/api/envases')).json()
  $('#filas').replaceChildren(...pallets.map(fila))
  $('#filas-yogur').replaceChildren(...yogur.map(filaYogur))
}

cargar()
