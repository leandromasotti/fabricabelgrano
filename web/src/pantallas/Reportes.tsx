import { useState } from 'react'
import { useCatalogo, useReporte } from '../api/cliente'
import { Apiladas } from '../graficos/Apiladas'
import { BarrasH } from '../graficos/BarrasH'
import { Columnas } from '../graficos/Columnas'
import { ProveedorTooltip } from '../graficos/Tooltip'
import { decimal, diasAtras, fechaCorta, hhmm, hoy, num } from '../ui/formato'
import { Boton, Kpi, Panel, Tabla, Tag, Vacio, type Columna } from '../ui/primitivos'
import type { RegistroTina, RendimientoQueso, ResumenReporte } from '../api/tipos'

// El 1 es "Hoy": un rango de un día. Va primero porque es la pregunta más frecuente
// —"¿cómo venimos hoy?"— y porque la pantalla de consulta ya arranca ahí; que dos
// pantallas del mismo sistema ofrezcan períodos distintos obliga a reaprender cada una.
const PRESETS = [1, 7, 30, 90] as const

/** El 1 se lee "Hoy", no "1 días". */
const etiquetaPreset = (d: number) => (d === 1 ? 'Hoy' : `${d} días`)

export function Reportes() {
  const [desde, setDesde] = useState(() => diasAtras(29))
  const [hasta, setHasta] = useState(hoy)
  const [queso, setQueso] = useState('')

  const { data, isError, error, isFetching } = useReporte({ desde, hasta, queso })
  const { data: catalogo } = useCatalogo('queseria')

  const preset = (dias: number) => {
    setDesde(diasAtras(dias - 1))
    setHasta(hoy())
  }
  const presetActivo = PRESETS.find((d) => desde === diasAtras(d - 1) && hasta === hoy())

  const descargarCsv = () => {
    const q = new URLSearchParams({ desde, hasta, queso })
    window.location.href = `/api/reportes.csv?${q}`
  }

  return (
    <ProveedorTooltip>
      <header className="mb-5">
        <h1 className="text-[23px] font-semibold">Reportes de producción</h1>
        <p className="text-[14px] text-tinta-2">
          {data ? `${fechaCorta(data.desde)} al ${fechaCorta(data.hasta)}` : 'Cargando…'}
          {isFetching && data && <span className="ml-2 text-tinta-suave">actualizando…</span>}
        </p>
      </header>

      {/* Los filtros van en una fila arriba de todo, no repartidos por la pantalla. */}
      <div className="mb-5 flex flex-wrap items-center gap-2.5 rounded-xl border border-borde bg-superficie px-3.5 py-3">
        <label className="text-[13px] text-tinta-2" htmlFor="desde">
          Desde
        </label>
        <Campo id="desde" valor={desde} alCambiar={setDesde} />
        <label className="text-[13px] text-tinta-2" htmlFor="hasta">
          Hasta
        </label>
        <Campo id="hasta" valor={hasta} alCambiar={setHasta} />

        {PRESETS.map((d) => (
          <Boton key={d} onClick={() => preset(d)} activo={presetActivo === d}>
            {etiquetaPreset(d)}
          </Boton>
        ))}

        <label className="ml-2 text-[13px] text-tinta-2" htmlFor="queso">
          Queso
        </label>
        <select
          id="queso"
          value={queso}
          onChange={(e) => setQueso(e.target.value)}
          className="rounded-md border border-eje bg-superficie px-2.5 py-1.5 text-[14px] text-tinta"
        >
          <option value="">Todos</option>
          {(catalogo?.quesos ?? []).map((q) => (
            <option key={q.id} value={q.nombre}>
              {q.nombre}
            </option>
          ))}
        </select>

        <div className="flex-1" />
        <Boton onClick={descargarCsv} variante="primario">
          Descargar CSV
        </Boton>
      </div>

      {isError && (
        <Panel>
          <Vacio>No se pudieron cargar los reportes: {error.message}</Vacio>
        </Panel>
      )}

      {data && (
        <div className="flex flex-col gap-5">
          <Kpis resumen={data.resumen} queso={queso} />

          <Panel titulo="Producción por día" nota="Piezas de queso salidas de tina">
            {data.dias.length ? <Columnas dias={data.dias} /> : <Vacio>Sin producción en el período.</Vacio>}
          </Panel>

          <div className="grid gap-5 lg:grid-cols-2">
            <Panel titulo="Piezas por tipo de queso">
              {data.rendimiento.length ? (
                <BarrasH rendimiento={data.rendimiento} />
              ) : (
                <Vacio>Sin producción en el período.</Vacio>
              )}
            </Panel>

            <Panel
              titulo="Pallets de leche por marca"
              {...(queso ? { nota: 'la leche no se filtra por tipo de queso' } : {})}
            >
              {data.lecheria.length ? (
                <Apiladas filas={data.lecheria} canonicos={data.productos} />
              ) : (
                <Vacio>Sin pallets en el período.</Vacio>
              )}
            </Panel>
          </div>

          <Panel
            titulo="Rendimiento por queso"
            nota="17 categorías con varias medidas cada una: esto es una tabla, no un gráfico"
          >
            <Tabla
              columnas={COLUMNAS_RENDIMIENTO}
              filas={data.rendimiento}
              claveDe={(r) => r.queso}
              sinDatos="Sin producción en el período."
            />
          </Panel>

          <Panel
            titulo="Detalle de tinas"
            nota={`${num(data.detalle.length)} registros · scrollean acá adentro`}
          >
            <Tabla
              columnas={COLUMNAS_DETALLE}
              filas={data.detalle}
              claveDe={(r, i) => `${r.fecha_hora}-${i}`}
              sinDatos="Sin registros con estos filtros."
              altoMax={520}
            />
          </Panel>
        </div>
      )}
    </ProveedorTooltip>
  )
}

