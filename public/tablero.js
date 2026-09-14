// Tablero para la pantalla LED de planta.
//
// Tres decisiones que definen esta pantalla:
//
// 1. FLUJO y STOCK no se mezclan. "Hoy se hicieron 420 piezas" se reinicia cada dia;
//    "hay 3.248 en sal" es una foto del momento. Sumarlos o ponerlos sin distinguir
//    hace que nadie sepa si un numero que bajó es bueno o malo. Cada tarjeta dice
//    cual es.
// 2. Cada numero lleva su referencia. Un "420" solo en una pared es decoracion; "420,
//    promedio 380" es informacion. Lo mismo con las etapas: al lado del stock va lo
//    que entro y salio hoy.
// 3. Si se cae la red, la pantalla NO se vacia. Se queda con el ultimo dato bueno y
//    el latido se pone rojo. Una pared en blanco no se distingue de "no se produjo
//    nada", y en planta eso genera llamados al pedo.

const $ = (s) => document.querySelector(s)
const REFRESCO = 10000
const fmt = (n) => (n ?? 0).toLocaleString('es-AR')

const COLORES_LECHE = ['var(--leche-1)', 'var(--leche-2)', 'var(--leche-3)']

// Orden canonico de los tipos de leche. El color sigue al producto, no a su posicion
// en los datos del dia: si un dia no se envasa Descremada, Largavida no puede cambiar
// de color.
let ordenLeche = []

const el = (tag, clase, texto) => {
  const n = document.createElement(tag)
  if (clase) n.className = clase
  if (texto != null) n.textContent = texto
  return n
}

// ---------------------------------------------------------------- reloj

function pintarReloj() {
  const ahora = new Date()
  $('#reloj').textContent = ahora.toLocaleTimeString('es-AR', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
  $('#fecha').textContent = ahora.toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long',
  })
}

// ---------------------------------------------------------------- lechería

function pintarLecheria(lecheria) {
  $('#pallets-total').textContent = fmt(lecheria.total)

  const marcas = [...new Set(lecheria.detalle.map((d) => d.marca))]
  const colorDe = (producto) => COLORES_LECHE[ordenLeche.indexOf(producto) % COLORES_LECHE.length]

  $('#marcas').replaceChildren(...marcas.map((marca) => {
    const filas = lecheria.detalle.filter((d) => d.marca === marca)
    const total = filas.reduce((n, f) => n + f.pallets, 0)

    const caja = el('div', 'marca-caja')
    caja.append(el('div', 'nombre', marca))

    const barra = el('div', 'barra-apilada')
    for (const producto of ordenLeche) {
      const n = filas.find((f) => f.producto === producto)?.pallets ?? 0
      if (!n) continue
      const seg = el('div', null, n)
      seg.style.background = colorDe(producto)
      seg.style.flex = String(n)
      // Debajo de cierto ancho el numero no entra: mejor un bloque de color limpio
      // que un numero cortado a la mitad.
      if (n / total < 0.12) seg.textContent = ''
      barra.append(seg)
    }
    caja.append(barra)

    const t = el('div', 'total', fmt(total))
    t.append(el('small', null, 'pallets'))
    caja.append(t)
    return caja
  }))

  // Leyenda siempre presente: con tres series la identidad no puede quedar solo en
  // el color, menos a cinco metros de distancia.
  $('#leyenda-leche').replaceChildren(...ordenLeche.map((producto) => {
    const s = el('span')
    const p = el('span', 'punto-col')
    p.style.background = colorDe(producto)
    s.append(p, document.createTextNode(producto))
    return s
  }))
}

// ---------------------------------------------------------------- circuito

function etapa({ tipo, cabeza, n, u, detalle, clase }) {
  const d = el('div', `etapa ${clase ?? ''}`)
  d.append(el('span', tipo === 'stock' ? 'tipo-stock' : 'tipo-flujo', tipo === 'stock' ? 'ahora' : 'hoy'))
  d.append(el('div', 'cabeza', cabeza))
  d.append(el('div', 'n', fmt(n)))
  d.append(el('div', 'u', u))
  const det = el('div', 'detalle')
  for (const linea of detalle.filter(Boolean)) {
    const p = el('div')
    p.innerHTML = linea
    det.append(p)
  }
  d.append(det)
  return d
}

const top = (arr, campo = 'piezas') =>
  arr.slice(0, 3).map((r) => `<b>${fmt(r[campo])}</b> ${r.queso}`).join('<br>')

