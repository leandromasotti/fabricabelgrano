// Producción de yogures. Tablet separada de la de leches, como se acordó con el
// cliente: son dos puestos distintos y mezclarlos obligaría a elegir "leche o yogur"
// en cada registro, un toque de más todo el día para nada.
//
// Se registra POR PALLET DE CAJAS, igual que la leche:
//
//   "Ya no sale el bin, sino que vas armando el pallet, directamente ya lo marcás como
//    pallet de yogurt, pero las cajas de yogurt son por 15 unidades, así que también lo
//    puedo marcar como hago con la leche."  [Alexis, audio 2026-11-06]
//
// El BIN sigue estando ("por el momento sigue apareciendo pero cada vez menos. Tendría
// que estar igual la opción") y los POTES siguen contándose en cajas sueltas. Son tres
// formas de medir la misma producción y el operario elige una en cada carga: por eso hay
// un paso de formato, que es el mismo concepto que el envase de lechería.
//
// LA DIFERENCIA DE FONDO ENTRE PALLET Y BIN NO ES EL TAMAÑO, ES CÓMO SE SABE EL NÚMERO.
// Las cajas de un pallet se CUENTAN; lo que hay adentro de un bin se mira y se ESTIMA.
// Por eso un pallet corto se corrige diciendo cuántas cajas entraron, y un bin a medias
// diciendo "la mitad" — y por eso el cambio de Alexis no es solo más prolijo, es más
// exacto: reemplaza una estimación por una cuenta.
//
// LOS DERIVADOS DEL BIN SIGUEN SIENDO ESTIMACIONES y se muestran con "≈". Los del pallet
// no lo son, pero se muestran igual para no tener dos estilos de número en la misma
// pantalla; el "≈" acá se lee como "equivale a", que es lo que es.
//
// Solo dos sabores (vainilla y frutilla) y dos marcas: Obenac no hace yogur. El
// catálogo ya viene filtrado por el servidor, así que acá no hay ninguna regla escrita
// a mano.

import {
  $, hhmm, cola, red, horaServidor, pintarEstado, postear, sincronizar,
  cargarCatalogo, configurarTablet, botones, hacerPasos, pintarMigas, cuentaRegresiva, registrarSW,
  configurarVuelta,
  pintarDesglose, sumarDesglose,
} from '/comun.js'

const VENTANA_DESHACER = 60

// Lo que el operario puede decir mirando un bin. Cuatro opciones y no un numero: nadie
// distingue 60 de 65 a ojo, y pedirle precision que no tiene solo disfraza de medido un
// numero que sigue siendo estimado.
const LLENADOS = [100, 75, 50, 25]
const COMO_SE_DICE = { 100: 'Lleno', 75: 'Tres cuartos', 50: 'La mitad', 25: 'Un cuarto' }

const est = {
  operario: null, marca: null, producto: null, envase: null, ultimo: null, timer: null,
  // Lo que se esta tecleando en el paso de cajas (solo potes).
  cajasStr: '',
  // Lo que se esta tecleando al corregir un pallet que no se completo.
  ajusteStr: '',
  // El llenado elegido mientras se corrige un bin, antes de saber el motivo.
  llenadoElegido: null,
  // Que se esta corrigiendo cuando se pide el motivo: 'llenado' (bin) o 'bultos' (pallet).
  corrigiendo: null,
}
// 'ajustar' va a pantalla completa por lo mismo que en lecheria: el teclado numerico no
// entra junto con el historial, y ademas es un momento de foco.
const mostrar = hacerPasos(
  ['operario', 'marca', 'producto', 'envase', 'cajas', 'ajustar', 'llenado', 'motivo', 'listo'],
  ['cajas', 'ajustar'],
)

const esPote = (p) => p?.presentacion === 'caja'
// El bin es el formato de UN solo bulto. No hace falta un flag: un pallet tiene muchas
// cajas y un bin es un recipiente solo, y eso ya esta en los numeros del formato.
const esBin = (e) => e?.bultos_por_pallet === 1

function irA(paso) {
  mostrar(paso)
  $('btn-reiniciar').hidden = paso === 'operario'
  pintarMigas([est.operario?.nombre, est.marca?.nombre, est.producto?.nombre, est.envase?.nombre])
}

