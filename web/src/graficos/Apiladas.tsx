import { useTooltip } from './Tooltip'
import { useAncho } from './useAncho'
import { num } from '../ui/formato'
import type { FilaLecheria } from '../api/tipos'

const SERIES = ['var(--color-serie-1)', 'var(--color-serie-2)', 'var(--color-serie-3)'] as const

/**
 * Tres tipos de leche que hay que distinguir dentro de cada marca -> apiladas, 3 hues
 * categóricos.
 *
 * El color se ata al producto por su posición en el catálogo (`canonicos`), NO por el
 * orden en que aparece en los datos filtrados. Cambiar el rango de fechas no puede
 * repintar las series: si "azul" significa Entera en una vista y Largavida en otra,
 * comparar dos períodos induce a error.
 */
export function Apiladas({
  filas,
  canonicos,
}: {
  filas: FilaLecheria[]
  canonicos: string[]
}) {
  const tip = useTooltip()
  const [caja, medido] = useAncho<HTMLDivElement>()
  if (!filas.length) return null

  const colorDe = (producto: string) =>
    SERIES[canonicos.indexOf(producto) % SERIES.length] ?? SERIES[0]

  // En orden canónico, y solo los que tienen datos en este rango.
  const productos = canonicos.filter((p) => filas.some((f) => f.producto === p))

  const marcas = [...new Set(filas.map((f) => f.marca))]
    .map((marca) => {
      const suyas = filas.filter((f) => f.marca === marca)
      return {
        marca,
        total: suyas.reduce((n, f) => n + f.pallets, 0),
        litros: suyas.reduce((n, f) => n + (f.litros ?? 0), 0),
        partes: productos
          .map((p) => ({ p, n: suyas.find((f) => f.producto === p)?.pallets ?? 0 }))
          .filter((x) => x.n > 0),
      }
    })
    .sort((a, b) => b.total - a.total)

  const max = Math.max(...marcas.map((m) => m.total))
  const filaH = 46
  const W = Math.max(medido || 460, 320)
  const etiqueta = 128
  const valor = 64
  const H = marcas.length * filaH + 4
  const ancho = W - etiqueta - valor

  return (
    <div ref={caja} className="w-full">
      {/* Con 2 o más series la leyenda es obligatoria: la identidad nunca queda solo
          en el color. */}
      <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {productos.map((p) => (
          <li key={p} className="flex items-center gap-1.5 text-[12.5px] text-tinta-2">
            <span
              aria-hidden
              className="inline-block size-2.5 rounded-sm"
              style={{ background: colorDe(p) }}
            />
            {p}
          </li>
        ))}
      </ul>

      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Pallets de leche por marca y tipo">
        {marcas.map((m, i) => {
          const y = i * filaH + 8
          let x = etiqueta
          return (
            <g key={m.marca}>
              <text x={etiqueta - 10} y={y + 17} textAnchor="end" fill="var(--color-tinta-2)" fontSize={13}>
                {m.marca}
              </text>
              {m.partes.map(({ p, n }) => {
                const w = (n / max) * ancho
                const xSeg = x
                x += w
                const litrosSeg = filas.find((f) => f.marca === m.marca && f.producto === p)?.litros ?? 0
                return (
                  <g key={p}>
                    <rect
                      x={xSeg}
                      /* 2px de aire entre segmentos: sin eso dos colores contiguos se
                         leen como uno solo en el borde. */
                      width={Math.max(w - 2, 1)}
                      y={y + 4}
                      height={22}
                      fill={colorDe(p)}
                      rx={3}
                      ry={3}
                      {...tip.enlazar(
                        <>
                          <b>{m.marca}</b>
                          <br />
                          {p}: {num(n)} pallets
                          <br />
                          {num(litrosSeg)} litros
                        </>,
                      )}
                    />
                    {/* Etiqueta directa dentro del segmento cuando entra. pointer-events
                        none, si no el número tapa el rect justo donde uno apunta. */}
                    {w > 42 && (
                      <text
                        x={xSeg + w / 2 - 1}
                        y={y + 19}
                        textAnchor="middle"
                        fill="#fff"
                        fontSize={11.5}
                        fontWeight={600}
                        pointerEvents="none"
                      >
                        {n}
                      </text>
                    )}
                  </g>
                )
              })}
              <text x={x + 8} y={y + 15} fill="var(--color-tinta-2)" fontSize={12.5}>
                {num(m.total)}
              </text>
              <text x={x + 8} y={y + 29} fill="var(--color-tinta-suave)" fontSize={11}>
                {num(m.litros)} L
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
