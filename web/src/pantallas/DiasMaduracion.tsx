import { useState } from 'react'
import { useGuardarDias, useQuesosDias } from '../api/cliente'
import { CampoNumero, Estado, useAviso } from '../ui/campos'
import { Boton, Panel, Vacio } from '../ui/primitivos'
import type { DiasReales, QuesoDias } from '../api/tipos'

/**
 * Corrección de los días de maduración: convierte los valores de referencia en los
 * reales de esta planta.
 *
 * La columna "real medido" es la razón de ser de la pantalla: muestra lo que
 * efectivamente tardaron los lotes que ya salieron de cámara. A las pocas semanas ese
 * número vale más que cualquier referencia teórica, porque incluye la cámara de ELLOS,
 * la estación y su forma de trabajar.
 */
export function DiasMaduracion() {
  const { data, isPending, isError } = useQuesosDias()

  if (isPending) return <Vacio>Cargando…</Vacio>
  if (isError) return <Vacio>No se pudieron cargar los días de maduración.</Vacio>

  const porConfirmar = data.quesos.filter((q) => q.dias_provisorios).length

  return (
    <>
      <header className="mb-5">
        <h1 className="text-[23px] font-semibold">Días de maduración</h1>
        <p className="text-[14px] text-tinta-2">
          Los días cargados son de referencia hasta que el quesero los confirma.
          {porConfirmar > 0 && ` Quedan ${porConfirmar} sin confirmar.`}
        </p>
      </header>

      <Panel nota="“Real medido” es lo que tardaron los lotes que ya salieron de cámara.">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13.5px]">
            <thead>
              <tr className="border-b border-borde">
                {[
                  ['Queso', 'l'],
                  ['Familia', 'l'],
                  ['Madura', 'c'],
                  ['Mínimo', 'r'],
                  ['Óptimo', 'r'],
                  ['Máximo', 'r'],
                  ['Real medido', 'l'],
                  ['', 'l'],
                  ['', 'l'],
                ].map(([h, a], i) => (
                  <th
                    key={h || i}
                    className={`px-2 py-2 font-medium text-tinta-suave first:pl-0 ${
                      a === 'r' ? 'text-right' : a === 'c' ? 'text-center' : 'text-left'
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.quesos.map((q) => (
                <Fila key={q.id} queso={q} real={data.reales.find((r) => r.queso === q.nombre)} />
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  )
}

const texto = (v: number | null) => (v === null ? '' : String(v))

function Fila({ queso: q, real }: { queso: QuesoDias; real: DiasReales | undefined }) {
  const [madura, setMadura] = useState(Boolean(q.madura))
  const [min, setMin] = useState(texto(q.dias_minimos))
  const [opt, setOpt] = useState(texto(q.dias_optimos))
  const [max, setMax] = useState(texto(q.dias_maximos))
  const [tocado, setTocado] = useState(false)
  const [aviso, setAviso] = useAviso(2500)
  const guardar = useGuardarDias()

  // Si lo medido se aleja más de un 25% del óptimo cargado, vale mirarlo. No se
  // corrige solo: se marca para que alguien decida.
  const optimo = Number(opt)
  const difiere =
    real && real.promedio > 0 && optimo > 0 && Math.abs(real.promedio - optimo) / optimo > 0.25

  const campo = (valor: string, set: (v: string) => void, etiqueta: string) => (
    <CampoNumero
      valor={valor}
      etiqueta={`${etiqueta} de ${q.nombre}`}
      // Un queso que no madura no puede tener días: dejarlos editables invita a cargar
      // datos que no significan nada.
      deshabilitado={!madura}
      alCambiar={(v) => {
        set(v)
        setTocado(true)
      }}
    />
  )

  return (
    <tr className={`border-b border-borde/60 last:border-0 ${madura ? '' : 'opacity-55'}`}>
      <td className="py-2">{q.nombre}</td>
      <td className="px-2 py-2 text-tinta-2">{q.familia}</td>
      <td className="px-2 py-2 text-center">
        <input
          type="checkbox"
          checked={madura}
          aria-label={`${q.nombre} madura`}
          onChange={(e) => {
            setMadura(e.target.checked)
            setTocado(true)
          }}
        />
      </td>
      <td className="px-2 py-2 text-right">{campo(min, setMin, 'Días mínimos')}</td>
      <td className="px-2 py-2 text-right">{campo(opt, setOpt, 'Días óptimos')}</td>
      <td className="px-2 py-2 text-right">{campo(max, setMax, 'Días máximos')}</td>
      <td className="px-2 py-2">
        {real ? (
          <>
            <span className="cifras text-[13px]">
              <b>{real.promedio} días</b> · {real.lotes} lote{real.lotes === 1 ? '' : 's'} (
              {real.minimo}-{real.maximo})
            </span>
            {difiere && (
              <div className="text-[11.5px] font-semibold text-atencion">difiere del cargado</div>
            )}
          </>
        ) : (
          <span className="text-tinta-suave">—</span>
        )}
      </td>
      <td className="px-2 py-2">
        <Estado confirmado={!q.dias_provisorios} />
      </td>
      <td className="px-2 py-2">
        <div className="flex items-center gap-2">
          <Boton
            onClick={() =>
              guardar.mutate(
                { id: q.id, madura, dias_minimos: min, dias_optimos: opt, dias_maximos: max },
                {
                  onSuccess: () => {
                    setTocado(false)
                    setAviso('guardado')
                  },
                },
              )
            }
          >
            {guardar.isPending ? 'Guardando…' : 'Guardar'}
          </Boton>
          {tocado && !aviso && <span className="text-[12px] text-atencion">sin guardar</span>}
          {aviso && <span className="text-[12px] text-bien">{aviso}</span>}
          {guardar.isError && (
            <span className="text-[12px] text-alerta">{guardar.error.message}</span>
          )}
        </div>
      </td>
    </tr>
  )
}