// Vuelve a pedir el operario POR DEFECTO.
//
// Las tablets son puestos compartidos colgados de la pared: si el nombre queda elegido
// despues de registrar, el siguiente que pasa carga a nombre del anterior sin enterarse.
// Reportado desde la planta el 2026-09-24.
//
// El default es el comportamiento seguro a proposito: un llamador nuevo que se olvide de
// pasar el parametro vuelve a preguntar el nombre, que es el error barato. La unica
// excepcion es el DESHACER, que pasa `true` porque ahi es la misma persona corrigiendo
// lo que acaba de cargar.
function reiniciar(conservarOperario = false) {
  clearInterval(est.timer)
  est.marca = null
  est.producto = null
  est.envase = null
  est.cajasStr = ''
  est.ajusteStr = ''
  est.llenadoElegido = null
  est.corrigiendo = null
  if (!conservarOperario) est.operario = null
  irA(est.operario ? 'marca' : 'operario')
}

// Que sabores ve esta marca.
//
// Los potes los hace una sola marca, asi que la lista de productos depende de cual se
// eligio. Se pinta en cada paso y no una vez al arrancar: con una lista fija, Central
// Lechera veria potes que no produce y el servidor se los rechazaria despues.
function pintarProductos() {
  const suyos = catalogo.productos.filter(
    (p) => p.marca_id == null || Number(p.marca_id) === Number(est.marca.id),
  )
  botones($('op-productos'), suyos, (p) => {
    est.producto = p
    if (esPote(p)) {
      est.cajasStr = ''
      pintarCajas()
      return irA('cajas')
    }
    pintarEnvases()
    // Con un solo formato no se pregunta: un paso con una sola respuesta no es una
    // pregunta, es un toque de mas. Mismo criterio que el resto de las pantallas.
    if (formatosDeLaMarca().length === 1) {
      est.envase = formatosDeLaMarca()[0]
      return registrar()
    }
    irA('envase')
  })
}

// Los formatos de yogur que puede usar esta marca.
//
// La caja es de 15 unidades de 1 kg en Lácteos Belgrano y de 16 de 900 g en Central
// Lechera, así que no es un formato con variantes: son dos formatos, cada uno de su
// marca. El bin no tiene marca y lo usan las dos.
function formatosDeLaMarca() {
  return (catalogo.envases ?? []).filter(
    (e) =>
      e.familia === 'yogur' &&
      (e.marca_id == null || Number(e.marca_id) === Number(est.marca?.id)),
  )
}

function pintarEnvases() {
  botones(
    $('op-envases'),
    formatosDeLaMarca(),
    (e) => {
      est.envase = e
      registrar()
    },
    // Debajo del nombre, cuánto es: es el número con el que el operario reconoce el
    // formato, y verlo antes de tocar evita cargar un pallet con el formato de la otra
    // marca. Mismo formato de tarjeta que los envases de lechería.
    (e) => {
      const chico = document.createElement('small')
      chico.style.cssText = 'display:block;font-size:15px;font-weight:600;opacity:.65;margin-top:6px'
      chico.textContent = equivalenciaDe(e)
      // Una LISTA de nodos, no un nodo suelto: `botones` hace append(...partes).
      return [document.createTextNode(e.nombre), chico]
    },
  )
}

function equivalenciaDe(e) {
  if (!e?.bultos_por_pallet || !e?.unidades_por_bulto) return 'formato a confirmar'
  const kilos = kilosDe(e, e.bultos_por_pallet, e.unidades_por_bulto)
  const unidades = e.bultos_por_pallet * e.unidades_por_bulto
  // El "≈" es SOLO del bin. El nombre del formato ya dice "70 cajas × 15"; lo que agrega
  // esta linea es a cuanto equivale, y ahi la diferencia entre las dos formas se ve:
  // el pallet son cajas contadas y el bin es un recipiente que alguien mira.
  const c = (n) => n.toLocaleString('es-AR')
  return esBin(e)
    ? `≈ ${c(unidades)} sachets${kilos ? ` · ≈ ${c(kilos)} kg` : ''}`
    : `${c(unidades)} sachets${kilos ? ` · ${c(kilos)} kg` : ''}`
}

// Como se llama lo que hay adentro. Un pote no es un sachet, y decirle sachet a 288
// potes es el tipo de palabra equivocada que hace que el operario desconfie del numero.
function comoSeLlaman(u) {
  return u.presentacion === 'caja' ? 'potes' : 'sachets'
}

