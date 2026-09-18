import type { ReactNode } from 'react'

export function Panel({
  titulo,
  nota,
  acciones,
  children,
}: {
  titulo?: string
  nota?: string
  acciones?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-xl border border-borde bg-superficie p-5">
      {(titulo || acciones) && (
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            {titulo && <h2 className="text-[15px] font-semibold">{titulo}</h2>}
            {nota && <p className="mt-0.5 text-[13px] text-tinta-2">{nota}</p>}
          </div>
          {acciones}
        </header>
      )}
      {children}
    </section>
  )
}

export function Kpi({ valor, titulo, nota }: { valor: string; titulo: string; nota?: string }) {
  return (
    <div className="rounded-xl border border-borde bg-superficie px-4 py-3.5">
      <div className="cifras text-[26px] leading-none font-semibold">{valor}</div>
      <div className="mt-2 text-[13px] text-tinta-2">{titulo}</div>
      {/* La aclaración es parte del dato: "3,7 h" sin "mediana de 41 tinas" al lado
          es un número que no se puede discutir ni verificar. */}
      {nota && <div className="mt-0.5 text-[11.5px] text-tinta-suave">{nota}</div>}
    </div>
  )
}

export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="rounded border border-borde px-1.5 py-px text-[11.5px] text-tinta-2">
      {children}
    </span>
  )
}

export function Vacio({ children }: { children: ReactNode }) {
  return <p className="px-1 py-8 text-center text-[13.5px] text-tinta-suave">{children}</p>
}

export function Boton({
  onClick,
  children,
  activo,
  deshabilitado,
  variante = 'normal',
}: {
  onClick: () => void
  children: ReactNode
  activo?: boolean
  deshabilitado?: boolean
  variante?: 'normal' | 'primario'
}) {
  const base =
    'rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors cursor-pointer disabled:cursor-default disabled:opacity-40'
  const estilo = activo
    ? 'border-serie-1 bg-serie-1 text-white'
    : variante === 'primario'
      ? 'border-serie-1 text-serie-1 hover:bg-serie-1/10'
      : 'border-eje text-tinta-2 hover:bg-plano'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={deshabilitado ?? false}
      // aria-pressed y no una clase sola: el estado del filtro tiene que existir para
      // un lector de pantalla, no solo para el que ve el color.
      {...(activo !== undefined ? { 'aria-pressed': activo } : {})}
      className={`${base} ${estilo}`}
    >
      {children}
    </button>
  )
}

/** Columna de una tabla. `num` alinea a la derecha y activa cifras tabulares. */
export interface Columna<T> {
  titulo: string
  num?: boolean
  celda: (fila: T) => ReactNode
}

export function Tabla<T>({
  columnas,
  filas,
  sinDatos,
  claveDe,
  altoMax,
  pie,
}: {
  columnas: Columna<T>[]
  filas: T[]
  sinDatos: string
  claveDe: (fila: T, i: number) => string | number
  /**
   * Alto máximo en px; arriba de eso la tabla scrollea adentro con el encabezado fijo.
   * Se usa en las tablas de detalle: 148 filas sueltas estiran la página a 7.600 px y
   * los gráficos, que son lo primero que se mira, quedan a diez pantallas de scroll.
   */
  altoMax?: number
  /**
   * Fila de totales. Va dentro del MISMO <table> y no en uno aparte: dos tablas
   * distintas calculan sus anchos por separado y el total termina desalineado de la
   * columna que suma, que es justo el número que alguien va a querer verificar.
   */
  pie?: (ReactNode | null)[]
}) {
  if (!filas.length) return <Vacio>{sinDatos}</Vacio>
  return (
    // El scroll es del contenedor, no del body: una tabla ancha no puede hacer que la
    // página entera se mueva en horizontal.
    <div
      className="-mx-1 overflow-auto px-1"
      style={altoMax ? { maxHeight: altoMax } : undefined}
    >
      <table className="w-full border-collapse text-[13.5px]">
        <thead className={altoMax ? 'sticky top-0 z-10 bg-superficie' : undefined}>
          <tr className="border-b border-borde">
            {columnas.map((c, i) => (
              <th
                // La clave es el índice y no el título: hay tablas con más de una
                // columna sin encabezado —el tag de "offline" y la de acciones— y con
                // el título como clave las dos valían "". React avisa y puede terminar
                // omitiendo o duplicando celdas. Las columnas son una lista fija que no
                // se reordena, así que el índice es estable.
                key={i}
                className={`bg-superficie px-3 py-2 font-medium text-tinta-suave first:pl-0 last:pr-0 ${c.num ? 'text-right' : 'text-left'}`}
              >
                {c.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={claveDe(f, i)} className="border-b border-borde/60 last:border-0">
              {columnas.map((c, i) => (
                <td
                  key={i}
                  className={`px-3 py-2 first:pl-0 last:pr-0 ${c.num ? 'cifras text-right' : 'text-left'}`}
                >
                  {c.celda(f)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {pie && (
          <tfoot>
            <tr className="border-t-2 border-borde font-semibold">
              {columnas.map((c, i) => (
                <td
                  key={i}
                  className={`px-3 py-2 first:pl-0 last:pr-0 ${c.num ? 'cifras text-right' : 'text-left'}`}
                >
                  {pie[i] ?? null}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

/**
 * Paginador de tablas largas.
 *
 * Dice SIEMPRE de cuántas filas se está viendo cuántas. Un "◀ 3 ▶" suelto obliga a
 * adivinar si falta poco o mucho, y con un mes de producción esa diferencia importa.
 */
export function Paginador({
  pagina,
  paginas,
  filas,
  porPagina,
  alCambiar,
}: {
  pagina: number
  paginas: number
  filas: number
  porPagina: number
  alCambiar: (p: number) => void
}) {
  // Con una sola página no hay nada que navegar y el control sería ruido.
  if (paginas <= 1) return null

  const desde = (pagina - 1) * porPagina + 1
  const hasta = Math.min(pagina * porPagina, filas)

  return (
    <nav
      aria-label="Paginación"
      className="mt-4 flex flex-wrap items-center gap-2 border-t border-borde pt-3"
    >
      <span className="cifras text-[13px] text-tinta-2">
        {desde}–{hasta} de {filas.toLocaleString('es-AR')}
      </span>
      <div className="flex-1" />
      <Boton onClick={() => alCambiar(1)} deshabilitado={pagina === 1}>
        « Primera
      </Boton>
      <Boton onClick={() => alCambiar(pagina - 1)} deshabilitado={pagina === 1}>
        ‹ Anterior
      </Boton>
      <span className="cifras px-1 text-[13px] text-tinta-2">
        {pagina} de {paginas}
      </span>
      <Boton onClick={() => alCambiar(pagina + 1)} deshabilitado={pagina === paginas}>
        Siguiente ›
      </Boton>
      <Boton onClick={() => alCambiar(paginas)} deshabilitado={pagina === paginas}>
        Última »
      </Boton>
    </nav>
  )
}
