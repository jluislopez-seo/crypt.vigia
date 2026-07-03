# Ledger — Panel de acciones y cuentas X

Dashboard estático (HTML/CSS/JS puro, sin build) listo para publicar en GitHub Pages.

## Qué incluye

- **Lista de acciones personalizable**: añade cualquier ticker (AAPL, TSLA, ITX.MC…), se guarda en `localStorage` del navegador.
- **Precios reales** vía la API gratuita de [Finnhub](https://finnhub.io/register) (60 peticiones/min gratis, sin tarjeta).
- **Buscador de símbolos** en la barra superior con autocompletado.
- **Gráfico principal** con Chart.js, construido a partir de los precios capturados desde que abriste el panel (sesión en vivo).
- **Cinta de cotizaciones** animada en la parte superior, estilo bolsa.
- **Cuentas de X**: añade cualquier @usuario público y verás su timeline incrustado con el widget oficial de X/Twitter.
- **Ajustes**: clave API, frecuencia de actualización, borrado de datos.

Todo el estado (acciones, cuentas X, clave API) se guarda en el `localStorage` de tu navegador. No hay servidor propio ni base de datos: es 100% estático, por eso funciona perfecto en GitHub Pages.

## Publicar en GitHub Pages (5 minutos)

1. Crea un repositorio nuevo en GitHub (puede ser público o privado si tienes plan Pro), por ejemplo `stock-dashboard`.
2. Sube estos 3 archivos a la raíz del repositorio: `index.html`, `styles.css`, `app.js`.
   - Puedes arrastrarlos directamente desde la web de GitHub ("Add file → Upload files") o con git:
     ```bash
     git init
     git add index.html styles.css app.js
     git commit -m "Panel de acciones inicial"
     git branch -M main
     git remote add origin https://github.com/TU-USUARIO/stock-dashboard.git
     git push -u origin main
     ```
3. En el repositorio, ve a **Settings → Pages**.
4. En "Build and deployment" selecciona **Source: Deploy from a branch**, rama `main`, carpeta `/ (root)`. Guarda.
5. Espera 1-2 minutos. Tu panel quedará publicado en `https://TU-USUARIO.github.io/stock-dashboard/`.

## Activar precios reales

1. Ve a [finnhub.io/register](https://finnhub.io/register) y crea una cuenta gratuita.
2. Copia tu API key desde el dashboard de Finnhub.
3. En tu panel, ve a **Ajustes → Clave API de Finnhub**, pégala y pulsa Guardar.
4. A partir de ahí, cada acción que añadas mostrará precio real, variación % y sparkline, actualizándose automáticamente (cada 30s por defecto, configurable).

Sin clave API, igualmente puedes añadir acciones y cuentas de X: se guardarán, solo que no verás precio hasta que configures la clave.

## Sobre las cuentas de X

Se usa el widget oficial de embeds de X (`platform.twitter.com/widgets.js`), que no requiere clave ni backend: solo funciona con cuentas públicas. Si en el futuro X restringe o cambia este widget, la tarjeta seguirá mostrando un enlace directo al perfil.

## Notas técnicas

- Sin frameworks ni build step: HTML + CSS + JS vanilla, más Chart.js vía CDN.
- El histórico del gráfico se construye localmente mientras el panel está abierto (no hay API gratuita de velas históricas en Finnhub), así que cuanto más tiempo lo tengas abierto, más rico será el gráfico.
- Los símbolos de bolsas fuera de EE.UU. suelen necesitar sufijo (ej. `ITX.MC` para Inditex en el mercado continuo español, `SAN.MC` para Santander). Pruébalos en el buscador de Finnhub si no aparecen.
