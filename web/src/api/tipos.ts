// Tipos del dominio, escritos contra las respuestas reales de la API.
//
// Están a mano y no generados porque la API no publica un esquema todavía. Cuando se
// rehaga en Postgres nativo conviene generarlos; mientras tanto, esto ya es más de lo
// que había: el bug que rompió la pantalla de envasado fue un `id` del HTML que no
// coincidía con el JS, y es exactamente la clase de cosa que acá no compila.

/** Un booleano que puede venir como 0/1: SQLite no tiene BOOLEAN y Postgres sí. */
export type BoolApi = boolean | 0 | 1

export type Familia = 'leche' | 'yogur'

export interface Operario {
  id: number
  nombre: string
}

export interface Marca {
  id: number
  nombre: string
}

export interface Producto {
  id: number
  nombre: string
  unidades_por_bin: number | null
  kilos_por_unidad: number | null
  datos_provisorios: BoolApi
}

export interface TipoQueso {
  id: number
  nombre: string
  familia: string
  se_envasa: BoolApi
}

export interface QuesoDias extends TipoQueso {
  madura: BoolApi
  dias_minimos: number | null
  dias_optimos: number | null
  dias_maximos: number | null
  dias_provisorios: BoolApi
}

export interface FormatoYogur {
  id: number
  nombre: string
  unidades_por_bin: number | null
  kilos_por_unidad: number | null
  datos_provisorios: BoolApi
  kilos_por_bin: number | null
  bins: number
  /** Bins ya cargados sin kilos: completar el peso los va a completar a ellos. */
  bins_sin_kilos: number
}

/** Días que efectivamente tardaron los lotes que ya salieron de cámara. */
export interface DiasReales {
  queso: string
  lotes: number
  promedio: number
  minimo: number
  maximo: number
}

export interface Envase {
  id: number
  nombre: string
  bultos_por_pallet: number | null
  unidades_por_bulto: number | null
  litros_por_unidad: number | null
  litros_por_pallet: number | null
  provisorio: BoolApi
  activo: BoolApi
  /** Posición en la lista de la tablet. El más usado va primero. */
  orden: number
  pallets: number
}

export interface Catalogo {
  operarios: Operario[]
  marcas: Marca[]
  productos: Producto[]
  quesos: TipoQueso[]
  envases: Envase[]
}

// ---------------------------------------------------------------- reportes

export interface ResumenReporte {
  piezas: number
  tinas: number
  pallets: number
  litros: number
  yogur_bins: number
  yogur_unidades: number
  en_sal: number
  /** Mediana, no promedio: una tina marcada al otro día no puede mover este número. */
  minutos_a_sal: number | null
  muestras_a_sal: number
  /** Tinas marcadas más de 12 h tarde. Se cuentan aparte en vez de descartarlas. */
  tardias: number
}

export interface DiaReporte {
  fecha: string
  piezas: number
  tinas: number
  pallets: number
  litros: number
}

export interface RendimientoQueso {
  queso: string
  familia: string
  tinas: number
  piezas: number
  promedio: number
  minimo: number
  maximo: number
}

export interface FilaLecheria {
  marca: string
  producto: string
  pallets: number
  litros: number
}

export interface FilaYogur {
  marca: string
  sabor: string
  bins: number
  unidades: number
  kilos: number
}

export interface RegistroTina {
  fecha_hora: string
  queso: string
  cantidad: number
  operario: string
  origen: 'online' | 'offline'
}

export interface Reporte {
  desde: string
  hasta: string
  resumen: ResumenReporte
  dias: DiaReporte[]
  rendimiento: RendimientoQueso[]
  lecheria: FilaLecheria[]
  yogur: FilaYogur[]
  /**
   * Orden canónico de productos, servido por el backend.
   * De acá sale el color de cada serie. Si saliera del orden de los datos filtrados,
   * cambiar el rango de fechas repintaría las series y comparar dos períodos
   * induciría a error.
   */
  productos: string[]
  detalle: RegistroTina[]
}

// ---------------------------------------------------------------- pedidos

export type EstadoPedido = 'pendiente' | 'armando' | 'listo' | 'facturado'

export interface Cliente {
  id: number
  nombre: string
}

/** Fila de la lista. Trae los totales ya calculados, no las líneas. */
export interface Pedido {
  id: number
  estado: EstadoPedido
  origen: 'tablet' | 'encargado'
  creado_en: string
  armado_en: string | null
  facturado_en: string | null
  cliente: string
  armador: string | null
  piezas: number
  piezas_pedidas: number
  /** Gramos enteros, nunca kilos con coma: este número termina en una factura. */
  gramos: number
  /** Cantidad de líneas, no las líneas. Para eso está el detalle. */
  lineas: number
}

