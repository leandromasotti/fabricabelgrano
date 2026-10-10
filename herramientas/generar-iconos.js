// Genera los iconos de la aplicacion.
//
// POR QUE ESTO EXISTE: Chrome en Android solo ofrece "Instalar app" —que es lo unico
// que da pantalla completa de verdad— si el manifiesto declara al menos un icono de
// 192 px. Sin iconos, la tablet abre el sitio en una pestaña con la barra de direcciones
// arriba, que es justo lo que no queremos en una pantalla amurada.
//
// POR QUE SE ESCRIBE EL PNG A MANO: el proyecto no tiene ninguna libreria de imagenes y
// no vale la pena sumar una dependencia para dos archivos que se generan una vez. zlib
// viene con Node, y un PNG es poco mas que eso mas tres bloques con su CRC.
//
//   node herramientas/generar-iconos.js
//
// Se corre a mano y se commitean los PNG: no hace falta regenerarlos en cada build.

import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const salida = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

// Los mismos colores que styles.css, para que el icono y la pantalla sean lo mismo.
const FONDO = [0x10, 0x14, 0x18]
const GOTA = [0xf2, 0xf6, 0xf8]
const ACENTO = [0x2f, 0x9e, 0x68]

// ---------------------------------------------------------------- PNG

const crcTabla = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

const crc32 = (buf) => {
  let c = -1
  for (const b of buf) c = crcTabla[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function bloque(tipo, datos) {
  const largo = Buffer.alloc(4)
  largo.writeUInt32BE(datos.length)
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'latin1'), datos])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(cuerpo))
  return Buffer.concat([largo, cuerpo, crc])
}

function png(ancho, alto, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(ancho, 0)
  ihdr.writeUInt32BE(alto, 4)
  ihdr[8] = 8 // bits por canal
  ihdr[9] = 6 // RGBA
  // 10, 11, 12 quedan en 0: compresion deflate, filtro estandar, sin entrelazado.

  // Cada fila lleva adelante un byte de filtro. 0 = sin filtrar, que para una imagen
  // chica y plana comprime mas que suficiente.
  const filas = Buffer.alloc(alto * (1 + ancho * 4))
  for (let y = 0; y < alto; y++) {
    const desde = y * (1 + ancho * 4)
    filas[desde] = 0
    rgba.copy(filas, desde + 1, y * ancho * 4, (y + 1) * ancho * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloque('IHDR', ihdr),
    bloque('IDAT', deflateSync(filas, { level: 9 })),
    bloque('IEND', Buffer.alloc(0)),
  ])
}

// ---------------------------------------------------------------- el dibujo

// Una gota: un circulo abajo que se afina hasta una punta arriba. Es lo que la fabrica
// hace, se reconoce en 48 px y no necesita texto —que a este tamaño no se leeria—.
function dentroDeLaGota(x, y, lado) {
  const cx = lado / 2
  const punta = lado * 0.17
  const centro = lado * 0.63
  const radio = lado * 0.26

  if (y < punta || y > centro + radio) return false
  if (y >= centro) {
    const dy = y - centro
    return (x - cx) ** 2 + dy ** 2 <= radio ** 2
  }
  // Entre la punta y el centro del circulo, el ancho crece con una potencia: con una
  // recta la gota parece un cono, y con esto queda la curva que uno espera.
  const t = (y - punta) / (centro - punta)
  const medioAncho = radio * Math.pow(t, 1.5)
  return Math.abs(x - cx) <= medioAncho
}

// Esquinas redondeadas, como cualquier icono de Android.
function dentroDelFondo(x, y, lado) {
  const r = lado * 0.22
  const dx = Math.min(x, lado - x)
  const dy = Math.min(y, lado - y)
  if (dx >= r || dy >= r) return true
  return (r - dx) ** 2 + (r - dy) ** 2 <= r ** 2
}

function dibujar(lado) {
  const rgba = Buffer.alloc(lado * lado * 4)
  // Supermuestreo de 4x4 por pixel: sin esto los bordes de la gota quedan escalonados,
  // que en un icono se nota enseguida.
  const M = 4
  for (let y = 0; y < lado; y++) {
    for (let x = 0; x < lado; x++) {
      let fondo = 0
      let gota = 0
      for (let sy = 0; sy < M; sy++) {
        for (let sx = 0; sx < M; sx++) {
          const px = x + (sx + 0.5) / M
          const py = y + (sy + 0.5) / M
          if (dentroDelFondo(px, py, lado)) fondo++
          if (dentroDeLaGota(px, py, lado)) gota++
        }
      }
      const total = M * M
      const aFondo = fondo / total
      const aGota = gota / total

      // La gota lleva un degradado sutil hacia el acento, para que no sea una mancha.
      const mezcla = y / lado
      const color = GOTA.map((c, i) => Math.round(c * (1 - mezcla * 0.45) + ACENTO[i] * mezcla * 0.45))

      const i = (y * lado + x) * 4
      for (let c = 0; c < 3; c++) {
        rgba[i + c] = Math.round(FONDO[c] * (1 - aGota) + color[c] * aGota)
      }
      rgba[i + 3] = Math.round(255 * aFondo)
    }
  }
  return rgba
}

for (const lado of [192, 512]) {
  const archivo = join(salida, `icono-${lado}.png`)
  writeFileSync(archivo, png(lado, lado, dibujar(lado)))
  console.log(`  ${archivo}`)
}
console.log('\nListo. Los PNG se commitean: no hace falta regenerarlos en cada build.')
