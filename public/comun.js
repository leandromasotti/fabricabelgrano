// Lo que comparten las tres pantallas de planta: cola offline, estado de red,
// reloj corregido y los helpers de pasos y botones.
// Regla de oro: el operario nunca pierde un registro. Si no hay red se encola,
// si la tablet se apaga la cola sobrevive, si se reenvia no se duplica.

export const $ = (id) => document.getElementById(id)

export const hhmm = (d) =>
  new Date(d).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })

// El tiempo transcurrido escala solo: minutos, horas, días.
//
// Sin esto la pantalla decía cosas como "hace 2232 h" y "655 h 42", que obligan a
// dividir por 24 de cabeza. En el saladero lo que importa son horas (una tina espera
// un rato); en maduración y en la cámara de desnudo lo que importa son días. Una sola
// función que cambia de unidad sirve para los dos casos sin decidirlo en cada pantalla.
//
// A partir de 2 días se dejan de mostrar las horas: si algo lleva 93 días esperando,
// que sean 93 días y 4 horas no cambia ninguna decisión.
export function transcurrido(minutos) {
  if (minutos == null) return '—'
  if (minutos < 60) return `${minutos} min`

  const dias = Math.floor(minutos / 1440)
  if (dias >= 2) return `${dias} días`

  const h = Math.floor(minutos / 60)
  const m = minutos % 60
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`
}

// ---------------------------------------------------------------- cola offline
// localStorage y no IndexedDB a proposito: son registros de ~100 bytes y el codigo
// entra en 20 lineas. Si algun dia hay que guardar fotos, se cambia solo aca.

const COLA = 'fb.cola.v2'

export const cola = {
  leer: () => JSON.parse(localStorage.getItem(COLA) ?? '[]'),
  guardar: (items) => localStorage.setItem(COLA, JSON.stringify(items)),
  agregar(item) {
    cola.guardar([...cola.leer(), item])
  },
  quitar(clientId) {
    cola.guardar(cola.leer().filter((i) => i.cuerpo.client_id !== clientId))
  },
  // Corregir algo que todavia no se sincronizo. Sin esto, arreglar un pallet cargado
  // sin red significaria anularlo y volver a cargarlo entero.
  actualizar(clientId, cambios) {
    const items = cola.leer()
    const i = items.findIndex((x) => x.cuerpo.client_id === clientId)
    if (i === -1) return false
    items[i] = { ...items[i], cuerpo: { ...items[i].cuerpo, ...cambios } }
    cola.guardar(items)
    return true
  },
}

// ---------------------------------------------------------------- red

export const red = {
  hay: navigator.onLine,
  offsetReloj: 0, // ms de desfasaje entre la tablet y el servidor
  alCambiar: () => {},
}

// La hora de una tablet amurada se desconfigura y nadie la mira, y aca el horario
// es un dato de proceso. Usamos el offset medido contra el servidor.
export const horaServidor = () => new Date(Date.now() + red.offsetReloj)

export function pintarEstado() {
  const pendientes = cola.leer().length
  $('estado').classList.toggle('sin-red', !red.hay)
  $('estado-txt').textContent = !red.hay
    ? pendientes
      ? `Sin conexión · ${pendientes} sin enviar`
      : 'Sin conexión'
    : pendientes
      ? `Enviando ${pendientes}…`
      : 'En línea'
}

export async function postear(ruta, cuerpo) {
  const res = await fetch(ruta, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
  })
  // 4xx no es un problema de red: reintentarlo no lo va a arreglar nunca.
  if (res.status >= 400 && res.status < 500) {
    const detalle = await res.json().catch(() => ({}))
    const e = new Error(detalle.error ?? 'rechazado')
    e.definitivo = true
    e.detalle = detalle
    throw e
  }
  if (!res.ok) throw new Error(`servidor respondió ${res.status}`)
  return res.json()
}

// Vacia la cola en orden. Un fallo de red corta el intento y deja el resto para la
// proxima: reintentar en desorden mezclaria los horarios del turno.
export async function sincronizar() {
  if (!red.hay) return
  for (const item of cola.leer()) {
    try {
      await postear(item.ruta, item.cuerpo)
      cola.quitar(item.cuerpo.client_id)
    } catch (e) {
      // Si el servidor lo rechaza por invalido, sacarlo: si no, tranca la cola para siempre.
      if (e.definitivo) cola.quitar(item.cuerpo.client_id)
      else {
        red.hay = false
        break
      }
    }
  }
  pintarEstado()
  red.alCambiar()
}

window.addEventListener('online', () => {
  red.hay = true
  pintarEstado()
  sincronizar()
})
window.addEventListener('offline', () => {
  red.hay = false
  pintarEstado()
})

// ---------------------------------------------------------------- catalogo

export async function cargarCatalogo(sector) {
  const clave = `fb.catalogo.${sector}`
  try {
    const data = await (await fetch(`/api/catalogo?sector=${sector}`)).json()
    red.offsetReloj = new Date(data.serverTime).getTime() - Date.now()
    localStorage.setItem(clave, JSON.stringify(data))
    red.hay = true
    return data
  } catch {
    red.hay = false
    const guardado = localStorage.getItem(clave)
    if (!guardado) throw new Error('sin catálogo y sin conexión')
    return JSON.parse(guardado)
  }
}

// ---------------------------------------------------------------- UI

export function botones(contenedor, items, alTocar, etiqueta = (i) => i.nombre) {
  contenedor.replaceChildren(
    ...items.map((item) => {
      const b = document.createElement('button')
      b.className = 'opcion'
      const partes = etiqueta(item)
      if (typeof partes === 'string') {
        b.textContent = partes
      } else {
        b.append(...partes)
      }
      b.addEventListener('click', () => alTocar(item))
      return b
    })
  )
}

// El historial del dia: se muestra solo si la configuracion lo pide.
//
// Arranca apagado. En una tablet amurada, la lista de lo que cargaron otros compite con
// el boton que hay que tocar, y la pantalla existe para REGISTRAR, no para consultar.
// Para consultar esta /app/consulta, en una computadora y con filtros de verdad.
//
// Lo decide el catalogo, que ya se pide al arrancar. Si no dice nada —catalogo viejo en
// localStorage de antes de que existiera la opcion— se asume apagado, que es el default.
let mostrarHistorial = false

export function configurarTablet(catalogo) {
  mostrarHistorial = catalogo?.opciones?.historial === true
  const historial = document.querySelector('.historial')
  if (historial && !mostrarHistorial) historial.hidden = true
}

// Algunos pasos necesitan toda la pantalla (la grilla de 17 quesos, el teclado
// numerico). En esos, el historial se oculta: en una tablet amurada y con guantes
// nadie descubre que hay que scrollear adentro de un panel, asi que lo que no entra
// directamente no existe.
export function hacerPasos(nombres, pantallaCompleta = []) {
  return (cual) => {
    for (const n of nombres) $(`paso-${n}`).hidden = n !== cual
    const historial = document.querySelector('.historial')
    // Las dos condiciones se combinan: la opcion decide si existe, el paso decide si
    // estorba. Con la opcion apagada no hay paso que lo vuelva a mostrar.
    if (historial) historial.hidden = !mostrarHistorial || pantallaCompleta.includes(cual)
  }
}

export function pintarMigas(partes) {
  $('migas').replaceChildren(
    ...partes.filter(Boolean).flatMap((texto, i) => {
      const span = document.createElement('span')
      span.className = 'miga'
      span.textContent = texto
      if (i === 0) return [span]
      const sep = document.createElement('span')
      sep.className = 'miga-sep'
      sep.textContent = '·'
      return [sep, span]
    })
  )
}

// Cuenta regresiva del DESHACER. Cubre el error real ("toque el boton de al lado")
// sin obligarnos a definir todavia un modelo de permisos.
export function cuentaRegresiva(segundos, elSpan, alTerminar) {
  let quedan = segundos
  elSpan.textContent = quedan
  const t = setInterval(() => {
    quedan -= 1
    elSpan.textContent = quedan
    if (quedan <= 0) {
      clearInterval(t)
      alTerminar()
    }
  }, 1000)
  return t
}

export function registrarSW() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {})
}