export interface PesoPieza {
  id: number
  gramos: number
  fecha_hora: string
  origen: 'online' | 'offline'
}

export interface LineaPedido {
  id: number
  tipo_queso_id: number
  cantidad_pedida: number
  queso: string
  familia: string
  pesos: PesoPieza[]
  piezas: number
  gramos: number
  /** Entregado menos pedido. Puede ser negativo: el sistema lo muestra, no lo impide. */
  diferencia: number
}

export interface PedidoDetalle extends Omit<Pedido, 'lineas'> {
  client_id: string
  nota: string | null
  anulado: BoolApi
  lineas: LineaPedido[]
}

export interface LineaNueva {
  tipo_queso_id: number
  cantidad_pedida: number
}

// ---------------------------------------------------------------- leche cruda

export interface Tambo {
  id: number
  numero: number
  nombre: string | null
}

export interface FilaTambo {
  tambo: number
  nombre: string | null
  entregas: number
  litros: number
  temp_promedio: number | null
  temp_maxima: number | null
  primera: string
  ultima: string
}

export interface EntregaLeche {
  fecha_hora: string
  tambo: number
  litros: number
  temperatura: number | null
  remito: string | null
  operario: string
}

export interface ReporteLecheCruda {
  desde: string
  hasta: string
  por_tambo: FilaTambo[]
  por_dia: { fecha: string; entregas: number; litros: number }[]
  detalle: EntregaLeche[]
  total: { litros: number; entregas: number; tambos: number }
}

// ---------------------------------------------------------------- lechería

export interface RegistroPallet {
  id: number
  client_id: string
  fecha_hora: string
  origen: 'online' | 'offline'
  anulado: BoolApi
  litros: number | null
  operario: string
  marca: string
  producto: string
  envase: string | null
  /** Lo que realmente entró en el pallet, congelado en el alta. */
  bultos: number | null
  unidades_por_bulto: number | null
  /** Lo que el formato dice que entra. Sirve para saber si el pallet fue completo. */
  bultos_formato: number | null
}

export interface DiaLecheria {
  /** Igual a `hasta`. Se conserva por compatibilidad con quien ya la leía. */
  fecha: string
  desde: string
  hasta: string
  /**
   * Los totales son del PERÍODO completo, no de la página: los calcula la base. Si se
   * sumaran sobre la página cambiarían al pasar de página y no serían el total de nada.
   */
  total: number
  litros: number
  /** Pallets cuyo formato todavía no tiene equivalencia: no suman litros. */
  sin_litros: number
  por_producto: { producto: string; n: number }[]
  pagina: number
  por_pagina: number
  paginas: number
  /** Filas del período, anuladas incluidas. Es lo que se pagina. */
  filas: number
  /** Sólo la página pedida. Incluye anulados, que se muestran como tales. */
  registros: RegistroPallet[]
}

// ---------------------------------------------------------------- tablero LED

export interface SeccionTablero {
  clave: string
  nombre: string
  descripcion: string | null
  visible: BoolApi
}

// ---------------------------------------------------------------- datos maestros

export interface Sector {
  clave: string
  nombre: string
}

/** Lo común a los cuatro maestros: nada se borra, se da de baja. */
interface Maestro {
  id: number
  activo: BoolApi
  orden: number
  /** Cuántos registros vivos lo referencian. Para mirar antes de tocar algo. */
  usos: number
}

export interface OperarioMaestro extends Maestro {
  nombre: string
  sector: string
}

export interface ClienteMaestro extends Maestro {
  nombre: string
}

export interface TamboMaestro extends Maestro {
  /** La clave con la que la fábrica los conoce: el remito dice "tambo 14". */
  numero: number
  nombre: string | null
}

export interface MarcaMaestro extends Maestro {
  nombre: string
  es_propia: BoolApi
  /** Qué produce. La lechería filtra por esto: el yogur va en dos marcas, no en tres. */
  familias: string[]
}

export interface Maestros {
  sectores: Sector[]
  operarios: OperarioMaestro[]
  clientes: ClienteMaestro[]
  tambos: TamboMaestro[]
  marcas: MarcaMaestro[]
}

export type TipoMaestro = 'operarios' | 'clientes' | 'tambos' | 'marcas'