function Campo({
  id,
  valor,
  alCambiar,
}: {
  id: string
  valor: string
  alCambiar: (v: string) => void
}) {
  return (
    <input
      id={id}
      type="date"
      value={valor}
      onChange={(e) => alCambiar(e.target.value)}
      className="rounded-md border border-eje bg-superficie px-2.5 py-1.5 text-[14px] text-tinta"
    />
  )
}

function Kpis({ resumen: r, queso }: { resumen: ResumenReporte; queso: string }) {
  const promedio = r.tinas ? Math.round(r.piezas / r.tinas) : 0
  const horas = r.minutos_a_sal != null ? decimal(r.minutos_a_sal / 60) : null
  // La leche y el yogur no se filtran por tipo de queso porque no tienen uno. Con un
  // filtro puesto siguen siendo totales, y eso se aclara en el número mismo: dos
  // cifras que no responden al mismo filtro no pueden verse iguales.
  const sinFiltrar = queso ? 'no filtra por queso' : undefined

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Kpi valor={num(r.piezas)} titulo="Piezas producidas" />
      <Kpi valor={num(r.tinas)} titulo="Tinas" />
      <Kpi valor={num(promedio)} titulo="Piezas por tina" nota="promedio del período" />
      <Kpi valor={num(r.pallets)} titulo="Pallets de leche" {...(sinFiltrar ? { nota: sinFiltrar } : {})} />
      {/* El cliente razona en litros, no en pallets: 1 pallet = 70 cajas × 12 L. */}
      <Kpi
        valor={num(r.litros)}
        titulo="Litros de leche"
        nota={sinFiltrar ?? 'según el formato de cada pallet'}
      />
      <Kpi
        valor={num(r.yogur_bins)}
        titulo="Bins de yogur"
        nota={sinFiltrar ?? `≈ ${num(r.yogur_unidades)} sachets · estimado`}
      />
      <Kpi valor={num(r.en_sal)} titulo="En sal ahora" nota="no depende del período" />
      <Kpi
        valor={horas != null ? `${horas} h` : '—'}
        titulo="Producción → sal"
        // Mediana y no promedio: una tina marcada al otro día vale miles de minutos y
        // desplaza el promedio, pero no mueve la mediana. Las demoras se cuentan
        // aparte porque una tina marcada 20 h tarde es en sí misma una señal.
        nota={
          horas == null
            ? 'sin datos todavía'
            : `mediana de ${r.muestras_a_sal} tinas` +
              (r.tardias ? ` · ${r.tardias} marcada${r.tardias === 1 ? '' : 's'} +12 h tarde` : '')
        }
      />
    </div>
  )
}

const COLUMNAS_RENDIMIENTO: Columna<RendimientoQueso>[] = [
  { titulo: 'Queso', celda: (r) => r.queso },
  { titulo: 'Familia', celda: (r) => <Tag>{r.familia}</Tag> },
  { titulo: 'Tinas', num: true, celda: (r) => num(r.tinas) },
  { titulo: 'Piezas', num: true, celda: (r) => num(r.piezas) },
  { titulo: 'Promedio', num: true, celda: (r) => r.promedio },
  { titulo: 'Mínimo', num: true, celda: (r) => r.minimo },
  { titulo: 'Máximo', num: true, celda: (r) => r.maximo },
  {
    titulo: 'Variación',
    num: true,
    // Con una sola tina no hay variación que medir, y un "0" se leería como
    // "rinde siempre igual", que es lo contrario de lo que pasa.
    celda: (r) => (r.tinas > 1 ? `± ${r.maximo - r.minimo}` : '—'),
  },
]

const COLUMNAS_DETALLE: Columna<RegistroTina>[] = [
  { titulo: 'Fecha', celda: (r) => new Date(r.fecha_hora).toLocaleDateString('es-AR') },
  { titulo: 'Hora', celda: (r) => hhmm(r.fecha_hora) },
  { titulo: 'Queso', celda: (r) => r.queso },
  { titulo: 'Piezas', num: true, celda: (r) => num(r.cantidad) },
  { titulo: 'Operario', celda: (r) => r.operario },
  { titulo: '', celda: (r) => (r.origen === 'offline' ? <Tag>offline</Tag> : null) },
]
