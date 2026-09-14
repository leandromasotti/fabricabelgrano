// Reportes de produccion. Graficos en SVG inline, sin librerias.
//
// Criterio de forma (no es estetico, define que se entiende):
//  - produccion por dia  -> tendencia en el tiempo, una sola serie  -> columnas, un solo tono
//  - produccion por queso -> comparar magnitudes ordenadas          -> barras horizontales, un solo tono
//  - pallets por marca   -> tres tipos de leche que hay que distinguir -> apiladas, 3 hues categoricos
//  - rendimiento por tina -> 17 categorias con varias medidas c/u    -> tabla, no grafico

const $ = (s) => document.querySelector(s)
const fmt = (n) => (n ?? 0).toLocaleString('es-AR')
const hoy = () => new Date().toLocaleDateString('sv-SE')
const diasAtras = (n) => new Date(Date.now() - n * 864e5).toLocaleDateString('sv-SE')
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim()

const SVG = 'http://www.w3.org/2000/svg'
const el = (tag, attrs = {}, texto) => {
  const n = document.createElementNS(SVG, tag)
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v)
  if (texto != null) n.textContent = texto
  return n
}

// ---------------------------------------------------------------- tooltip

const tip = $('#tip')
function conTooltip(nodo, html) {
  nodo.addEventListener('pointerenter', (e) => {
    tip.innerHTML = html
    tip.style.opacity = '1'
    mover(e)
  })
  nodo.addEventListener('pointermove', mover)
  nodo.addEventListener('pointerleave', () => (tip.style.opacity = '0'))
}
function mover(e) {
  const m = 14
  const r = tip.getBoundingClientRect()
  let x = e.clientX + m
  let y = e.clientY + m
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - m
  if (y + r.height > innerHeight - 8) y = e.clientY - r.height - m
  tip.style.left = `${x}px`
  tip.style.top = `${y}px`
}

// ---------------------------------------------------------------- por dia

