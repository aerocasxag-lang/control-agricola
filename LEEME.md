# Control Agrícola · AeroCAS — cómo ponerla a funcionar

Versión 0.7 (25-oct-2026): todo lo de la 0.6 más seguridad: política de seguridad del contenido (solo carga código de los sitios autorizados), huellas de integridad de las librerías externas, la app no aparece en buscadores, al cerrar sesión se borran del celular los datos guardados, reglas de la base de datos más estrictas y aviso de derechos reservados (archivo LICENSE).

## Paso 1 · Pegar las reglas de seguridad (5 min)

1. En Firebase, entra a **Bases de datos y almacenamiento → Firestore Database → pestaña Reglas**.
2. Borra todo lo que hay y pega el contenido completo de `firestore.rules`.
3. Toca **Publicar**.

## Paso 2 · Publicar la app gratis en GitHub Pages (15 min, una sola vez)

1. Crea una cuenta en **github.com** (puede ser con el correo de AeroCAS). Anota tu nombre de usuario.
2. Arriba a la derecha toca **+ → New repository**. Nombre: `control-agricola`. Déjalo en **Public** y toca **Create repository**.
3. En la página del repositorio toca **uploading an existing file**.
4. Descomprime el ZIP en tu computador, abre la carpeta y **arrastra todos los archivos** (no la carpeta) a la ventana de GitHub. Toca **Commit changes**.
5. Entra a **Settings → Pages**. En «Source» elige **Deploy from a branch**, rama **main**, carpeta **/ (root)** y toca **Save**.
6. Espera 1 o 2 minutos. La app queda en: `https://TU-USUARIO.github.io/control-agricola/`

## Paso 3 · Autorizar la dirección en Firebase (2 min)

**Seguridad → Authentication → Configuración → Dominios autorizados → Agregar dominio** y escribe `TU-USUARIO.github.io`.

## Paso 4 · Instalar en el celular

1. Abre la dirección en Chrome (Android) o Safari (iPhone), **con señal**, y entra con tu correo y contraseña.
2. Android: menú ⋮ → **Agregar a la pantalla principal / Instalar**. iPhone: Compartir → **Agregar a inicio**.

## Paso 5 · Primer uso

1. **Yo → + Nuevo lote**: nombre, finca, municipio, secciones de riego, ciclo y fecha de siembra. Importa el borde con el **KML o KMZ** del lote (el mismo del plan de vuelo).
2. **Yo → + Trabajador**: nombre, correo y contraseña inicial. Entrégale los datos y la dirección de la app.
3. **Prueba sin señal**: pon el celular en modo avión, haz un registro de riego y mira que diga «En el celular». Quita el modo avión y en segundos pasa a «Pendiente» o «Aprobado».

## Cómo se actualiza

Cuando haya una versión nueva, sube en GitHub los archivos que cambien (**Add file → Upload files**, se reemplazan solos). El celular toma la versión nueva la siguiente vez que abra la app con señal.

## Qué hay y qué falta

| Ya funciona | Llega después |
| --- | --- |
| Mapa con lotes, ficha, medir, GPS, satélite, ortomosaico y vigor | Comparar el vigor entre dos vuelos |
| Los 10 registros de campo, con fotos, sin señal | Recordatorios del cultivo por días desde la siembra |
| Aprobar, rechazar, pedir corrección, anular, historial | Rendimiento estimado desde la inspección |
| Inventario, costos por lote, alertas, CSV con costo | Informes PDF y Excel con formato |
