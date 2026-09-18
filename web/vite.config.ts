import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'

// El escritorio nuevo vive bajo /app y las tablets siguen en la raíz (/lecheria.html
// y compañía). Son rutas distintas del mismo origen, así que conviven sin proxy ni
// segundo dominio, y se puede migrar pantalla por pantalla sin cortar nada.
export default defineConfig({
  base: '/app/',
  plugins: [react(), tailwind()],
  build: {
    // Sale directo a public/app para que el Express que ya existe lo sirva como
    // estático, sin un paso de copia que alguien se olvide de correr.
    outDir: '../public/app',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // En desarrollo el front corre en Vite y TODO lo demás sigue en el server de
    // siempre. No alcanza con reenviar /api: las tablets, el tablero LED y el lanzador
    // son archivos estáticos que Vite no conoce, y el menú del escritorio enlaza a
    // ellos. Sin esto, abrir el tablero desde :5173 daba el error de Vite
    // "did you mean to visit /app/tablero.html" — que manda a una URL que no existe.
    //
    // Las claves que empiezan con ^ son expresiones regulares. Ninguna llega a tocar lo
    // de Vite (/@vite/…, /src/…, /app/assets/…) porque todas llevan barra adentro y
    // estas sólo matchean un segmento suelto en la raíz.
    proxy: {
      '/api': 'http://localhost:3017',
      // El lanzador de sectores.
      '^/$': 'http://localhost:3017',
      // lecheria.html, tablero.js, comun.js, styles.css, sw.js, manifest.json…
      // Sin barras invertidas a propósito: dentro de un string de JS, \w y \. se comen
      // el escape y el patrón termina significando otra cosa en silencio.
      '^/[A-Za-z0-9_.-]+[.](html|js|css|json|webmanifest|png|svg|ico)$': 'http://localhost:3017',
    },
  },
})
