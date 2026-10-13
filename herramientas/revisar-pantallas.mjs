// Revisa lo que NO se negocia en las tablets de planta.
//
// Por que existe: los dos peores errores de este proyecto fueron visuales. Los botones
// que se veian en 13px en la tablet real (un `font:` shorthand invalido que el navegador
// descartaba entero, sin avisar) y un boton blanco sobre verde que no se leia. Ninguno
// rompio nada: el sistema andaba perfecto y la pantalla era inusable. Los dos los
// encontre mirando capturas a mano, y uno tardo semanas.
//
// Esto no opina de estetica. Chequea las cuatro cosas que en una tablet amurada a la
// pared, con un operario de guantes mirandola desde dos metros, o estan o la pantalla
// no sirve: que se lea, que se toque, que entre sin scroll, y que el color salga de la
// paleta y no de la memoria del que escribio la regla.
//
//   node herramientas/revisar-pantallas.mjs            la parte estatica, sin nada mas
//   node herramientas/revisar-pantallas.mjs --con-navegador    + lo que se ve de verdad
//
// La parte estatica no necesita servidor ni Playwright: corre siempre, en cualquier
// maquina, en un segundo. La del navegador necesita el servidor levantado y Playwright
// instalado; si falta alguno lo dice y sigue, no falla.

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.env.BASE ?? 'http://localhost:3017'
const conNavegador = process.argv.includes('--con-navegador')

const problemas = []
const falla = (donde, que, detalle) => problemas.push({ donde, que, detalle })
let revisados = 0

// ---------------------------------------------------------------- parte estatica

const css = readFileSync(join(raiz, 'public/styles.css'), 'utf8')

// El :root es la paleta. Todo lo de abajo tiene que referirse a el.
const bloqueRoot = css.match(/:root\s*\{([\s\S]*?)\}/)?.[1] ?? ''
const definidos = new Set([...bloqueRoot.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]))
const cuerpo = css.slice(css.indexOf('}', css.indexOf(':root')) + 1)

