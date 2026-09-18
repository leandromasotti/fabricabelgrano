Esta carpeta está vacía a propósito.

Vercel sirve como archivos estáticos lo que encuentre en el directorio de salida, y por
defecto ese directorio es `public/`. Si lo hiciera, las tablets y el tablero saldrían por
el CDN **sin pasar por Express** — y por lo tanto sin pasar por la clave de acceso, que es
justamente lo que protege el prototipo cuando está en internet.

Apuntando la salida a una carpeta vacía, no hay estáticos que ganarle al `rewrite`, y todo
—API, tablets, tablero y escritorio— entra por el mismo Express que corre en la fábrica.
Los archivos de `public/` igual viajan en la función, declarados en `includeFiles`.
