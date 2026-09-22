# Fábrica Belgrano — Documentación

Sistema de seguimiento de producción para fábrica de lácteos y quesos, con tablets en planta.

## Documentos

| Archivo | Contenido |
|---|---|
| [01-requerimientos.md](01-requerimientos.md) | Requerimientos consolidados por sector, flujo productivo y fases |
| [02-preguntas-abiertas.md](02-preguntas-abiertas.md) | Preguntas priorizadas para la próxima charla |
| [03-glosario.md](03-glosario.md) | Términos del dominio quesero y catálogo de productos |
| [04-plan-mvp.md](04-plan-mvp.md) | Plan de fases, alcance del MVP y diseño de la primera pantalla |
| [05-piloto.md](05-piloto.md) | **Qué instalar, qué mirar y qué decidir en la semana de piloto** |
| [06-despliegue.md](06-despliegue.md) | Cómo ponerlo online para que lo vea el cliente |
| [07-laboratorio.md](07-laboratorio.md) | Análisis del material de laboratorio y qué conviene sumar al MVP |
| [08-arquitectura-nube.md](08-arquitectura-nube.md) | Salir del MVP: Supabase, qué framework y en qué orden |
| [09-cajones.md](09-cajones.md) | Formatos de cajón, pallets incompletos y el cambio a x 18 / x 20 |
| [10-online-vercel-supabase.md](10-online-vercel-supabase.md) | La versión pública en Vercel + Supabase |
| [11-pedidos-leche-yogur.md](11-pedidos-leche-yogur.md) | **Los pedidos dejan de ser sólo de queso** |

## Fuente

Los requerimientos originales son 7 notas de voz en [../requerimientos/](../requerimientos/),
transcriptas localmente en [../requerimientos/transcripciones/](../requerimientos/transcripciones/).

Hay **dos transcripciones independientes de cada audio**, con sufijos `pasada-small` y
`pasada-large` (esta última corrió con el modelo `medium`: `large-v3` no entra en la RAM disponible
de la máquina).

Las dos pasadas son **complementarias, no una mejor que la otra** — `medium` corrigió términos que
`small` erró ("la tina", "quesería", "envasado") pero perdió otros que `small` sí captó
("semidura"). Cuando dos modelos independientes coinciden en un término, es fuerte evidencia de que
el audio dice eso; cuando difieren, conviene escuchar el audio original.

## Trazabilidad

Cada afirmación en los requerimientos está referenciada al audio y minuto de origen con la
notación `[A3 01:24]` = audio 3, minuto 1:24. Lo que es interpretación y no cita está marcado
con el símbolo de inferencia.