// Los kilos salen del FORMATO y no del producto: el sachet de Lácteos Belgrano es de 1 kg
// y el de Central Lechera de 900 g, y es el mismo yogur. El servidor hace esta misma
// cuenta y la suya es la que vale; acá se repite solo para que la pantalla no quede
// esperando la respuesta.
function kilosDe(envase, bultos, unidades) {
  const k = envase?.litros_por_unidad
  if (!bultos || !unidades || !k) return null
  return Math.round(bultos * unidades * k)
}

// ---------------------------------------------------------------- registrar

async function registrar() {
  const fecha = horaServidor()
  const pote = esPote(est.producto)
  const cajas = pote ? Number(est.cajasStr) : null
  const e = est.envase
  // El pallet arranca COMPLETO y el bin arranca LLENO, siempre. Lo que no fue así se
  // corrige desde la confirmación, que es el caso raro; ver el comentario de btn-ajustar.
  const bultos = pote ? null : (e?.bultos_por_pallet ?? null)
  const porBulto = pote ? null : (e?.unidades_por_bulto ?? null)

  const cuerpo = {
    client_id: crypto.randomUUID(),
    operario_id: est.operario.id,
    marca_id: est.marca.id,
    producto_id: est.producto.id,
    ...(pote ? { cajas } : { envase_id: e?.id }),
  }
  const unidades = pote
    ? cajas * (est.producto.unidades_por_bulto ?? 0)
    : (bultos ?? 0) * (porBulto ?? 0)
  const kilos = pote
    ? (est.producto.kilos_por_unidad ? est.producto.kilos_por_unidad * unidades : null)
    : kilosDe(e, bultos, porBulto)

  const local = {
    ...cuerpo,
    fecha_hora: fecha.toISOString(),
    operario: est.operario.nombre,
    marca: est.marca.nombre,
    producto: est.producto.nombre,
    presentacion: est.producto.presentacion ?? 'bin',
    envase: e?.nombre ?? null,
    bultos_por_pallet: e?.bultos_por_pallet ?? null,
    bultos,
    unidades_por_bulto: porBulto,
    llenado: 100,
    cajas,
    unidades,
    kilos,
  }

  est.ultimo = local
  $('listo-hora').textContent = hhmm(fecha)
  // Los kilos solo se muestran si el peso del sachet está confirmado. Mientras no lo
  // esté, mostrar un número redondo sería peor que no mostrar ninguno.
  pintarConfirmacion()
  irA('listo')
  clearInterval(est.timer)
  est.timer = cuentaRegresiva(VENTANA_DESHACER, $('deshacer-seg'), reiniciar)
  agregarFila(local, true)

  try {
    if (!red.hay) throw new Error('sin red')
    const guardado = await postear('/api/yogur', cuerpo)
    est.ultimo.id = guardado.id
    refrescarHoy()
  } catch {
    cola.agregar({
      ruta: '/api/yogur',
      cuerpo: { ...cuerpo, fecha_hora_cliente: fecha.toISOString() },
    })
    red.hay = false
  }
  pintarEstado()
}

// ---------------------------------------------------------------- cajas (potes)

function pintarCajas() {
  const v = $('cajas-valor')
  v.textContent = est.cajasStr || '0'
  v.classList.toggle('vacio', !est.cajasStr)
  const n = Number(est.cajasStr)
  const porCaja = est.producto?.unidades_por_bulto ?? 0
  $('cajas-equivale').textContent =
    n >= 1 && porCaja ? `${n} × ${porCaja} = ${(n * porCaja).toLocaleString('es-AR')} potes` : ''
  const ok = $('cajas-ok')
  if (ok) ok.disabled = !(n >= 1)
}

function teclaCajas(valor) {
  if (valor === 'borrar') est.cajasStr = est.cajasStr.slice(0, -1)
  // Tres digitos: 999 cajas son 24.000 potes, muy por encima de cualquier produccion de
  // un dia. El tope evita el cero de mas que nadie revisa.
  else if (est.cajasStr.length < 3) est.cajasStr = (est.cajasStr + valor).replace(/^0+/, '')
  pintarCajas()
}

