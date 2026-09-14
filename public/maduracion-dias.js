// Corrección de los días de maduración. Es la pantalla que convierte los valores de
// referencia en los reales de esta planta.
//
// La columna "real medido" es la razón de ser de esto: muestra lo que efectivamente
// tardaron los lotes que ya salieron de cámara. A las pocas semanas ese número vale
// más que cualquier referencia teórica, porque incluye la cámara de ELLOS, la estación
// y su forma de trabajar. Cuando el real difiere mucho del cargado, se marca — no para
// corregir solo, sino para que alguien lo mire.

const $ = (s) => document.querySelector(s)

const el = (tag, clase, texto) => {
  const n = document.createElement(tag)
  if (clase) n.className = clase
  if (texto != null) n.textContent = texto
  return n
}

function numero(valor, deshabilitado) {
  const i = document.createElement('input')
  i.type = 'number'
  i.min = '1'
  i.max = '2000'
  i.value = valor ?? ''
  i.disabled = deshabilitado
  return i
}

function fila(q, real) {
  const tr = document.createElement('tr')
  if (!q.madura) tr.className = 'no-madura'

  const chk = document.createElement('input')
  chk.type = 'checkbox'
  chk.checked = !!q.madura
  const tdChk = el('td')
  tdChk.style.textAlign = 'center'
  tdChk.append(chk)

  const min = numero(q.dias_minimos, !q.madura)
  const opt = numero(q.dias_optimos, !q.madura)
  const max = numero(q.dias_maximos, !q.madura)

  // Destildar "madura" apaga los tres campos: un queso que no madura no puede tener
  // días, y dejarlos editables invita a cargar datos que no significan nada.
  chk.onchange = () => {
    for (const i of [min, opt, max]) i.disabled = !chk.checked
    tr.classList.toggle('no-madura', !chk.checked)
    guardar.disabled = false
  }
  for (const i of [min, opt, max]) i.oninput = () => (guardar.disabled = false)

  const tdReal = el('td')
  if (real) {
    const s = el('span', 'real')
    const b = el('b', null, `${real.promedio} días`)
    s.append(b, document.createTextNode(` · ${real.lotes} lote${real.lotes === 1 ? '' : 's'} (${real.minimo}-${real.maximo})`))
    tdReal.append(s)
    // Si lo medido se aleja más de un 25% del óptimo cargado, vale mirarlo.
    if (q.dias_optimos && Math.abs(real.promedio - q.dias_optimos) / q.dias_optimos > 0.25) {
      tdReal.append(document.createElement('br'), el('span', 'difiere', 'difiere del cargado'))
    }
  } else {
    tdReal.append(el('span', 'real', '—'))
  }

  const tdTag = el('td')
  tdTag.append(
    q.dias_provisorios
      ? el('span', 'tag prov', 'de referencia')
      : el('span', 'tag ok', 'confirmado')
  )

  const guardar = document.createElement('button')
  guardar.className = 'guardar'
  guardar.textContent = 'Guardar'
  guardar.disabled = true
  guardar.onclick = async () => {
    guardar.disabled = true
    const res = await fetch(`/api/quesos/${q.id}/dias`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        madura: chk.checked,
        dias_minimos: min.value,
        dias_optimos: opt.value,
        dias_maximos: max.value,
      }),
    })
    if (!res.ok) {
      const e = await res.json().catch(() => ({}))
      alert(e.error ?? 'No se pudo guardar')
      guardar.disabled = false
      return
    }
    tdTag.replaceChildren(el('span', 'tag ok', 'confirmado'))
    const ok = el('span', 'estado-guardado', 'guardado')
    guardar.after(ok)
    setTimeout(() => ok.remove(), 2000)
  }

  const tdMin = el('td', 'num'); tdMin.append(min)
  const tdOpt = el('td', 'num'); tdOpt.append(opt)
  const tdMax = el('td', 'num'); tdMax.append(max)
  const tdBtn = el('td'); tdBtn.append(guardar)

  tr.append(
    el('td', null, q.nombre),
    el('td', null, q.familia),
    tdChk, tdMin, tdOpt, tdMax, tdReal, tdTag, tdBtn
  )
  return tr
}

async function cargar() {
  const { quesos, reales } = await (await fetch('/api/quesos/dias')).json()
  $('#filas').replaceChildren(
    ...quesos.map((q) => fila(q, reales.find((r) => r.queso === q.nombre)))
  )
}

cargar()
