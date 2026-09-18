// Formato de números y fechas, en un solo lugar.
//
// Todo lo que se muestra en pantalla pasa por acá. Cuando el mismo número aparece en
// un KPI y en una tabla con dos formatos distintos, el que lee asume que son dos
// números distintos.

export const num = (n: number | null | undefined): string => (n ?? 0).toLocaleString('es-AR')

export const kilos = (gramos: number): string => (gramos / 1000).toFixed(3).replace('.', ',')

/** Un decimal, con coma: en es-AR "3.1 h" se lee como tres mil cien. */
export const decimal = (n: number, decimales = 1): string =>
  n.toLocaleString('es-AR', { minimumFractionDigits: decimales, maximumFractionDigits: decimales })

/**
 * Una fecha `YYYY-MM-DD` es un día del calendario, no un instante.
 * `new Date('2026-08-15')` la interpreta como medianoche UTC y al formatearla en local
 * cae al día anterior. Ese bug ya se comió un día entero en los reportes; el sufijo
 * `T00:00` es lo que lo evita.
 */
export const dia = (iso: string): Date => new Date(`${iso}T00:00`)

export const fechaCorta = (iso: string): string => dia(iso).toLocaleDateString('es-AR')

export const fechaLarga = (iso: string): string =>
  dia(iso).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })

export const hhmm = (instante: string): string =>
  new Date(instante).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

/** Hoy en local, en formato `YYYY-MM-DD`. El truco de 'sv-SE' es que ya sale ISO. */
export const hoy = (): string => new Date().toLocaleDateString('sv-SE')

export const diasAtras = (n: number): string =>
  new Date(Date.now() - n * 864e5).toLocaleDateString('sv-SE')
