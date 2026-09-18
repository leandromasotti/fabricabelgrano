import { NavLink, Outlet } from 'react-router'

/**
 * Todo el escritorio ya está en el SPA. Las tablets y el tablero LED siguen siendo
 * páginas HTML aparte y se enlazan como externas: son código offline-first que funciona
 * y que no puede fallar a las 6 de la mañana en lechería.
 *
 * Las rutas internas van SIN el /app. El router ya tiene basename="/app" y lo antepone
 * solo; escribirlo también acá generaba /app/app/reportes, que no existe, y el comodín
 * mandaba todo a Despacho. Se veía como "el menú no funciona" y en realidad los enlaces
 * apuntaban a una ruta inventada.
 */
const SECCIONES = [
  {
    titulo: 'Escritorio',
    items: [
      { a: '/nuevo-pedido', texto: 'Nuevo pedido' },
      { a: '/despacho', texto: 'Despacho' },
      { a: '/reportes', texto: 'Reportes' },
      { a: '/leche-cruda', texto: 'Leche cruda' },
      { a: '/envases', texto: 'Envases' },
      { a: '/maduracion-dias', texto: 'Días de maduración' },
      { a: '/consulta', texto: 'Consulta de lechería' },
      { a: '/tablero-led', texto: 'Tablero LED' },
      { a: '/maestros', texto: 'Datos maestros' },
    ],
  },
  {
    titulo: 'Planta',
    items: [
      { a: '/tablero.html', texto: 'Ver el tablero', externo: true },
      { a: '/', texto: 'Tablets', externo: true },
    ],
  },
] as const

export function Layout() {
  return (
    <div className="flex min-h-full">
      <nav className="no-imprimir w-56 shrink-0 border-r border-borde bg-superficie px-3 py-5">
        <div className="mb-6 px-2">
          <div className="text-[15px] font-semibold">Lácteos Belgrano</div>
          <div className="text-[12px] text-tinta-suave">Escritorio</div>
        </div>

        {SECCIONES.map((s) => (
          <div key={s.titulo} className="mb-5">
            <div className="mb-1.5 px-2 text-[11px] font-semibold tracking-wide text-tinta-suave uppercase">
              {s.titulo}
            </div>
            <ul className="flex flex-col gap-0.5">
              {s.items.map((i) => (
                <li key={i.a}>
                  {'externo' in i && i.externo ? (
                    <a
                      href={i.a}
                      className="block rounded-md px-2 py-1.5 text-[13.5px] text-tinta-2 hover:bg-plano"
                    >
                      {i.texto}
                    </a>
                  ) : (
                    <NavLink
                      to={i.a}
                      className={({ isActive }) =>
                        `block rounded-md px-2 py-1.5 text-[13.5px] ${
                          isActive ? 'bg-serie-1/10 font-semibold text-serie-1' : 'text-tinta-2 hover:bg-plano'
                        }`
                      }
                    >
                      {i.texto}
                    </NavLink>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <main className="min-w-0 flex-1 px-7 py-6 pb-20">
        <div className="mx-auto max-w-300">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