// Algunos tokens no estan en el :root porque los pone el JS sobre un elemento, y ahi
// el fallback del var() si hace falta: es el valor hasta que el JS corre. Hay que
// mirar los .js para saber la diferencia entre eso y un token que simplemente no existe.
const enTiempoDeEjecucion = new Set()
for (const f of readdirSync(join(raiz, 'public')).filter((f) => f.endsWith('.js'))) {
  const js = readFileSync(join(raiz, 'public', f), 'utf8')
  for (const m of js.matchAll(/setProperty\(\s*['"`](--[\w-]+)/g)) enTiempoDeEjecucion.add(m[1])
}

// Blanco, negro y sus alfas no son decisiones de paleta: son sombras, mascaras y texto
// sobre un relleno ya coloreado. Cualquier OTRO color literal si lo es, y escrito suelto
// se desincroniza del resto sin que nadie lo note.
const neutro = (c) => /^#(fff|ffffff|000|000000)$/i.test(c) ||
  /^rgba?\(\s*(255,\s*255,\s*255|0,\s*0,\s*0)\b/i.test(c)

const sinComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
const lineaDe = (texto, i) => texto.slice(0, i).split('\n').length

console.log('=== la hoja de estilos ===')
console.log(`  ${definidos.size} tokens en :root`)

revisados++
const literales = new Map()
for (const m of sinComentarios(cuerpo).matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)) {
  if (neutro(m[0])) continue
  const linea = lineaDe(css, css.length - cuerpo.length + m.index)
  if (!literales.has(m[0])) literales.set(m[0], [])
  literales.get(m[0]).push(linea)
}
for (const [color, lineas] of literales) {
  falla('styles.css', `color ${color} escrito suelto, no sale de la paleta`,
        `linea ${lineas.join(', ')} · ponerle un token en :root`)
}

// Un var(--x) con un --x que no existe no es un error: es el fallback silencioso.
// Asi se me colo --bien, que vive en el CSS del escritorio y nunca existio aca.
revisados++
for (const m of sinComentarios(css).matchAll(/var\(\s*(--[\w-]+)\s*(,([^()]*(\([^()]*\))?[^()]*))?\)/g)) {
  const [todo, token, , fallback] = m
  const linea = lineaDe(css, m.index)
  if (enTiempoDeEjecucion.has(token)) continue // lo pone el JS; el fallback es el valor inicial
  if (!definidos.has(token)) {
    falla('styles.css', `${token} no existe en :root`,
          `linea ${linea} · ${fallback ? `queda siempre en el fallback "${fallback.trim()}"` : 'no pinta nada'}`)
  } else if (fallback !== undefined) {
    falla('styles.css', `${todo.trim()} tiene un fallback que nunca se usa`,
          `linea ${linea} · ${token} si existe; el fallback solo puede desincronizarse`)
  }
}

// El bug de los 13px. `font: 700 26px/1.2 inherit` es invalido porque `inherit` no puede
// ser la familia adentro del shorthand, asi que el navegador tira la declaracion ENTERA
// y el boton se queda con el tamaño del body. No avisa. `font: inherit` a secas si es
// valido: ahi `inherit` es el valor completo, no la familia.
revisados++
for (const m of sinComentarios(css).matchAll(/font\s*:\s*([^;}]+)[;}]/g)) {
  const valor = m[1].trim()
  if (/^(inherit|initial|unset|revert)$/.test(valor)) continue
  if (/\b(inherit|initial|unset|revert)\s*$/.test(valor)) {
    falla('styles.css', `font: ${valor} es una declaracion invalida`,
          `linea ${lineaDe(css, m.index)} · el navegador la descarta ENTERA y el texto ` +
          'queda en el tamaño del body. Usar font-family/font-size/font-weight por separado.')
  }
}

// ---------------------------------------------------------------- parte del navegador

// Lo que se puede medir mirando el CSS termina aca: el tamaño y el contraste reales
// dependen de la cascada, de las media queries y de que fondo quedo abajo.
const PANTALLAS = [
  '/recepcion.html', '/recepcion-planilla.html', '/lecheria.html', '/yogures.html',
  '/planta.html', '/queseria.html', '/saladero.html', '/envasado.html',
  '/maduracion.html', '/pedidos.html',
]

// Medido en una tablet de 10" amurada: abajo de esto no se lee parado a dos metros,
// ni se acierta con guantes.
const TEXTO_MIN = 20
const TOQUE_MIN = 96
const CONTRASTE_MIN = 4.5
const CONTRASTE_MIN_GRANDE = 3 // >=24px, o >=18.7px en negrita

if (!conNavegador) {
  console.log('\n  (la parte del navegador no corrio: agregar --con-navegador)')
} else {
  // Playwright es CommonJS: importado desde un .mjs el named export no siempre se
  // detecta y `chromium` queda undefined SIN lanzar. Por eso se busca tambien en
  // .default, y por eso el chequeo de abajo mira el valor y no si hubo excepcion.
  const traer = async (especificador) => {
    const m = await import(especificador)
    return m.chromium ?? m.default?.chromium
  }
  let chromium
  try {
    chromium = await traer('playwright')
  } catch { /* no esta en el proyecto; se prueba afuera */ }
  // No es dependencia del proyecto: baja un navegador entero y solo sirve para esto.
  // Si lo tenes instalado en otro lado, PLAYWRIGHT_DESDE=<carpeta con node_modules>.
  if (!chromium && process.env.PLAYWRIGHT_DESDE) {
    try {
      const { createRequire } = await import('node:module')
      const { pathToFileURL } = await import('node:url')
      const desde = createRequire(join(process.env.PLAYWRIGHT_DESDE, 'nada.js'))
      chromium = await traer(pathToFileURL(desde.resolve('playwright')).href)
    } catch { /* tampoco; lo dice abajo */ }
  }

  const vivo = chromium ? await fetch(BASE).then((r) => r.ok).catch(() => false) : false
  if (!chromium) {
    console.log('\n  SALTEADA la parte del navegador: falta Playwright' +
                ' (npm i -D playwright, o PLAYWRIGHT_DESDE=<carpeta>)')
  } else if (!vivo) {
    console.log(`\n  SALTEADA la parte del navegador: no hay nadie en ${BASE}` +
                ' (npm start, o BASE=<url>)')
  }

  if (chromium && vivo) {
    const navegador = await chromium.launch()
    // El tamaño de las tablets de planta. Medir en otro no sirve de nada: el bug de
    // los 13px solo se veia arriba de 620px de ancho, por eso las capturas en el
    // celular salian bien y la tablet no.
    const ctx = await navegador.newContext({ viewport: { width: 1280, height: 800 }, locale: 'es-AR' })

    for (const ruta of PANTALLAS) {
      const p = await ctx.newPage()
      try {
        await p.goto(BASE + ruta, { waitUntil: 'networkidle', timeout: 15000 })
        await p.waitForTimeout(600)
        const hallazgos = await p.evaluate(medirLaPantalla, { TEXTO_MIN, TOQUE_MIN, CONTRASTE_MIN, CONTRASTE_MIN_GRANDE })
        revisados += 4
        for (const h of hallazgos) falla(ruta, h.que, h.detalle)
        console.log(`  ${hallazgos.length ? 'X' : 'ok'}  ${ruta}`)
      } catch (e) {
        falla(ruta, 'no se pudo abrir', e.message.split('\n')[0])
      }
      await p.close()
    }
    await navegador.close()
  }
}

// Corre dentro de la pagina. Todo lo que mide sale de getComputedStyle y de la
// geometria real, no del CSS: es la unica forma de ver lo que ve el operario.
function medirLaPantalla({ TEXTO_MIN, TOQUE_MIN, CONTRASTE_MIN, CONTRASTE_MIN_GRANDE }) {
  const hallazgos = []
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
  }
  const comoRgb = (c) => (c.match(/[\d.]+/g) ?? []).map(Number)
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const contraste = (a, b) => {
    const [x, y] = [lum(a), lum(b)]
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
  }
  // El fondo de un elemento casi nunca esta en el elemento: hay que subir hasta
  // encontrar uno que no sea transparente.
  const fondoReal = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const c = comoRgb(getComputedStyle(n).backgroundColor)
      if (c.length >= 3 && (c[3] === undefined || c[3] > 0.5)) return c.slice(0, 3)
    }
    return comoRgb(getComputedStyle(document.body).backgroundColor).slice(0, 3)
  }
  const nombrar = (el) => {
    const t = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 24)
    return `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).trim().split(/\s+/).join('.') : ''}` +
           (t ? ` "${t}"` : '')
  }

  // 1 y 2. Lo tocable: alto suficiente para el dedo con guante, texto suficiente para
  // leerlo parado. El elemento chico que NO es un boton no entra; la regla es sobre
  // lo que el operario tiene que acertar y leer.
  const tocables = [...document.querySelectorAll('button, .opcion, .celda, .tecla, [role="button"], a.card')]
    .filter((el) => visible(el) && !el.closest('[hidden]') && !el.disabled)
  for (const el of tocables) {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    const px = parseFloat(cs.fontSize)
    // Los chiquitos de servicio (volver, inicio, el estado de red) no cargan datos:
    // si se erra uno no se pierde nada, solo se vuelve a tocar.
    const servicio = /volver|inicio|estado|chip|btn-fecha|borrar/.test(String(el.className) + el.id)
    if (!servicio && r.height < TOQUE_MIN) {
      hallazgos.push({ que: `${nombrar(el)} mide ${Math.round(r.height)}px de alto`,
                       detalle: `abajo de ${TOQUE_MIN}px no se acierta con guantes` })
    }
    if (px < TEXTO_MIN) {
      hallazgos.push({ que: `${nombrar(el)} tiene el texto en ${px}px`,
                       detalle: `abajo de ${TEXTO_MIN}px no se lee a dos metros` +
                                (px < 15 ? ' — ojo, este es el tamaño del body: puede ser una declaracion descartada' : '') })
    }
  }

  // 3. Que el texto se lea contra el fondo que de verdad le quedo abajo.
  const conTexto = [...document.querySelectorAll('body *')].filter(
    (el) => visible(el) && !el.closest('[hidden]') &&
            [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
  const yaDicho = new Set()
  for (const el of conTexto) {
    const cs = getComputedStyle(el)
    const px = parseFloat(cs.fontSize)
    const grande = px >= 24 || (px >= 18.66 && parseInt(cs.fontWeight, 10) >= 700)
    const minimo = grande ? CONTRASTE_MIN_GRANDE : CONTRASTE_MIN
    const k = contraste(comoRgb(cs.color).slice(0, 3), fondoReal(el))
    const clave = cs.color + '|' + nombrar(el).split(' "')[0]
    if (k < minimo && !yaDicho.has(clave)) {
      yaDicho.add(clave)
      hallazgos.push({ que: `${nombrar(el)} contrasta ${k.toFixed(2)}:1`,
                       detalle: `hace falta ${minimo}:1 para ${px}px` })
    }
  }

  // 4. La regla dura de estas pantallas: no se scrollea nunca. Lo que queda abajo del
  // borde no existe — nadie va a descubrir que habia algo mas.
  for (const el of [document.documentElement, ...document.querySelectorAll('body > *')]) {
    if (!visible(el)) continue
    const cs = getComputedStyle(el)
    if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') continue // lista, a proposito
    if (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2) {
      hallazgos.push({ que: `${nombrar(el)} desborda`,
                       detalle: `${el.scrollWidth}x${el.scrollHeight} adentro de ${el.clientWidth}x${el.clientHeight}` })
    }
  }
  return hallazgos
}

// ---------------------------------------------------------------- el resultado

console.log()
if (!problemas.length) {
  console.log(`sin problemas (${revisados} chequeos)`)
  process.exit(0)
}
let donde = null
for (const p of problemas) {
  if (p.donde !== donde) { console.log(`\n${donde = p.donde}`); }
  console.log(`  · ${p.que}\n      ${p.detalle}`)
}
console.log(`\n${problemas.length} ${problemas.length === 1 ? 'problema' : 'problemas'}`)
process.exit(1)
