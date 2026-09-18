import { useTooltip } from './Tooltip'
import { useAncho } from './useAncho'
import { num } from '../ui/formato'
import type { RendimientoQueso } from '../api/tipos'

const TOPE = 10

/**
 * Comparar magnitudes ordenadas -> barras horizontales, un solo tono.
 * Horizontales porque las etiquetas son nombres largos ("Pategrás", "Reggianito") y en
 * vertical habría que rotarlas.
 */
export function BarrasH({ rendimiento }: { rendimiento: RendimientoQueso[] }) {
  const tip = useTooltip()
  const [caja, medido] = useAncho<HTMLDivElement>()
  if (!rendimiento.length) return null

  const datos = rendimiento.slice(0, TOPE)
  const max = Math.max(...datos.map((d) => d.piezas))
  const filaH = 30
  const W = Math.max(medido || 460, 320)
  const etiqueta = 128
  const valor = 56
  const H = datos.length * filaH + 6
  const ancho = W - etiqueta - valor

  return (
    <div ref={caja} className="w-full">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Piezas producidas por tipo de queso">
        {datos.map((d, i) => {
          const y = i * filaH + 4
          const w = Math.max((d.piezas / max) * ancho, 2)
          return (
            <g key={d.queso}>
              <text x={etiqueta - 10} y={y + 15} textAnchor="end" fill="var(--color-tinta-2)" fontSize={13}>
                {d.queso}
              </text>
              <rect x={etiqueta} y={y + 3} width={w} height={16} fill="var(--color-secuencial)" rx={4} ry={4} />
              {/* Etiqueta directa del valor: es el relief que el contraste del tono exige. */}
              <text x={etiqueta + w + 8} y={y + 16} fill="var(--color-tinta-2)" fontSize={12.5}>
                {num(d.piezas)}
              </text>
              <rect
                x={0}
                y={y}
                width={W}
                height={filaH}
                fill="transparent"
                {...tip.enlazar(
                  <>
                    <b>{d.queso}</b>
                    <br />
                    {num(d.piezas)} piezas en {d.tinas} tinas
                    <br />
                    promedio {d.promedio} por tina
                  </>,
                )}
              />
            </g>
          )
        })}
      </svg>
      {rendimiento.length > TOPE && (
        <p className="mt-2 text-[12.5px] text-tinta-suave">
          Se muestran los {TOPE} primeros de {rendimiento.length}. El resto está en la tabla de
          rendimiento.
        </p>
      )}
    </div>
  )
}