function pintarCircuito(d) {
  const rendimiento = d.hoy.tinas ? Math.round(d.hoy.piezas / d.hoy.tinas) : 0
  const contraPromedio =
    d.hoy.promedio_piezas != null
      ? `promedio 14 días: <b>${fmt(d.hoy.promedio_piezas)}</b>`
      : null

  $('#circuito').replaceChildren(
    etapa({
      tipo: 'flujo', cabeza: 'Producido', n: d.hoy.piezas, u: 'piezas hoy',
      detalle: [
        `<b>${d.hoy.tinas}</b> tinas · <b>${rendimiento}</b> por tina`,
        contraPromedio,
        top(d.hoy.por_queso),
      ],
    }),
    etapa({
      tipo: 'stock', cabeza: 'Esperando sal', n: d.ahora.esperando_sal, u: 'piezas sin salar',
      clase: `stock${d.alertas.esperando_sal.length ? ' hay-alerta' : ''}`,
      detalle: [
        d.alertas.esperando_sal.length
          ? `<b>${d.alertas.esperando_sal.length}</b> ${
              d.alertas.esperando_sal.length === 1 ? 'tina demorada' : 'tinas demoradas'
            }`
          : 'al día',
      ],
    }),
    etapa({
      tipo: 'stock', cabeza: 'En saladero', n: d.ahora.en_sal, u: 'piezas en sal', clase: 'stock',
      detalle: [
        `entraron hoy <b>${fmt(d.hoy.entro_a_sal)}</b>`,
        `salieron hoy <b>${fmt(d.hoy.salio_de_sal)}</b>`,
        top(d.ahora.en_sal_por_queso),
      ],
    }),
    etapa({
      tipo: 'stock', cabeza: 'Para envasar', n: d.ahora.para_envasar, u: 'piezas en cámara de desnudo',
      clase: `stock${d.alertas.desnudo_viejo.length ? ' hay-alerta' : ''}`,
      detalle: [
        `envasados hoy <b>${fmt(d.hoy.envasado)}</b>`,
        d.ahora.a_maduracion ? `<b>${fmt(d.ahora.a_maduracion)}</b> van a maduración` : null,
        top(d.ahora.para_envasar_por_queso),
      ],
    }),
    etapa({
      tipo: 'flujo', cabeza: 'Envasado', n: d.hoy.envasado, u: 'piezas listas para vender hoy',
      detalle: [
        d.pedidos.kilos_listos
          ? `<b>${d.pedidos.kilos_listos.toFixed(1)}</b> kg esperando factura`
          : 'nada esperando factura',
      ],
    })
  )
}

// ---------------------------------------------------------------- pedidos

function pintarPedidos(p) {
  const items = [
    { n: p.pendientes, t: 'Pendientes' },
    { n: p.armando, t: 'En armado' },
    { n: p.listos, t: 'Listos para facturar', clase: 'listo' },
  ]
  $('#pedidos').replaceChildren(...items.map((i) => {
    const d = el('div', `ped ${i.clase ?? ''}`)
    d.append(el('div', 'n', fmt(i.n)), el('div', 't', i.t))
    return d
  }))
}

// ---------------------------------------------------------------- alertas

const transcurrido = (min) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h`)

function pintarAlertas(a) {
  const filas = [
    ...a.esperando_sal.map((x) => ({ ...x, que: 'sin entrar a sal' })),
    ...a.desnudo_viejo.map((x) => ({ ...x, que: 'desnudo en cámara' })),
  ].sort((x, y) => y.minutos - x.minutos).slice(0, 5)

  if (!filas.length) {
    $('#alertas').replaceChildren(el('div', 'sin-alertas', 'Nada demorado. Todo al día.'))
    return
  }

  $('#alertas').replaceChildren(...filas.map((f) => {
    const d = el('div', 'alerta-fila')
    d.append(
      el('span', 'q', `${f.queso} · ${fmt(f.piezas)} piezas`),
      el('span', null, f.que),
      el('span', 't', `hace ${transcurrido(f.minutos)}`)
    )
    return d
  }))
}

// ---------------------------------------------------------------- ciclo

let ultimoBueno = null

async function refrescar() {
  try {
    const [d, catalogo] = await Promise.all([
      (await fetch('/api/tablero')).json(),
      ordenLeche.length ? null : (await fetch('/api/catalogo')).json(),
    ])
    if (catalogo) ordenLeche = catalogo.productos.map((p) => p.nombre)

    ultimoBueno = d
    $('#latido').className = 'latido vivo'
    pintarLecheria(d.lecheria)
    pintarCircuito(d)
    pintarPedidos(d.pedidos)
    pintarAlertas(d.alertas)
  } catch {
    // Sin red se conserva lo ultimo bueno y solo cambia el latido. Vaciar la pantalla
    // haria parecer que la planta se detuvo.
    $('#latido').className = 'latido muerto'
  }
}

pintarReloj()
setInterval(pintarReloj, 1000)
refrescar()
setInterval(refrescar, REFRESCO)
