import { useTooltip } from './Tooltip'
import { useAncho } from './useAncho'
import { fechaLarga, num } from '../ui/formato'
import type { DiaReporte } from '../api/tipos'

/**
 * Producción por día: una sola serie a lo largo del tiempo -> columnas, un solo tono.
 * Nunca categóricos acá: los días no son categorías que haya que distinguir entre sí.
 */
export function Columnas({ dias }: { dias: DiaReporte[] }) {
  const tip = useTooltip()
  const [caja, ancho] = useAncho<HTMLDivElement>()
  if (!dias.length) return null

  const m = { arriba: 12, der: 14, abajo: 34, izq: 48 }
  const util = Math.max((ancho || 960) - m.izq - m.der, 240)
  // Tope de 40 px: con pocos días, columnas anchísimas se leen como bloques y no como
  // una serie. Piso de 14 px para que el hover siga siendo apuntable.
  const anchoCol = Math.max(14, Math.min(40, Math.floor(util / dias.length)))
  const W = m.izq + dias.length * anchoCol + m.der
  const H = 230
  const alto = H - m.arriba - m.abajo

  const max = Math.max(...dias.map((d) => d.piezas), 1)
  const escala = (v: number) => alto - (v / max) * alto

  // Etiquetas de eje selectivas: cada N días, nunca todas.
  const cada = Math.ceil(dias.length / 12)

  return (
    <div ref={caja} className="w-full overflow-x-auto">
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Piezas producidas por día">
      {/* Grilla recesiva, siempre por detrás de las barras. */}
      {[0, 1, 2, 3, 4].map((i) => {
        const v = (max / 4) * i
        const y = m.arriba + escala(v)
        return (
          <g key={i}>
            <line x1={m.izq} x2={W - m.der} y1={y} y2={y} stroke="var(--color-grilla)" strokeWidth={1} />
            <text x={m.izq - 8} y={y + 4} textAnchor="end" fill="var(--color-tinta-suave)" fontSize={11}>
              {Math.round(v)}
            </text>
          </g>
        )
      })}

      {dias.map((d, i) => {
        const x = m.izq + i * anchoCol
        const h = alto - escala(d.piezas)
        return (
          <g key={d.fecha}>
            {/* Un día sin producción deja una marca al ras del eje. Sin esto un domingo
                y un día fuera del historial se ven igual: ausencia total de barra. */}
            {d.piezas === 0 && (
              <rect x={x + 1} y={m.arriba + alto - 2} width={anchoCol - 2} height={2} fill="var(--color-tenue)" />
            )}
            {d.piezas > 0 && (
              <>
                <rect
                  x={x + 1}
                  y={m.arriba + escala(d.piezas)}
                  width={anchoCol - 2}
                  height={Math.max(h, 1)}
                  fill="var(--color-secuencial)"
                  rx={4}
                  ry={4}
                />
                {/* La base del rect redondeado se apoya en el eje con un segundo rect recto. */}
                {h > 4 && (
                  <rect
                    x={x + 1}
                    y={m.arriba + alto - 4}
                    width={anchoCol - 2}
                    height={4}
                    fill="var(--color-secuencial)"
                  />
                )}
              </>
            )}
            {/* Área de hover más grande que la barra: no hay que apuntar fino. */}
            <rect
              x={x}
              y={m.arriba}
              width={anchoCol}
              height={alto}
              fill="transparent"
              {...tip.enlazar(
                <>
                  <b>{fechaLarga(d.fecha)}</b>
                  <br />
                  {num(d.piezas)} piezas · {d.tinas} tina{d.tinas === 1 ? '' : 's'}
                  <br />
                  {num(d.pallets)} pallets · {num(d.litros)} L de leche
                </>,
              )}
            />
            {i % cada === 0 && (
              <text
                x={x + anchoCol / 2}
                y={H - 12}
                textAnchor="middle"
                fill="var(--color-tinta-suave)"
                fontSize={11}
              >
                {new Date(`${d.fecha}T00:00`).toLocaleDateString('es-AR', {
                  day: 'numeric',
                  month: 'numeric',
                })}
              </text>
            )}
          </g>
        )
      })}

      <line
        x1={m.izq}
        x2={W - m.der}
        y1={m.arriba + alto}
        y2={m.arriba + alto}
        stroke="var(--color-eje)"
        strokeWidth={1}
      />
    </svg>
    </div>
  )
}
