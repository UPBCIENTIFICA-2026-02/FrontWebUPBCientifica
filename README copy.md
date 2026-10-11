# Cliente Web — UPB-CIENTÍFICA

Interfaz web del sistema distribuido **UPB-CIENTÍFICA** (Sistemas Distribuidos
2026-20, UPB Bucaramanga). Corresponde al consumidor **"Chrome / Edge / Opera"**
de la Figura 1 y al artefacto `«source» spa-ui.js` del diagrama de despliegue.

Está **alineada con el cliente móvil** (`FrontMovilUPBCientifica`):

- **Mismo diseño:** la paleta de `ui/theme/Theme.kt` (azul `#1A5BC0`, turquesa,
  violeta, neutros fríos), claro y oscuro, y las mismas pantallas: inicio con
  saludo y franja de estado, tiles de servicios, buscador en píldora, migas de
  pan, lista o cuadrícula, hoja de detalles, avatar con menú de cuenta y la
  pestaña HPC con la tarjeta del clúster.
- **Misma arquitectura por capas:** `ui/` → `datos/` → `red/` + `sesion/`.
- **Diseño adaptable:** en pantallas angostas usa la barra inferior del móvil;
  en escritorio, navegación lateral con botón "Nuevo" y cuota, como Drive.

## Cómo se conecta

El navegador **no** habla con cada servicio. Todo pasa por **node-web**, la
pasarela del cliente web en el diagrama: un navegador no puede hablar SOAP,
RMI ni gRPC, y llamar a cada VM por separado chocaría con CORS. La interfaz
llama a `/api/...` en el mismo origen que la sirvió, y node-web reenvía.

El contrato completo que node-web debe cumplir está en
[`docs/PASARELA.md`](docs/PASARELA.md).

| Servicio | Pasa por node-web hacia | Estado en el front |
|---|---|---|
| Authentication | node-soap (SOAP `login`/`logout`) | **Listo** |
| Distributed Storage | node-repository :8084 | **Listo**: listar, navegar, subir (botón o arrastrando), crear carpeta, descargar, eliminar, cuota |
| Photo Album | node-media :8083 | **Listo**: rejilla, orden, álbumes, indexar, visor a pantalla completa |
| Streaming | node-media :8083 | **Listo**: catálogo, búsqueda, reproducción por rangos |
| HPC | job-api :8082 → gestor RMI | Listar y cancelar: **listo**. Enviar y tarjeta del clúster: **bloqueado** — el front sigue `Contrato_HPC`, pero job-api aún pide `comando` y no tiene `/cluster/estado` (ver Pendientes) |
| Shared File | — | **Simulado**: el servicio no existe en el backend; la pantalla lo avisa |
| Monitoreo | Grafana (node-monitoreo) | Abre el tablero en otra pestaña (`URL_MONITOREO`) |
| File Sync | — | No aplica: el navegador no sincroniza carpetas |

## Ejecutar

No hay compilación ni dependencias: son archivos estáticos con módulos ES.

```bash
node herramientas/servir.js
```

Abre `http://localhost:5173` y entra con **"Entrar en modo demostración"**:
todas las pantallas funcionan con datos de ejemplo, sin servidor.

Para hablar con los servicios reales, lo más simple es abrir **node-web**
directamente (`http://<node-web>:8080`): sirve esta interfaz y la pasarela en el
mismo origen. Arrancado con `DIR_INTERFAZ=<ruta de este repositorio>`, sirve los
archivos de aquí y los cambios se ven al recargar.

O bien, apunta el servidor de desarrollo a node-web:

```bash
NODE_WEB=http://192.168.1.50:8080 node herramientas/servir.js
```

(En PowerShell: `$env:NODE_WEB="http://192.168.1.50:8080"; node herramientas/servir.js`)

> Los módulos ES no cargan abriendo `index.html` con doble clic (`file://`).
> Hace falta un servidor; cualquiera sirve, incluido `servir.js`.

## Desplegar

En la VM node-web, esta carpeta es el contenido estático que entrega
`servidor-web.js` desde `public/`. En el monorepo, `cd node-web && npm run interfaz`
copia `index.html`, `spa-ui.js`, `estilos/` y `src/` a `public/` y anota el commit
de origen en `public/ORIGEN.txt`. Los cambios se hacen aquí, no en `public/`.

