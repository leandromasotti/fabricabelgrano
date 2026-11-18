// Pantalla de inicio para una tablet que atiende MAS DE UN SECTOR.
//
// Queseria y saladero estan uno al lado del otro y no siempre justifican dos tablets.
// Esta pantalla pregunta a cual se va, y cada sector sigue teniendo exactamente el mismo
// flujo que si tuviera su tablet propia: no se toca nada de como se carga.
//
// La vuelta es el otro lado de lo mismo: cada sector recibe en la URL a donde volver y
// muestra el boton INICIO en su primer paso. Desde mas adentro no, porque irse a mitad
// de una carga perderia lo tecleado.
//
// QUE SECTORES OFRECE se decide en la URL del kiosco:
//
//   /planta.html                               -> queseria y saladero
//   /planta.html?sectores=envasado,maduracion  -> los que diga
//
// Va por URL y no por configuracion en la base porque es una decision de ESTA tablet, no
// de la fabrica: puede haber una compartida y tres dedicadas al mismo tiempo, y una
// opcion global no sabria distinguirlas.

import { $, red, pintarEstado, sincronizar, registrarSW, botones } from '/comun.js'

const SECTORES = {
  recepcion: { nombre: 'Recepción', detalle: 'Leche cruda que entra', url: '/recepcion.html' },
  lecheria: { nombre: 'Lechería', detalle: 'Pallets de leche', url: '/lecheria.html' },
  yogures: { nombre: 'Yogures', detalle: 'Pallets y bins de yogur', url: '/yogures.html' },
  queseria: { nombre: 'Quesería', detalle: 'Tinas y piezas producidas', url: '/queseria.html' },
  saladero: { nombre: 'Saladero', detalle: 'Entrada y salida de sal', url: '/saladero.html' },
  envasado: { nombre: 'Envasado', detalle: 'Piezas envasadas', url: '/envasado.html' },
  maduracion: { nombre: 'Maduración', detalle: 'Entrada y salida de cámara', url: '/maduracion.html' },
  pedidos: { nombre: 'Armado de pedidos', detalle: 'Armar, pesar y cerrar', url: '/pedidos.html' },
}

// Lo que pidio el cliente: una tablet para queseria y saladero.
//
// La otra combinacion que la fabrica ya necesita es yogures + lecheria: en la sala del
// yogur tambien se envasa leche ("tambien ahi se elabora leche en esas maquinas. Asi que
// tambien tendriamos que tener para armar pallets de cajones y cajas a veces tambien",
// Alexis 10/11). No hace falta tocar nada: esa tablet se abre en
// /planta.html?sectores=yogures,lecheria y queda con las dos.
const POR_DEFECTO = ['queseria', 'saladero']

const pedidos = new URLSearchParams(location.search).get('sectores')
const sinLimpiar = (pedidos ? pedidos.split(',') : POR_DEFECTO).map((c) => c.trim()).filter(Boolean)
const claves = sinLimpiar.filter((c) => SECTORES[c])

// Si la URL trae puras claves inventadas, mejor volver al default que dejar la pantalla
// vacia: una tablet amurada sin botones no tiene como salir de ahi.
const elegidos = claves.length ? claves : POR_DEFECTO

// UN NOMBRE MAL ESCRITO NO SE PUEDE COMER UN SECTOR EN SILENCIO.
//
// `?sectores=yogur,lecheria` —en singular— dejaba la pantalla con Lecheria sola, sin
// error ni aviso. En una tablet amurada eso es medio sector sin poder cargar y nadie
// sabiendo por que, hasta que alguien se acuerde de mirar la URL del kiosco.
//
// El aviso queda a la vista y no bloquea: los sectores que SI se entendieron siguen
// funcionando, que es lo que la planta necesita mientras tanto.
const desconocidos = sinLimpiar.filter((c) => !SECTORES[c])
if (desconocidos.length) {
  const aviso = $('aviso-sectores')
  const cuales = desconocidos.map((c) => `«${c}»`).join(', ')
  aviso.textContent =
    `No reconocí ${cuales} en la dirección de esta tablet` +
    (claves.length ? '.' : ', así que abrí con los sectores por defecto.') +
    ` Los nombres válidos son: ${Object.keys(SECTORES).join(', ')}.`
  aviso.hidden = false
}

// A donde vuelve cada sector: a ESTA url, con los mismos sectores. Asi la vuelta
// reconstruye la misma pantalla y no una generica.
const volver = encodeURIComponent(location.pathname + location.search)

// EL ICONO INSTALADO TIENE QUE ABRIR DONDE ABRE ESTA PANTALLA.
//
// Estas tablets se instalan como PWA para ir a pantalla completa, y el `start_url` del
// manifiesto es lo que decide donde abre el icono. El manifiesto estatico pide
// /planta.html pelado, o sea el default (queseria y saladero): la direccion correcta
// funcionaba hasta que alguien instalaba la app, y ahi la tablet del yogur amanecia en
// otro sector. Se reescribe el link ANTES de que Chrome ofrezca instalar.
//
// Si la tablet ya estaba instalada de antes, hay que desinstalar y volver a instalar:
// el start_url queda congelado en el momento de instalar.
const ligaManifiesto = document.querySelector('link[rel="manifest"]')
if (ligaManifiesto) {
  ligaManifiesto.href = `/manifest.json?para=planta&sectores=${elegidos.join(',')}`
}

// Mismo formato de tarjeta que los envases de lecheria: titulo grande y una linea chica
// abajo. El operario ya vio esa forma en otra pantalla.
botones(
  $('op-sectores'),
  elegidos.map((c) => ({ id: c, ...SECTORES[c] })),
  (s) => {
    location.href = `${s.url}?volver=${volver}`
  },
  (s) => {
    const chico = document.createElement('small')
    chico.style.cssText = 'display:block;font-size:15px;font-weight:600;opacity:.65;margin-top:6px'
    chico.textContent = s.detalle
    return [document.createTextNode(s.nombre), chico]
  },
)

pintarEstado()
// Sincroniza al pasar por acá: la tablet vuelve al inicio entre carga y carga, así que
// es el momento natural para vaciar la cola si volvió la red.
red.alCambiar = () => {}
await sincronizar()
registrarSW()