function graficoDias(dias) {
  const svg = $('#g-dias')
  svg.replaceChildren()

  const anchoCol = Math.max(14, Math.min(40, Math.floor(980 / Math.max(dias.length, 1))))
  const m = { t: 12, d: 14, b: 34, i: 48 }
  const W = m.i + dias.length * anchoCol + m.d
  const H = 230
  const alto = H - m.t - m.b
  svg.setAttribute('width', W)
  svg.setAttribute('height', H)
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`)

  const max = Math.max(...dias.map((d) => d.piezas), 1)
  const escala = (v) => alto - (v / max) * alto

  // Grilla recesiva: 4 lineas, siempre por detras de las barras.
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i
    const y = m.t + escala(v)
    svg.append(
      el('line', { x1: m.i, x2: W - m.d, y1: y, y2: y, stroke: css('--grid'), 'stroke-width': 1 }),
      el('text', {
        x: m.i - 8, y: y + 4, 'text-anchor': 'end',
        fill: css('--ink-muted'), 'font-size': 11,
      }, Math.round(v))
    )
  }

  const color = css('--secuencial')
  dias.forEach((d, i) => {
    const x = m.i + i * anchoCol
    const h = alto - escala(d.piezas)
    const g = el('g')

    // Un dia sin produccion deja una marca al ras del eje. Sin esto, un domingo y un
    // dia fuera del historial se ven igual: ausencia total de barra.
    if (d.piezas === 0) {
      g.append(el('rect', {
        x: x + 1, y: m.t + alto - 2, width: anchoCol - 2, height: 2,
        fill: css('--tenue'),
      }))
    }

    if (d.piezas > 0) {
      // 2px de separacion entre barras y esquinas superiores redondeadas de 4px.
      g.append(el('rect', {
        x: x + 1, y: m.t + escala(d.piezas), width: anchoCol - 2, height: Math.max(h, 1),
        fill: color, rx: 4, ry: 4,
      }))
      // La base del rect redondeado se "apoya" en el eje con un segundo rect recto.
      if (h > 4) {
        g.append(el('rect', {
          x: x + 1, y: m.t + alto - 4, width: anchoCol - 2, height: 4, fill: color,
        }))
      }
    }

    // Area de hover mas grande que la barra, para que no haya que apuntar fino.
    const hit = el('rect', { x, y: m.t, width: anchoCol, height: alto, fill: 'transparent' })
    const f = new Date(d.fecha + 'T00:00')
    conTooltip(hit, `<b>${f.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })}</b><br>
      ${fmt(d.piezas)} piezas · ${d.tinas} tina${d.tinas === 1 ? '' : 's'}<br>
      ${fmt(d.pallets)} pallets de leche`)
    g.append(hit)
    svg.append(g)

    // Etiquetas de eje selectivas: cada N dias, nunca todas.
    const cada = Math.ceil(dias.length / 12)
    if (i % cada === 0) {
      svg.append(el('text', {
        x: x + anchoCol / 2, y: H - 12, 'text-anchor': 'middle',
        fill: css('--ink-muted'), 'font-size': 11,
      }, f.toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric' })))
    }
  })

  svg.append(el('line', {
    x1: m.i, x2: W - m.d, y1: m.t + alto, y2: m.t + alto,
    stroke: css('--axis'), 'stroke-width': 1,
  }))
}

// ---------------------------------------------------------------- por queso

function graficoQuesos(rend) {
  const cont = $('#g-quesos')
  cont.replaceChildren()
  if (!rend.length) return cont.append(vacio('Sin producción en el período.'))

  const datos = rend.slice(0, 10)
  const max = Math.max(...datos.map((d) => d.piezas))
  const filaH = 30
  const W = 460
  const etiqueta = 128
  const valor = 56
  const H = datos.length * filaH + 6

  const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img' })
  svg.setAttribute('aria-label', 'Piezas producidas por tipo de queso')
  const ancho = W - etiqueta - valor
  const color = css('--secuencial')

  datos.forEach((d, i) => {
    const y = i * filaH + 4
    const w = Math.max((d.piezas / max) * ancho, 2)
    const g = el('g')
    g.append(
      el('text', { x: etiqueta - 10, y: y + 15, 'text-anchor': 'end', fill: css('--ink-2'), 'font-size': 13 }, d.queso),
      el('rect', { x: etiqueta, y: y + 3, width: w, height: 16, fill: color, rx: 4, ry: 4 }),
      // Etiqueta directa del valor: el skill la exige como relief del contraste.
      el('text', { x: etiqueta + w + 8, y: y + 16, fill: css('--ink-2'), 'font-size': 12.5 }, fmt(d.piezas))
    )
    const hit = el('rect', { x: 0, y, width: W, height: filaH, fill: 'transparent' })
    conTooltip(hit, `<b>${d.queso}</b><br>${fmt(d.piezas)} piezas en ${d.tinas} tinas<br>promedio ${d.promedio} por tina`)
    g.append(hit)
    svg.append(g)
  })
  cont.append(svg)
  if (rend.length > 10) {
    const p = document.createElement('p')
    p.className = 'variacion'
    p.textContent = `Se muestran los 10 primeros de ${rend.length}. El resto está en la tabla de rendimiento.`
    cont.append(p)
  }
}

// ---------------------------------------------------------------- lecheria

function graficoLecheria(filas, canonicos) {
  const cont = $('#g-lecheria')
  const leyenda = $('#leyenda-leche')
  cont.replaceChildren()
  leyenda.replaceChildren()
  if (!filas.length) return cont.append(vacio('Sin pallets en el período.'))

  const colores = [css('--serie-1'), css('--serie-2'), css('--serie-3')]
  // El color se ata al producto por su posicion en el catalogo, NO por el orden en
  // que aparece en los datos filtrados. Cambiar el rango de fechas no puede repintar
  // las series: si "azul" significa Entera en una vista y Largavida en otra, comparar
  // dos periodos induce a error.
  const colorDe = (p) => colores[canonicos.indexOf(p) % colores.length]

  // Se listan en orden canonico, y solo los que tienen datos en este rango.
  const productos = canonicos.filter((p) => filas.some((f) => f.producto === p))

  // Leyenda: con 2 o mas series es obligatoria, la identidad nunca queda solo en el color.
  productos.forEach((p) => {
    const s = document.createElement('span')
    const sw = document.createElement('span')
    sw.className = 'swatch'
    sw.style.background = colorDe(p)
    s.append(sw, document.createTextNode(p))
    leyenda.append(s)
  })

  const marcas = [...new Set(filas.map((f) => f.marca))].map((marca) => ({
    marca,
    total: filas.filter((f) => f.marca === marca).reduce((n, f) => n + f.pallets, 0),
    partes: productos
      .map((p) => ({ p, n: filas.find((f) => f.marca === marca && f.producto === p)?.pallets ?? 0 }))
      .filter((x) => x.n > 0),
  })).sort((a, b) => b.total - a.total)

  const max = Math.max(...marcas.map((m) => m.total))
  const filaH = 46
  const W = 460
  const etiqueta = 128
  const valor = 44
  const H = marcas.length * filaH + 4
  const ancho = W - etiqueta - valor

  const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img' })
  svg.setAttribute('aria-label', 'Pallets de leche por marca y tipo')

  marcas.forEach((m, i) => {
    const y = i * filaH + 8
    svg.append(el('text', {
      x: etiqueta - 10, y: y + 17, 'text-anchor': 'end', fill: css('--ink-2'), 'font-size': 13,
    }, m.marca))

    let x = etiqueta
    m.partes.forEach(({ p, n }) => {
      const w = (n / max) * ancho
      const seg = el('rect', { x, y: y + 4, width: Math.max(w - 2, 1), height: 22, fill: colorDe(p), rx: 3, ry: 3 })
      conTooltip(seg, `<b>${m.marca}</b><br>${p}: ${fmt(n)} pallets`)
      svg.append(seg)
      // Etiqueta directa dentro del segmento cuando entra: identidad sin depender del color.
      if (w > 42) {
        svg.append(el('text', {
          x: x + w / 2 - 1, y: y + 19, 'text-anchor': 'middle',
          fill: '#fff', 'font-size': 11.5, 'font-weight': 600,
        }, n))
      }
      x += w
    })

    svg.append(el('text', {
      x: x + 8, y: y + 20, fill: css('--ink-2'), 'font-size': 12.5,
    }, fmt(m.total)))
  })
  cont.append(svg)
}

// ---------------------------------------------------------------- tablas

function vacio(txt) {
  const d = document.createElement('div')
  d.className = 'vacio'
  d.textContent = txt
  return d
}

function tabla(nodo, columnas, filas, sinDatos) {
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
  columnas.forEach((c) => {
    const th = document.createElement('th')
    th.textContent = c.t
    if (c.num) th.className = 'num'
    tr.append(th)
  })
  thead.append(tr)

  const tbody = document.createElement('tbody')
  filas.forEach((f) => {
    const tr = document.createElement('tr')
    columnas.forEach((c) => {
      const td = document.createElement('td')
      if (c.num) td.className = 'num'
      const v = c.v(f)
      if (v instanceof Node) td.append(v)
      else td.textContent = v
      tr.append(td)
    })
    tbody.append(tr)
  })
  nodo.append(thead, tbody)
}

// ---------------------------------------------------------------- KPIs

function pintarKpis(r) {
  const promedio = r.tinas ? Math.round(r.piezas / r.tinas) : 0
  const horas = r.minutos_a_sal != null ? (r.minutos_a_sal / 60).toFixed(1) : null

  const items = [
    { v: fmt(r.piezas), t: 'Piezas producidas' },
    { v: fmt(r.tinas), t: 'Tinas' },
    { v: fmt(promedio), t: 'Piezas por tina', n: 'promedio del período' },
    { v: fmt(r.pallets), t: 'Pallets de leche' },
    { v: fmt(r.en_sal), t: 'En sal ahora', n: 'no depende del período' },
    {
      v: horas != null ? `${horas} h` : '—',
      t: 'Producción → sal',
      // Mediana y no promedio: una tina marcada al otro dia vale miles de minutos
      // y desplaza el promedio, pero no mueve la mediana.
      n: horas == null
        ? 'sin datos todavía'
        : `mediana de ${r.muestras_a_sal} tinas` +
          (r.tardias ? ` · ${r.tardias} marcada${r.tardias === 1 ? '' : 's'} +12 h tarde` : ''),
    },
  ]

  $('#kpis').replaceChildren(
    ...items.map((i) => {
      const d = document.createElement('div')
      d.className = 'kpi'
      const v = document.createElement('div')
      v.className = 'v'
      v.textContent = i.v
      const t = document.createElement('div')
      t.className = 't'
      t.textContent = i.t
      d.append(v, t)
      if (i.n) {
        const n = document.createElement('div')
        n.className = 'n'
        n.textContent = i.n
        d.append(n)
      }
      return d
    })
  )
}

// ---------------------------------------------------------------- carga

let quesosCargados = false

async function cargar() {
  const q = new URLSearchParams({
    desde: $('#desde').value,
    hasta: $('#hasta').value,
    queso: $('#queso').value,
  })
  const d = await (await fetch(`/api/reportes?${q}`)).json()

  $('#rango-txt').textContent =
    `${new Date(d.desde + 'T00:00').toLocaleDateString('es-AR')} al ${new Date(d.hasta + 'T00:00').toLocaleDateString('es-AR')}`

  if (!quesosCargados) {
    const sel = $('#queso')
    for (const r of d.rendimiento) {
      const o = document.createElement('option')
      o.value = o.textContent = r.queso
      sel.append(o)
    }
    quesosCargados = true
  }

  pintarKpis(d.resumen)
  graficoDias(d.dias)
  graficoQuesos(d.rendimiento)
  graficoLecheria(d.lecheria, d.productos ?? [])

  tabla($('#t-rendimiento'), [
    { t: 'Queso', v: (r) => r.queso },
    { t: 'Familia', v: (r) => {
        const s = document.createElement('span')
        s.className = 'tag'
        s.textContent = r.familia
        return s
      } },
    { t: 'Tinas', num: true, v: (r) => fmt(r.tinas) },
    { t: 'Piezas', num: true, v: (r) => fmt(r.piezas) },
    { t: 'Promedio', num: true, v: (r) => r.promedio },
    { t: 'Mínimo', num: true, v: (r) => r.minimo },
    { t: 'Máximo', num: true, v: (r) => r.maximo },
    { t: 'Variación', num: true, v: (r) => (r.tinas > 1 ? `± ${r.maximo - r.minimo}` : '—') },
  ], d.rendimiento, 'Sin producción en el período.')

  tabla($('#t-detalle'), [
    { t: 'Fecha', v: (r) => new Date(r.fecha_hora).toLocaleDateString('es-AR') },
    { t: 'Hora', v: (r) => new Date(r.fecha_hora).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }) },
    { t: 'Queso', v: (r) => r.queso },
    { t: 'Piezas', num: true, v: (r) => fmt(r.cantidad) },
    { t: 'Operario', v: (r) => r.operario },
    { t: '', v: (r) => {
        if (r.origen !== 'offline') return ''
        const s = document.createElement('span')
        s.className = 'tag'
        s.textContent = 'offline'
        return s
      } },
  ], d.detalle, 'Sin registros con estos filtros.')
}

// ---------------------------------------------------------------- filtros

function preset(dias) {
  $('#desde').value = diasAtras(dias - 1)
  $('#hasta').value = hoy()
  document.querySelectorAll('.preset').forEach((b) =>
    b.setAttribute('aria-pressed', String(Number(b.dataset.dias) === dias))
  )
  cargar()
}

document.querySelectorAll('.preset').forEach((b) =>
  b.addEventListener('click', () => preset(Number(b.dataset.dias)))
)

for (const id of ['#desde', '#hasta', '#queso']) {
  $(id).addEventListener('change', () => {
    if (id !== '#queso') document.querySelectorAll('.preset').forEach((b) => b.setAttribute('aria-pressed', 'false'))
    cargar()
  })
}

$('#btn-csv').addEventListener('click', () => {
  const q = new URLSearchParams({
    desde: $('#desde').value, hasta: $('#hasta').value, queso: $('#queso').value,
  })
  window.location = `/api/reportes.csv?${q}`
})

// Al repintar por cambio de tema, los colores salen de las variables CSS.
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', cargar)

preset(30)