function armarTecladoCajas() {
  const t = $('cajas-teclado')
  t.replaceChildren()
  for (const n of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) {
    const b = document.createElement('button')
    b.className = 'tecla'
    b.textContent = n
    b.onclick = () => teclaCajas(n)
    t.append(b)
  }
  const borrar = document.createElement('button')
  borrar.className = 'tecla borrar'
  borrar.textContent = '⌫'
  borrar.onclick = () => teclaCajas('borrar')

  const cero = document.createElement('button')
  cero.className = 'tecla'
  cero.textContent = '0'
  cero.onclick = () => teclaCajas('0')

  const ok = document.createElement('button')
  ok.className = 'tecla ok'
  ok.id = 'cajas-ok'
  ok.textContent = 'LISTO'
  ok.disabled = true
  ok.onclick = () => { if (Number(est.cajasStr) >= 1) registrar() }

  t.append(borrar, cero, ok)
}

// ---------------------------------------------------------------- la confirmacion

// En que vino la carga que se acaba de registrar. Las tres formas se distinguen con lo
// que ya esta en el registro: el pote lo dice el producto, y entre bin y pallet decide
// cuantos bultos tiene el formato.
function formaDe(u) {
  if (u.presentacion === 'caja') return 'pote'
  return u.bultos_por_pallet === 1 || u.envase_id == null ? 'bin' : 'pallet'
}

function pintarConfirmacion() {
  const u = est.ultimo
  if (!u) return
  const forma = formaDe(u)
  $('listo-titulo').textContent =
    forma === 'pote' ? 'CAJAS REGISTRADAS'
      : forma === 'bin' ? 'BIN REGISTRADO'
      : 'PALLET REGISTRADO'

  const partes = [u.marca, u.producto]
  if (forma === 'pote') partes.push(`${u.cajas} cajas`)
  // Lo excepcional se escribe y lo normal no: "bin lleno" o "pallet completo" en cada
  // registro es ruido que ademas hace que la excepcion se lea igual que lo de siempre.
  else if (forma === 'bin') {
    if (u.llenado !== 100) partes.push(COMO_SE_DICE[u.llenado] ?? `${u.llenado}%`)
  } else {
    partes.push(
      u.bultos === u.bultos_por_pallet
        ? `${u.bultos} cajas`
        : `${u.bultos} de ${u.bultos_por_pallet} cajas`,
    )
  }
  // Sin "≈" cuando el numero se conto. Un pallet son 70 cajas de 15 que alguien armo:
  // marcarlo como aproximado seria mentir para el otro lado.
  const aprox = forma === 'pallet' ? '' : '≈ '
  partes.push(`${aprox}${u.unidades.toLocaleString('es-AR')} ${comoSeLlaman(u)}`)
  if (u.kilos) partes.push(`${aprox}${u.kilos.toLocaleString('es-AR')} kg`)
  if (u.motivo) partes.push(u.motivo)
  $('listo-detalle').textContent = partes.join(' · ')

  // Un pote se cuenta por cajas al final de la produccion: no hay nada que ajustar.
  // Un formato sin numeros cargados tampoco: no se sabe cuanto es "completo".
  const boton = $('btn-ajustar')
  boton.hidden = forma === 'pote' || (forma === 'pallet' && !u.bultos_por_pallet)
  boton.textContent =
    forma === 'bin'
      ? (u.llenado === 100 ? 'No se llenó el bin' : 'Corregir el llenado')
      : (u.bultos === u.bultos_por_pallet ? 'No fue un pallet completo' : 'Corregir las cajas')
}

// ---------------------------------------------------------------- el bin que no se lleno
//
// "Hay bines que no llegan llenos porque quizás se termina antes el yogurt y te queda
//  1/2 bin." [Alexis, 12/10]
//
// NO es un paso del flujo. La enorme mayoria de los bins salen llenos y pagarian un toque
// de mas todo el dia por la excepcion; se registra el bin lleno y, si no lo fue, se
// corrige desde la misma confirmacion. Mismo criterio que "No fue un pallet completo" de
// lecheria y que la observacion de recepcion.

function pintarLlenados() {
  botones(
    $('op-llenados'),
    LLENADOS.map((v) => ({ v, nombre: `${COMO_SE_DICE[v]} · ${v}%` })),
    (o) => {
      est.llenadoElegido = o.v
      // Un bin lleno no tiene nada que explicar: se guarda y listo.
      if (o.v === 100) return guardarLlenado(100, null)
      irA('motivo')
    },
  )
}

