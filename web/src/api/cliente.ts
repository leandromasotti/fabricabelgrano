import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  Catalogo,
  Cliente,
  DiasReales,
  Envase,
  FormatoYogur,
  LineaNueva,
  Pedido,
  PedidoDetalle,
  QuesoDias,
  DiaLecheria,
  Reporte,
  Maestros,
  OpcionTablet,
  ReporteLecheCruda,
  SeccionTablero,
  TipoMaestro,
  Tambo,
} from './tipos'

export class ErrorApi extends Error {
  constructor(
    readonly estado: number,
    mensaje: string,
  ) {
    super(mensaje)
    this.name = 'ErrorApi'
  }
}

type Params = Record<string, string | number | undefined>

function conQuery(ruta: string, params?: Params): string {
  if (!params) return ruta
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') q.set(k, String(v))
  }
  const s = q.toString()
  return s ? `${ruta}?${s}` : ruta
}

export async function traer<T>(ruta: string, params?: Params): Promise<T> {
  const res = await fetch(conQuery(ruta, params))
  if (!res.ok) {
    // El servidor contesta { error } en los casos previstos; en un 500 puede venir
    // cualquier cosa. Se intenta leer el mensaje y si no, se usa el estado.
    const cuerpo = (await res.json().catch(() => null)) as { error?: string } | null
    throw new ErrorApi(res.status, cuerpo?.error ?? `Error ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function enviar<T>(ruta: string, cuerpo?: unknown): Promise<T> {
  const res = await fetch(ruta, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo ?? {}),
  })
  if (!res.ok) {
    const c = (await res.json().catch(() => null)) as { error?: string } | null
    throw new ErrorApi(res.status, c?.error ?? `Error ${res.status}`)
  }
  return res.json() as Promise<T>
}

// ---------------------------------------------------------------- hooks

/**
 * Las claves llevan los parámetros adentro: cambiar el filtro es otra consulta, no la
 * misma con otro argumento. Eso es lo que evita que una respuesta lenta de un filtro
 * viejo pise a una rápida del nuevo — la carrera silenciosa que ya nos mordió una vez
 * con las fechas.
 */
export const claves = {
  reportes: (p: Params) => ['reportes', p] as const,
  catalogo: (sector: string) => ['catalogo', sector] as const,
  pedidos: () => ['pedidos'] as const,
  pedido: (id: number) => ['pedido', id] as const,
  clientes: () => ['clientes'] as const,
  lecheCruda: (p: Params) => ['leche-cruda', p] as const,
  tambos: () => ['tambos'] as const,
  lecheria: (p: Params) => ['lecheria', p] as const,
  secciones: () => ['tablero-secciones'] as const,
  opcionesTablet: () => ['tablets-opciones'] as const,
  maestros: () => ['maestros'] as const,
  quesosDias: () => ['quesos-dias'] as const,
  envases: () => ['envases'] as const,
}

export function useReporte(params: { desde: string; hasta: string; queso?: string }) {
  return useQuery({
    queryKey: claves.reportes(params),
    queryFn: () => traer<Reporte>('/api/reportes', params),
    // Al cambiar el rango, la pantalla mantiene los datos anteriores en lugar de
    // parpadear a vacío. Los gráficos no saltan y se ve que está cargando.
    placeholderData: (previo) => previo,
  })
}

/**
 * El catálogo es la lista estable de quesos, marcas y operarios de un sector.
 *
 * Los desplegables de filtro salen de acá y NO de la respuesta del reporte: el reporte
 * ya viene filtrado, así que alimentar el `<select>` con él deja una sola opción
 * adentro apenas se elige un queso, y no se puede cambiar a otro sin limpiar el
 * filtro. Un control que se destruye a sí mismo al usarlo.
 */
export function useCatalogo(sector: string) {
  return useQuery({
    queryKey: claves.catalogo(sector),
    queryFn: () => traer<Catalogo>('/api/catalogo', { sector }),
    // Cambia cuando alguien edita el catálogo, que no pasa durante una sesión.
    staleTime: 10 * 60_000,
  })
}

export function useLecheCruda(params: { desde: string; hasta: string; tambo?: string }) {
  return useQuery({
    queryKey: claves.lecheCruda(params),
    queryFn: () => traer<ReporteLecheCruda>('/api/recepciones/reporte', params),
    placeholderData: (previo) => previo,
  })
}

export function useTambos() {
  return useQuery({
    queryKey: claves.tambos(),
    queryFn: () => traer<Tambo[]>('/api/tambos'),
    staleTime: 10 * 60_000,
  })
}

export function useLecheria(params: { desde: string; hasta: string; pagina: number }) {
  return useQuery({
    queryKey: claves.lecheria(params),
    queryFn: () => traer<DiaLecheria>('/api/registros', params),
    placeholderData: (previo) => previo,
  })
}

/** Anular un pallet: la corrección que queda fuera de la ventana de 60 s de la tablet. */
export function useAnularPallet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => enviar<unknown>(`/api/registros/${id}/anular`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['lecheria'] }),
  })
}

/**
 * Lo mismo para una entrega de leche cruda.
 *
 * El endpoint existía desde el principio pero sólo lo usaba la tablet, dentro de su
 * ventana de 60 s. Una entrega mal cargada que se descubría más tarde —el tambo
 * equivocado, los litros de otra— no se podía arreglar desde ninguna pantalla.
 */
export function useAnularEntrega() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => enviar<unknown>(`/api/recepciones/${id}/anular`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['leche-cruda'] }),
  })
}

export function useSeccionesTablero() {
  return useQuery({
    queryKey: claves.secciones(),
    queryFn: () => traer<SeccionTablero[]>('/api/tablero/secciones'),
  })
}

export function useCambiarSeccion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ clave, visible }: { clave: string; visible: boolean }) =>
      actualizar<SeccionTablero[]>(`/api/tablero/secciones/${clave}`, { visible }),
    // La respuesta ya trae la lista completa, así que se escribe directo en la caché en
    // vez de invalidar y volver a pedir: el interruptor no parpadea.
    onSuccess: (lista) => qc.setQueryData(claves.secciones(), lista),
  })
}

export function useMaestros() {
  return useQuery({
    queryKey: claves.maestros(),
    queryFn: () => traer<Maestros>('/api/maestros'),
  })
}

/**
 * Alta, edición y baja de los cuatro maestros.
 *
 * Cada respuesta trae la lista completa de ese tipo, así que se escribe directo en la
 * caché: la pantalla no parpadea y no hay una segunda vuelta al servidor. También se
 * invalida el catálogo, que es lo que consumen las tablets — un operario nuevo tiene que
 * aparecer ahí sin que nadie recargue nada.
 */
function useMutarMaestro<T>(
  fn: (v: T & { tipo: TipoMaestro }) => Promise<unknown[]>,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (lista, v) => {
      qc.setQueryData(claves.maestros(), (previo: Maestros | undefined) =>
        previo ? { ...previo, [v.tipo]: lista } : previo,
      )
      void qc.invalidateQueries({ queryKey: ['catalogo'] })
      void qc.invalidateQueries({ queryKey: claves.clientes() })
      void qc.invalidateQueries({ queryKey: claves.tambos() })
    },
  })
}

export function useCrearMaestro() {
  return useMutarMaestro<{ datos: Record<string, unknown> }>(({ tipo, datos }) =>
    enviar<unknown[]>(`/api/maestros/${tipo}`, datos),
  )
}

export function useEditarMaestro() {
  return useMutarMaestro<{ id: number; datos: Record<string, unknown> }>(({ tipo, id, datos }) =>
    actualizar<unknown[]>(`/api/maestros/${tipo}/${id}`, datos),
  )
}

export function useVisibilidadMaestro() {
  return useMutarMaestro<{ id: number; activo?: boolean; orden?: number }>(
    ({ tipo, id, ...v }) => actualizar<unknown[]>(`/api/maestros/${tipo}/${id}/visibilidad`, v),
  )
}

export function useOpcionesTablet() {
  return useQuery({
    queryKey: claves.opcionesTablet(),
    queryFn: () => traer<OpcionTablet[]>('/api/tablets/opciones'),
  })
}

export function useCambiarOpcionTablet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ clave, activo }: { clave: string; activo: boolean }) =>
      actualizar<OpcionTablet[]>(`/api/tablets/opciones/${clave}`, { activo }),
    onSuccess: (lista) => {
      qc.setQueryData(claves.opcionesTablet(), lista)
      // El catálogo lleva estas opciones, y es lo que consumen las tablets.
      void qc.invalidateQueries({ queryKey: ['catalogo'] })
    },
  })
}

export function useQuesosDias() {
  return useQuery({
    queryKey: claves.quesosDias(),
    queryFn: () => traer<{ quesos: QuesoDias[]; reales: DiasReales[] }>('/api/quesos/dias'),
  })
}

export function useEnvases() {
  return useQuery({
    queryKey: claves.envases(),
    queryFn: () => traer<{ pallets: Envase[]; yogur: FormatoYogur[] }>('/api/envases'),
  })
}

async function actualizar<T>(ruta: string, cuerpo: unknown): Promise<T> {
  const res = await fetch(ruta, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
  })
  if (!res.ok) {
    const c = (await res.json().catch(() => null)) as { error?: string } | null
    throw new ErrorApi(res.status, c?.error ?? `Error ${res.status}`)
  }
  return res.json() as Promise<T>
}

/** Formato de pallet. La respuesta dice cuántos pallets viejos quedaron completados. */
export function useGuardarEnvase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...v }: { id: number; bultos_por_pallet: string; unidades_por_bulto: string; litros_por_unidad: string }) =>
      actualizar<Envase & { pallets_rellenados: number }>(`/api/envases/${id}`, v),
    onSuccess: () => void qc.invalidateQueries({ queryKey: claves.envases() }),
  })
}

/** Activar, desactivar y reordenar. Separado de los números a propósito. */
export function useVisibilidadEnvase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...v }: { id: number; activo?: boolean; orden?: number }) =>
      actualizar<Envase>(`/api/envases/${id}/visibilidad`, v),
    onSuccess: () => void qc.invalidateQueries({ queryKey: claves.envases() }),
  })
}

export function useCrearEnvase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: {
      nombre: string
      bultos_por_pallet: string
      unidades_por_bulto: string
      litros_por_unidad: string
    }) => enviar<Envase>('/api/envases', v),
    onSuccess: () => void qc.invalidateQueries({ queryKey: claves.envases() }),
  })
}

export function useGuardarFormatoYogur() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...v }: { id: number; unidades_por_bin: string; kilos_por_unidad: string }) =>
      actualizar<{ ok: true; bins_rellenados: number }>(`/api/yogur/formato/${id}`, v),
    onSuccess: () => void qc.invalidateQueries({ queryKey: claves.envases() }),
  })
}

export function useGuardarDias() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...v }: { id: number; madura: boolean; dias_minimos: string; dias_optimos: string; dias_maximos: string }) =>
      actualizar<QuesoDias>(`/api/quesos/${id}/dias`, v),
    onSuccess: () => void qc.invalidateQueries({ queryKey: claves.quesosDias() }),
  })
}

// ---------------------------------------------------------------- pedidos

/** Lo que mira el encargado mientras la planta arma. Se refresca solo. */
export function usePedidos() {
  return useQuery({
    queryKey: claves.pedidos(),
    queryFn: () => traer<{ pedidos: Pedido[] }>('/api/pedidos'),
    refetchInterval: 5_000,
    // Sigue latiendo con la pestaña de fondo: la pantalla vive en un monitor al
    // costado del escritorio y casi nunca tiene el foco.
    refetchIntervalInBackground: true,
    staleTime: 0,
  })
}

/**
 * Detalle de un pedido, SOLO mientras su tarjeta está desplegada.
 *
 * La versión anterior lo pedía para todas las tarjetas en cada refresco: con 21
 * pedidos en el tablero eran 264 requests por minuto, la mayoría de detalles que
 * nadie estaba mirando. El `enabled` es toda la diferencia.
 */
export function usePedido(id: number, habilitado: boolean) {
  return useQuery({
    queryKey: claves.pedido(id),
    queryFn: () => traer<PedidoDetalle>(`/api/pedidos/${id}`),
    enabled: habilitado,
    refetchInterval: habilitado ? 5_000 : false,
  })
}

export function useClientes() {
  return useQuery({
    queryKey: claves.clientes(),
    queryFn: () => traer<Cliente[]>('/api/clientes'),
    staleTime: 10 * 60_000,
  })
}

/**
 * Acciones sobre un pedido. Al terminar se invalida la lista en vez de recargarla a
 * mano: si mañana hay dos pantallas mirando lo mismo, las dos se enteran.
 */
export function useAccionPedido() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, accion }: { id: number; accion: 'facturar' | 'reabrir' | 'anular' }) =>
      enviar<unknown>(`/api/pedidos/${id}/${accion}`),
    onSuccess: (_d, { id }) => {
      void qc.invalidateQueries({ queryKey: claves.pedidos() })
      void qc.invalidateQueries({ queryKey: claves.pedido(id) })
    },
  })
}

export function useCrearPedido() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (p: { cliente_id: number; lineas: LineaNueva[]; nota?: string }) =>
      enviar<PedidoDetalle>('/api/pedidos', {
        // client_id lo genera el cliente y es UNIQUE en la base: si el encargado
        // aprieta dos veces, o la respuesta se pierde y reintenta, se guarda uno solo.
        client_id: crypto.randomUUID(),
        origen: 'encargado',
        ...p,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: claves.pedidos() }),
  })
}
