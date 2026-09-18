import { useState } from 'react'
import { useLecheCruda, useTambos } from '../api/cliente'
import { decimal, diasAtras, fechaCorta, hhmm, hoy, num } from '../ui/formato'
import { Boton, Kpi, Panel, Tabla, Vacio, type Columna } from '../ui/primitivos'
import type { EntregaLeche, FilaTambo } from '../api/tipos'

/**
 * Litros por tambo. Este reporte reemplaza trabajo de verdad: hoy el pago a cada tambo
 * se calcula sumando las cantidades a mano. La pantalla de carga sólo mueve el tipeo de
 * lugar; esto hace desaparecer la suma.
 */
const PRESETS = [7, 30, 90] as const

/**
 * Umbral provisorio: la leche tiene que llegar fría y por encima de esto conviene
 * mirarla. Falta el límite real de la fábrica.
 */
const TEMP_ALTA = 8

const grados = (t: number | null) => (t == null ? '—' : `${decimal(t)} °C`)

export function LecheCruda() {
  const [desde, setDesde] = useState(() => diasAtras(29))
  const [hasta, setHasta] = useState(hoy)
  const [tambo, setTambo] = useState('')

  const { data, isError, error, isFetching } = useLecheCruda({ desde, hasta, tambo })
  const { data: tambos } = useTambos()

  const preset = (dias: number) => {
    setDesde(diasAtras(dias - 1))
    setHasta(hoy())
  }
  const activo = PRESETS.find((d) => desde === diasAtras(d - 1) && hasta === hoy())

  const query = new URLSearchParams({ desde, hasta, tambo }).toString()
  const dias = data?.por_dia.length || 1

  return (
    <>
      <div className="no-imprimir">
        <header className="mb-5">
          <h1 className="text-[23px] font-semibold">Leche cruda por tambo</h1>
          <p className="text-[14px] text-tinta-2">
            {data ? `${fechaCorta(data.desde)} al ${fechaCorta(data.hasta)}` : 'Cargando…'}
            {isFetching && data && <span className="ml-2 text-tinta-suave">actualizando…</span>}
          </p>
        </header>

        <div className="mb-5 flex flex-wrap items-center gap-2.5 rounded-xl border border-borde bg-superficie px-3.5 py-3">
          <label className="text-[13px] text-tinta-2" htmlFor="desde">
            Desde
          </label>
          <input
            id="desde"
            type="date"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
            className="rounded-md border border-eje bg-superficie px-2.5 py-1.5 text-[14px] text-tinta"
          />
          <label className="text-[13px] text-tinta-2" htmlFor="hasta">
            Hasta
          </label>
          <input
            id="hasta"
            type="date"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
            className="rounded-md border border-eje bg-superficie px-2.5 py-1.5 text-[14px] text-tinta"
          />
          {PRESETS.map((d) => (
            <Boton key={d} onClick={() => preset(d)} activo={activo === d}>
              {d} días
            </Boton>
          ))}

          <label className="ml-2 text-[13px] text-tinta-2" htmlFor="tambo">
            Tambo
          </label>
          {/* El desplegable sale del catálogo de tambos y no del reporte: filtrado por
              uno, el reporte devuelve ese solo y el control se quedaría sin opciones. */}
          <select
            id="tambo"
            value={tambo}
            onChange={(e) => setTambo(e.target.value)}
            className="rounded-md border border-eje bg-superficie px-2.5 py-1.5 text-[14px] text-tinta"
          >
            <option value="">Todos</option>
            {(tambos ?? []).map((t) => (
              <option key={t.id} value={t.numero}>
                {t.nombre ? `${t.numero} · ${t.nombre}` : t.numero}
              </option>
            ))}
          </select>

          <div className="flex-1" />
          <Boton onClick={() => (window.location.href = `/api/recepciones.csv?${query}`)}>
            Descargar CSV
          </Boton>
          <Boton onClick={() => window.print()} variante="primario">
            Imprimir
          </Boton>
        </div>

        {isError && (
          <Panel>
            <Vacio>No se pudo cargar el reporte: {error.message}</Vacio>
          </Panel>
        )}
      </div>

      {data && (
        <div className="flex flex-col gap-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi valor={num(data.total.litros)} titulo="Litros recibidos" />
            <Kpi valor={num(data.total.entregas)} titulo="Entregas" />
            <Kpi valor={num(data.total.tambos)} titulo="Tambos" />
            <Kpi
              valor={num(Math.round(data.total.litros / dias))}
              titulo="Litros por día"
              nota={`sobre ${dias} día${dias === 1 ? '' : 's'} con entregas`}
            />
          </div>

          <Panel titulo="Por tambo" nota="Esto es lo que hoy se suma a mano para liquidar">
            <Tabla
              columnas={COLUMNAS_TAMBO}
              filas={data.por_tambo}
              claveDe={(r) => r.tambo}
              sinDatos="Sin recepciones en el período."
              pie={['TOTAL', num(data.total.entregas), num(data.total.litros), null, null, null, null]}
            />
          </Panel>

          <Panel
            titulo="Detalle de entregas"
            nota={`${num(data.detalle.length)} entregas`}
          >
            <Tabla
              columnas={COLUMNAS_DETALLE}
              filas={data.detalle}
              claveDe={(r, i) => `${r.fecha_hora}-${i}`}
              sinDatos="Sin entregas con estos filtros."
              altoMax={460}
            />
          </Panel>

          {/* Sólo se ve en papel: el que recibe la hoja tiene que saber de qué período
              es y cuándo se emitió, o el número queda sin contexto. */}
          <p className="hidden text-[11px] text-tinta-2 print:block">
            Período {fechaCorta(data.desde)} al {fechaCorta(data.hasta)} · emitido el{' '}
            {new Date().toLocaleString('es-AR')}
          </p>
        </div>
      )}
    </>
  )
}

const COLUMNAS_TAMBO: Columna<FilaTambo>[] = [
  { titulo: 'Tambo', celda: (r) => (r.nombre ? `${r.tambo} · ${r.nombre}` : String(r.tambo)) },
  { titulo: 'Entregas', num: true, celda: (r) => num(r.entregas) },
  { titulo: 'Litros', num: true, celda: (r) => num(r.litros) },
  { titulo: 'Promedio', num: true, celda: (r) => num(Math.round(r.litros / r.entregas)) },
  { titulo: 'Temp. prom.', num: true, celda: (r) => grados(r.temp_promedio) },
  {
    // La máxima es la que importa para calidad: un promedio tibio esconde un pico.
    titulo: 'Temp. máx.',
    num: true,
    celda: (r) => (
      <span className={(r.temp_maxima ?? 0) > TEMP_ALTA ? 'font-bold text-alerta' : ''}>
        {grados(r.temp_maxima)}
      </span>
    ),
  },
  { titulo: 'Última entrega', celda: (r) => fechaCorta(r.ultima) },
]

const COLUMNAS_DETALLE: Columna<EntregaLeche>[] = [
  { titulo: 'Fecha', celda: (r) => new Date(r.fecha_hora).toLocaleDateString('es-AR') },
  { titulo: 'Hora', celda: (r) => hhmm(r.fecha_hora) },
  { titulo: 'Tambo', celda: (r) => String(r.tambo) },
  { titulo: 'Litros', num: true, celda: (r) => num(r.litros) },
  {
    titulo: 'Temp.',
    num: true,
    celda: (r) => (
      <span className={(r.temperatura ?? 0) > TEMP_ALTA ? 'font-bold text-alerta' : ''}>
        {grados(r.temperatura)}
      </span>
    ),
  },
  { titulo: 'Operario', celda: (r) => r.operario },
]