async function guardarLlenado(llenado, motivo) {
  const u = est.ultimo
  if (!u) return
  irA('listo')
  // Se pinta antes de que conteste el servidor: el operario ya tomo la decision y la
  // pantalla tiene que reflejarla. Si falla, se avisa.
  const antes = {
    unidades: u.unidades, kilos: u.kilos, llenado: u.llenado, motivo: u.motivo,
    unidades_por_bulto: u.unidades_por_bulto,
  }
  // Cuanto entra en un bin lleno sale del FORMATO; del producto solo si la carga vino de
  // una tablet vieja, sin formato.
  const base = est.envase?.unidades_por_bulto ?? est.producto?.unidades_por_bin ?? 0
  u.llenado = llenado
  u.motivo = motivo?.nombre ?? null
  u.unidades_por_bulto = Math.round((base * llenado) / 100)
  u.unidades = (u.bultos ?? 1) * u.unidades_por_bulto
  u.kilos = est.envase
    ? kilosDe(est.envase, u.bultos ?? 1, u.unidades_por_bulto)
    : (est.producto?.kilos_por_unidad ? est.producto.kilos_por_unidad * u.unidades : null)
  pintarConfirmacion()

  try {
    if (!red.hay) throw new Error('sin red')
    await fetch('/api/yogur/llenado', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: u.client_id, llenado, motivo_id: motivo?.id ?? null }),
    }).then((r) => { if (!r.ok) throw new Error('rechazado') })
    refrescarHoy()
  } catch {
    // Sin red el registro todavia esta en la cola: se corrige ahi, que es donde vive
    // hasta que haya conexion. El servidor recalcula las unidades con el llenado cuando
    // le llegue, asi que alcanza con mandarle el porcentaje y el motivo.
    const ajustado = cola.actualizar(u.client_id, { llenado, motivo_id: motivo?.id ?? null })
    if (!ajustado) {
      Object.assign(u, antes)
      pintarConfirmacion()
      alert('No se pudo corregir el llenado: sin conexión. Probá de nuevo cuando vuelva.')
    }
  }
}

// ---------------------------------------------------------------- el pallet corto
//
// El equivalente del bin a medias, pero CONTANDO en vez de estimando. Mismo criterio que
// "No fue un pallet completo" en lecheria: no es un paso del flujo, porque la enorme
// mayoria de los pallets salen completos y pagarian un toque de mas todo el dia por la
// excepcion.
//
// Despues de las cajas se pide el motivo, que en lecheria no hace falta. Aca si: un
// pallet corto puede ser que se termino la partida —que no es una perdida— o una falla,
// y esa era justamente la diferencia que Alexis no sabia como catalogar.

function pintarAjuste() {
  const u = est.ultimo
  const v = $('ajustar-valor')
  v.textContent = est.ajusteStr || '0'
  v.classList.toggle('vacio', !est.ajusteStr)
  $('ajustar-pregunta').textContent = `¿Cuántas cajas entraron? (el pallet lleva ${u?.bultos_por_pallet ?? '?'})`

  const n = Number(est.ajusteStr)
  const kilos = kilosDe(est.envase, n, u?.unidades_por_bulto)
  $('ajustar-equivale').textContent =
    n >= 1 && kilos
      ? `${n} × ${u.unidades_por_bulto} = ${(n * u.unidades_por_bulto).toLocaleString('es-AR')} sachets · ${kilos.toLocaleString('es-AR')} kg`
      : ''
  const ok = $('ajustar-ok')
  if (ok) ok.disabled = !(n >= 1)
}

function teclaAjuste(valor) {
  if (valor === 'borrar') est.ajusteStr = est.ajusteStr.slice(0, -1)
  else if (est.ajusteStr.length < 3) est.ajusteStr = (est.ajusteStr + valor).replace(/^0+/, '')
  pintarAjuste()
}

