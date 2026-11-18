// Litros por tambo. Este reporte es el que reemplaza trabajo de verdad: hoy el pago a
// cada tambo se calcula sumando las cantidades a mano.
//
// La pantalla de carga solo mueve el tipeo de lugar; esto hace desaparecer la suma.

const $ = (s) => document.querySelector(s)
const fmt = (n) => (n ?? 0).toLocaleString('es-AR')
const hoy = () => new Date().toLocaleDateString('sv-SE')
const diasAtras = (n) => new Date(Date.now() - n * 864e5).toLocaleDateString('sv-SE')
const fecha = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('es-AR')
const grados = (t) => (t == null ? '—' : `${t.toFixed(1).replace('.', ',')} °C`)

// Umbral provisorio: la leche tiene que llegar fría y por encima de esto conviene
// mirarla. Falta el límite real de la fábrica.
const TEMP_ALTA = 8

const el = (tag, clase, texto) => {
  const n = document.createElement(tag)
  if (clase) n.className = clase
  if (texto != null) n.textContent = texto
  return n
}

function tabla(nodo, columnas, filas, pie, sinDatos) {
  nodo.replaceChildren()
  if (!filas.length) {
    const cap = document.createElement('caption')
    cap.className = 'vacio'
    cap.textContent = sinDatos
    nodo.append(cap)
    return
  }
  const thead = document.createElement('thead')
  const tr = document.createElement('tr')
  for (const c of columnas) {
    const th = el('th', c.num ? 'num' : null, c.t)
    tr.append(th)
  }
  thead.append(tr)

  const tbody = document.createElement('tbody')
  for (const f of filas) {
    const fila = document.createElement('tr')
    for (const c of columnas) {
      const td = el('td', c.num ? 'num' : null)
      const v = c.v(f)
      if (v instanceof Node) td.append(v)
      else td.textContent = v
      if (c.clase) td.classList.add(...c.clase(f).split(' ').filter(Boolean))
      fila.append(td)
    }
    tbody.append(fila)
  }
  nodo.append(thead, tbody)

  if (pie) {
    const tfoot = document.createElement('tfoot')
    const tr = document.createElement('tr')
    for (const celda of pie) tr.append(el('td', celda.num ? 'num' : null, celda.t))
    tfoot.append(tr)
    nodo.append(tfoot)
  }
}

// ---------------------------------------------------------------- cargar

let tambosCargados = false

async function cargar() {
  const q = new URLSearchParams({
    desde: $('#desde').value,
    hasta: $('#hasta').value,
    tambo: $('#tambo').value,
  })
  const d = await (await fetch(`/api/recepciones/reporte?${q}`)).json()

  const rango = `${fecha(d.desde)} al ${fecha(d.hasta)}`
  $('#rango-txt').textContent = rango
  $('#pie-impresion').textContent =
    `Período ${rango} · emitido el ${new Date().toLocaleString('es-AR')}`

  if (!tambosCargados) {
    const sel = $('#tambo')
    for (const t of d.por_tambo) {
      const o = document.createElement('option')
      o.value = o.textContent = t.tambo
      sel.append(o)
    }
    tambosCargados = true
  }

  const dias = d.por_dia.length || 1
  const kpis = [
    { v: fmt(d.total.litros), t: 'Litros recibidos' },
    { v: fmt(d.total.entregas), t: 'Entregas' },
    { v: fmt(d.total.tambos), t: 'Tambos' },
    { v: fmt(Math.round(d.total.litros / dias)), t: 'Litros por día' },
  ]
  $('#kpis').replaceChildren(...kpis.map((k) => {
    const c = el('div', 'kpi')
    c.append(el('div', 'v', k.v), el('div', 't', k.t))
    return c
  }))

  tabla($('#t-tambos'), [
    { t: 'Tambo', v: (r) => (r.nombre ? `${r.tambo} · ${r.nombre}` : String(r.tambo)) },
    { t: 'Entregas', num: true, v: (r) => fmt(r.entregas) },
    { t: 'Litros', num: true, v: (r) => fmt(r.litros) },
    { t: 'Promedio', num: true, v: (r) => fmt(Math.round(r.litros / r.entregas)) },
    { t: 'Temp. prom.', num: true, v: (r) => grados(r.temp_promedio) },
    // La máxima es la que importa para calidad: un promedio tibio esconde un pico.
    { t: 'Temp. máx.', num: true, v: (r) => grados(r.temp_maxima),
      clase: (r) => (r.temp_maxima > TEMP_ALTA ? 'caliente' : '') },
    { t: 'Última entrega', v: (r) => fecha(r.ultima) },
  ], d.por_tambo, [
    { t: 'TOTAL' },
    { t: fmt(d.total.entregas), num: true },
    { t: fmt(d.total.litros), num: true },
    { t: '', num: true }, { t: '', num: true }, { t: '', num: true }, { t: '' },
  ], 'Sin recepciones en el período.')

  tabla($('#t-detalle'), [
    { t: 'Fecha', v: (r) => new Date(r.fecha_hora).toLocaleDateString('es-AR') },
    { t: 'Hora', v: (r) => new Date(r.fecha_hora).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }) },
    { t: 'Tambo', v: (r) => String(r.tambo) },
    { t: 'Litros', num: true, v: (r) => fmt(r.litros) },
    { t: 'Temp.', num: true, v: (r) => grados(r.temperatura),
      clase: (r) => (r.temperatura > TEMP_ALTA ? 'caliente' : '') },
    { t: 'Operario', v: (r) => r.operario },
  ], d.detalle, null, 'Sin entregas con estos filtros.')
}

// ---------------------------------------------------------------- filtros

function preset(dias) {
  $('#desde').value = diasAtras(dias - 1)
  $('#hasta').value = hoy()
  cargar()
}

document.querySelectorAll('.preset').forEach((b) =>
  b.addEventListener('click', () => preset(Number(b.dataset.dias)))
)
for (const id of ['#desde', '#hasta', '#tambo']) {
  $(id).addEventListener('change', cargar)
}
$('#btn-csv').addEventListener('click', () => {
  const q = new URLSearchParams({
    desde: $('#desde').value, hasta: $('#hasta').value, tambo: $('#tambo').value,
  })
  window.location = `/api/recepciones.csv?${q}`
})
$('#btn-imprimir').addEventListener('click', () => window.print())

preset(30)