Ajustes del despliegue sin tocar código, en `index.html`:

```html
<script>window.UPBC_CONFIG = { URL_MONITOREO: "https://10.0.0.26:3000", PERMITIR_DEMO: false }</script>
```

Opciones en `src/config.js`: `API_BASE`, `SHARED_FILE_DISPONIBLE`,
`URL_MONITOREO`, `INTERVALO_HPC_MS`, `TIEMPO_ESPERA_MS`, `PERMITIR_DEMO`.

## Estructura

```
FrontWebUPBCientifica/
├── index.html
├── spa-ui.js                  # Punto de entrada (como MainActivity.kt)
├── estilos/
│   ├── tema.css               # Paleta de Theme.kt, claro y oscuro
│   └── app.css                # Componentes y pantallas
├── src/
│   ├── config.js              # Único lugar de configuración (como Configuracion.kt)
│   ├── red/clienteApi.js      # fetch + token + errores legibles (como RestClient.kt)
│   ├── sesion/sesion.js       # Token de sesión (como TokenManager.kt)
│   ├── datos/                 # Un módulo por servicio (como data/ del móvil)
│   │   ├── auth.js
│   │   ├── almacenamiento.js
│   │   ├── compartidos.js
│   │   ├── medios.js          # Photo Album + Streaming
│   │   ├── hpc.js
│   │   ├── conexion.js        # Indicador de la barra superior
│   │   └── demo.js            # Datos de ejemplo con la forma de los contratos reales
│   └── ui/
│       ├── iconos.js          # Iconos Material embebidos (sin internet)
│       ├── formato.js         # Tamaños, duraciones, "hace 5 min"
│       ├── tema.js
│       ├── componentes/       # Avatar, BarraBusqueda, EstadoVacio, HojaDetalles, menús…
│       └── pantallas/         # login, marco, inicio, archivos, compartidos, fotos, streaming, hpc
├── herramientas/servir.js     # Servidor de desarrollo (no es parte del despliegue)
└── docs/PASARELA.md           # Rutas que node-web debe exponer
```

Reglas de dependencia: `ui/` solo habla con `datos/`; `datos/` solo con
`red/` y `sesion/`. Ninguna pantalla sabe si algo es REST, SOAP o simulado.
Si un contrato cambia, se toca `datos/`, nunca `ui/`.

## Diferencias deliberadas con el móvil

1. **Formulario de HPC.** El móvil pide un *comando*. La web sigue
   `Contrato_HPC`: el código fuente y el dataset ya subidos a Storage, el número
   de procesos MPI y la prioridad; se eligen los archivos navegando Mis archivos.
   **Ojo:** el job-api actual de `RMIUPBCientifica` todavía exige `comando`
   (`SubmitJobRequest.java`) y rechaza este formulario con 400.
2. **Franja del inicio.** En el móvil resume File Sync. El navegador no
   sincroniza carpetas, así que la franja muestra la conexión y la cuota.
3. **Pestaña Fotos.** El enunciado exige que el álbum funcione sobre la web; el
   móvil aún no tiene esa pantalla.
4. **Tile de Monitoreo.** El enunciado pide el monitoreo accesible por web.

## Pendientes

- **job-api debe implementar `Contrato_HPC`**: aceptar `{ nombre, rutaCodigoFuente,
  rutaDataset, numeroProcesos, prioridad }` en `POST /jobs` y exponer
  `GET /cluster/estado`. Hoy pide `comando` y esa ruta responde 500. La pasarela
  de node-web ya reenvía ambas; no hay que tocarla.
- **Formato de las rutas del job-api.** El front envía la ruta del archivo
  relativa al Home (`/Código MPI/trapecio.c`). Confirmar con quien lleva el
  gestor si espera esa ruta o el identificador de Storage; se cambia en una
  línea de `src/ui/pantallas/hpc.js`.
- **Shared File:** cuando exista, poner `SHARED_FILE_DISPONIBLE: true`.
- **Avance de los trabajos:** el contrato de job-api no informa porcentaje; la
  barra de un trabajo en ejecución es indeterminada (en demo sí hay porcentaje).

## Licencias

Iconos: Material Design Icons de Google, licencia Apache 2.0, embebidos en
`src/ui/iconos.js` para no depender de internet en el CCA.