function armarTecladoAjuste() {
  const t = $('ajustar-teclado')
  t.replaceChildren()
  for (const n of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) {
    const b = document.createElement('button')
    b.className = 'tecla'
    b.textContent = n
    b.onclick = () => teclaAjuste(n)
    t.append(b)
  }
  const borrar = document.createElement('button')
  borrar.className = 'tecla borrar'
  borrar.textContent = '⌫'
  borrar.onclick = () => teclaAjuste('borrar')

  const cero = document.createElement('button')
  cero.className = 'tecla'
  cero.textContent = '0'
  cero.onclick = () => teclaAjuste('0')

  const ok = document.createElement('button')
  ok.className = 'tecla ok'
  ok.id = 'ajustar-ok'
  ok.textContent = 'LISTO'
  ok.disabled = true
  ok.onclick = () => {
    const n = Number(est.ajusteStr)
    if (!(n >= 1)) return
    // Un pallet que al final estaba completo no tiene nada que explicar.
    if (n === est.ultimo?.bultos_por_pallet) return guardarBultos(n, null)
    irA('motivo')
  }

  t.append(borrar, cero, ok)
}

async function guardarBultos(bultos, motivo) {
  const u = est.ultimo
  if (!u) return
  irA('listo')
  // Se pinta antes de que conteste el servidor, igual que el llenado: el operario ya
  // tomo la decision y la pantalla tiene que reflejarla. Si falla, se avisa y se vuelve.
  const antes = { bultos: u.bultos, unidades: u.unidades, kilos: u.kilos, motivo: u.motivo }
  u.bultos = bultos
  u.motivo = motivo?.nombre ?? null
  u.unidades = bultos * (u.unidades_por_bulto ?? 0)
  u.kilos = kilosDe(est.envase, bultos, u.unidades_por_bulto)
  pintarConfirmacion()
  actualizarFila(u)

  try {
    if (!red.hay) throw new Error('sin red')
    await fetch('/api/yogur/cantidades', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: u.client_id, bultos, motivo_id: motivo?.id ?? null }),
    }).then((r) => { if (!r.ok) throw new Error('rechazado') })
    refrescarHoy()
  } catch {
    // Sin red el registro todavia esta en la cola: se corrige ahi. El alta acepta
    // `bultos`, asi que cuando sincronice llega ya con la cantidad correcta.
    const ajustado = cola.actualizar(u.client_id, { bultos, motivo_id: motivo?.id ?? null })
    if (!ajustado) {
      Object.assign(u, antes)
      pintarConfirmacion()
      actualizarFila(u)
      alert('No se pudo corregir las cajas: sin conexión. Probá de nuevo cuando vuelva.')
    }
  }
}

async function deshacer() {
  clearInterval(est.timer)
  const u = est.ultimo
  if (!u) return reiniciar(true)
  if (u.id) {
    await fetch(`/api/yogur/${u.id}/anular`, { method: 'POST' }).catch(() => {})
  } else {
    cola.quitar(u.client_id)
  }
  est.ultimo = null
  pintarEstado()
  refrescarHoy()
  reiniciar(true)
}

// ---------------------------------------------------------------- historial

function fila(r, pendiente = false) {
  const el = document.createElement('div')
  el.className = `fila${pendiente ? ' pendiente' : ''}${r.anulado ? ' anulada' : ''}`
  // Para poder repintarla cuando se corrige sin tener que recargar todo el historial.
  if (r.client_id) el.dataset.clientId = r.client_id
  el.innerHTML = '<span class="h"></span><span class="q"></span><span class="op"></span>'
  el.querySelector('.h').textContent = hhmm(r.fecha_hora)
  // El llenado solo se escribe cuando NO fue lleno: ponerlo en todas las filas haría que
  // la excepción se lea igual que lo normal, que es lo contrario de lo que sirve.
  const forma = formaDe(r)
  const cuanto =
    forma === 'pote'
      ? `${r.cajas} cajas`
      : forma === 'pallet'
        ? (r.bultos === r.bultos_por_pallet
            ? `${r.bultos} cajas · ${r.unidades}`
            : `${r.bultos} de ${r.bultos_por_pallet} cajas · ${r.unidades}`)
        : (r.llenado ?? 100) === 100
          ? `${r.unidades}`
          : `${COMO_SE_DICE[r.llenado] ?? `${r.llenado}%`} · ${r.unidades}`
  el.querySelector('.q').textContent =
    `${r.marca} · ${r.producto} · ${cuanto}` + (r.motivo ? ` · ${r.motivo}` : '')
  el.querySelector('.op').textContent = r.operario
  return el
}

// Repinta la fila de una carga que se acaba de corregir. Sin esto, el historial sigue
// mostrando el pallet completo mientras la confirmacion ya dice que entraron 35 cajas.
function actualizarFila(r) {
  const lista = $('lista-hoy')
  const vieja = [...lista.children].find((el) => el.dataset.clientId === r.client_id)
  if (vieja) lista.replaceChild(fila(r, !r.id), vieja)
}

