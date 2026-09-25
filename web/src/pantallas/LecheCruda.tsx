import { useState } from 'react'
import { useAnularEntrega, useLecheCruda, useTambos } from '../api/cliente'
import { decimal, diasAtras, fechaCorta, hhmm, hoy, num } from '../ui/formato'
import { Boton, Kpi, Panel, Tabla, Vacio, type Columna } from '../ui/primitivos'
import type { EntregaLeche, FilaTambo } from '../api/tipos'

/**
 * Litros por tambo. Este reporte reemplaza trabajo de verdad: hoy el pago a cada tambo
 * se calcula sumando las cantidades a mano. La pantalla de carga sólo mueve el tipeo de
 * lugar; esto hace desaparecer la suma.
 */
// El 1 es "Hoy": un rango de un día. Va primero porque es la pregunta más frecuente
// —"¿cómo venimos hoy?"— y porque la pantalla de consulta ya arranca ahí; que dos
// pantallas del mismo sistema ofrezcan períodos distintos obliga a reaprender cada una.
const PRESETS = [1, 7, 30, 90] as const

/** El 1 se lee "Hoy", no "1 días". */
const etiquetaPreset = (d: number) => (d === 1 ? 'Hoy' : `${d} días`)

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
  const anular = useAnularEntrega()

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
              {etiquetaPreset(d)}
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
              columnas={columnasDetalle(anular)}
              filas={data.detalle}
              claveDe={(r) => r.id}
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

/**
 * Las columnas del detalle se arman con la mutación adentro, igual que en Consulta: la
 * de anular necesita el hook, que sólo existe dentro del componente.
 */
const columnasDetalle = (
  anular: ReturnType<typeof useAnularEntrega>,
): Columna<EntregaLeche>[] => [
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
  {
    // La observación es lo primero que hay que ver antes de liquidarle al tambo: una
    // entrega cortada no se paga igual. Por eso el motivo va resaltado y no como texto
    // suelto — en una tabla de 40 filas, gris entre gris no lo ve nadie.
    titulo: 'Observación',
    celda: (r) =>
      r.motivo || r.observacion ? (
        <span className="flex flex-wrap items-baseline gap-1.5">
          {r.motivo && (
            <span className="rounded bg-alerta/15 px-1.5 py-0.5 text-[12px] font-semibold text-alerta">
              {r.motivo}
            </span>
          )}
          {r.observacion && <span className="text-[13px] text-tinta-2">{r.observacion}</span>}
        </span>
      ) : (
        <span className="text-tinta-suave">—</span>
      ),
  },
  {
    titulo: '',
    // print:hidden porque esta pantalla se imprime para liquidarle al tambo, y una
    // columna de botones en el papel es ruido.
    celda: (r) => (
      <span className="print:hidden">
        <Boton
          deshabilitado={anular.isPending}
          onClick={() => {
            // El diálogo dice el tambo y los litros, no sólo "¿confirma?": es lo único
            // que distingue una entrega de la de al lado, y anular la equivocada saldría
            // más caro que el error original.
            const q = `¿Anular la entrega del tambo ${r.tambo}, ${num(r.litros)} litros de las ${hhmm(r.fecha_hora)}?`
            if (confirm(q)) anular.mutate(r.id)
          }}
        >
          Anular
        </Boton>
      </span>
    ),
  },
]
