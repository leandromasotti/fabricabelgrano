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
  yogures: { nombre: 'Yogures', detalle: 'Bins de yogur', url: '/yogures.html' },
  queseria: { nombre: 'Quesería', detalle: 'Tinas y piezas producidas', url: '/queseria.html' },
  saladero: { nombre: 'Saladero', detalle: 'Entrada y salida de sal', url: '/saladero.html' },
  envasado: { nombre: 'Envasado', detalle: 'Piezas envasadas', url: '/envasado.html' },
  maduracion: { nombre: 'Maduración', detalle: 'Entrada y salida de cámara', url: '/maduracion.html' },
  pedidos: { nombre: 'Armado de pedidos', detalle: 'Armar, pesar y cerrar', url: '/pedidos.html' },
}

// Lo que pidio el cliente: una tablet para queseria y saladero.
const POR_DEFECTO = ['queseria', 'saladero']

const pedidos = new URLSearchParams(location.search).get('sectores')
const claves = (pedidos ? pedidos.split(',') : POR_DEFECTO)
  .map((c) => c.trim())
  .filter((c) => SECTORES[c])

// Si la URL trae puras claves inventadas, mejor volver al default que dejar la pantalla
// vacia: una tablet amurada sin botones no tiene como salir de ahi.
const elegidos = claves.length ? claves : POR_DEFECTO

// A donde vuelve cada sector: a ESTA url, con los mismos sectores. Asi la vuelta
// reconstruye la misma pantalla y no una generica.
const volver = encodeURIComponent(location.pathname + location.search)

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