// Igual que en lecheria: se guarda aparte del DOM para poder sumarle de a uno sin red.
let desgloseHoy = []

function agregarFila(r, pendiente) {
  $('lista-hoy').prepend(fila(r, pendiente))
  // Las tres formas NO se suman entre si: un pallet son 70 cajas, un bin es un
  // recipiente de ~500 sachets y una caja de potes son 24 potes. Un total que dijera
  // "14 bultos" no significaria nada. Lo unico comparable son los sachets y los kilos.
  const forma = formaDe(r)
  if (forma === 'pote') {
    $('cajas-hoy-caja').hidden = false
    $('cajas-hoy').textContent = Number($('cajas-hoy').textContent) + (r.cajas ?? 0)
  } else if (forma === 'bin') {
    $('bins-hoy-caja').hidden = false
    $('bins-hoy').textContent = Number($('bins-hoy').textContent) + 1
  } else {
    $('pallets-hoy').textContent = Number($('pallets-hoy').textContent) + 1
  }
  $('unidades-hoy').textContent =
    (Number($('unidades-hoy').textContent.replace(/\./g, '')) + r.unidades).toLocaleString('es-AR')
  desgloseHoy = sumarDesglose(
    desgloseHoy, r.marca, r.producto, forma === 'pote' ? (r.cajas ?? 0) : 1,
    forma === 'pote' ? 'cajas' : forma === 'bin' ? 'bins' : 'pallets',
  )
  pintarDesglose($('desglose-hoy'), desgloseHoy, 'pallets')
}

async function refrescarHoy() {
  if (!red.hay) return
  try {
    const { registros, pallets, bins, cajas, unidades, kilos, por_marca_producto } =
      await (await fetch('/api/yogur')).json()
    $('pallets-hoy').textContent = pallets ?? 0
    $('bins-hoy').textContent = bins
    $('cajas-hoy').textContent = cajas ?? 0
    // Las líneas del bin y de las cajas solo aparecen los días que hubo, que son cada vez
    // menos: un "0 bins" permanente le saca lugar a lo que se mira todos los días. El
    // pallet se muestra siempre porque es lo de todos los días.
    $('bins-hoy-caja').hidden = !bins
    $('cajas-hoy-caja').hidden = !cajas
    $('unidades-hoy').textContent = unidades.toLocaleString('es-AR')
    $('kilos-hoy').textContent = kilos ? ` · ≈ ${kilos.toLocaleString('es-AR')} kg` : ''
    desgloseHoy = por_marca_producto ?? []
    pintarDesglose($('desglose-hoy'), desgloseHoy, 'pallets')
    $('lista-hoy').replaceChildren(...registros.slice(0, 20).map((r) => fila(r)))
  } catch {
    red.hay = false
    pintarEstado()
  }
}

// ---------------------------------------------------------------- arranque

const catalogo = await cargarCatalogo('yogures')
configurarTablet(catalogo)
configurarVuelta()

botones($('op-operarios'), catalogo.operarios, (o) => {
  est.operario = o
  irA('marca')
})
botones($('op-marcas'), catalogo.marcas, (m) => {
  est.marca = m
  pintarProductos()
  irA('producto')
})
armarTecladoCajas()
armarTecladoAjuste()
pintarLlenados()
// El mismo paso de motivo sirve para las dos correcciones, porque la pregunta es la
// misma: por que salio menos de lo que tenia que salir.
botones($('op-motivos-yogur'), catalogo.motivos_yogur ?? [], (mo) =>
  est.corrigiendo === 'bultos'
    ? guardarBultos(Number(est.ajusteStr), mo)
    : guardarLlenado(est.llenadoElegido, mo),
)

$('btn-ajustar').addEventListener('click', () => {
  // La cuenta regresiva se corta: corregir no es "deshacer", y que el registro se cierre
  // solo mientras el operario elige seria el peor momento.
  clearInterval(est.timer)
  if (formaDe(est.ultimo) === 'bin') {
    est.corrigiendo = 'llenado'
    return irA('llenado')
  }
  est.corrigiendo = 'bultos'
  est.ajusteStr = ''
  pintarAjuste()
  irA('ajustar')
})

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
