# Pasarela que este front espera de node-web

El navegador no habla SOAP, RMI ni gRPC, y no puede llamar a cada VM por su
cuenta sin chocar con CORS. Por eso, en el diagrama de despliegue, **node-web es
la pasarela del cliente web**: entrega esta interfaz y reenvía sus llamadas.

Este front llama siempre al mismo origen que lo sirvió, bajo `/api`. La regla
para node-web es sencilla: **casi todo es un reenvío 1 a 1**, con el mismo
método, la misma ruta (quitando `/api`), el mismo cuerpo y la misma cabecera
`Authorization: Bearer <token>`. Así node-web no tiene que conocer los DTOs de
cada servicio y, si un servicio cambia un campo, la pasarela no se entera.

## 1. Lo que node-web traduce (no es reenvío directo)

### Iniciar sesión — SOAP en node-soap

```
POST /api/sesion
{ "usuario": "user1", "contrasena": "1234", "origenCliente": "web" }
```

node-web llama a la operación `login(usuario, contrasena, origenCliente)` de
`users.wsdl` —la misma que usan el móvil y el escritorio— y responde:

```json
{ "token": "…", "roles": ["investigador"], "serviciosAutorizados": ["storage", "hpc"] }
```

- Credenciales incorrectas → **401** con `{ "mensaje": "Usuario o contraseña incorrectos" }`.
- node-soap caído → **503** (nunca 401: no es culpa del usuario).

Recordatorio del sobre SOAP (README del móvil): la operación va con prefijo de
namespace (`<ns:login>`) y sus hijos **sin** namespace, porque `users.wsdl` no
declara `elementFormDefault`.

### Cerrar sesión

```
DELETE /api/sesion        (con Authorization)  ->  204
```

node-web llama a `logout(token)`. El front cierra la sesión local aunque esto falle.

### Token en la URL, solo para el video

Un `<video>` no puede poner la cabecera `Authorization`. Para la reproducción,
el front pide:

```
GET /api/streaming/{id}/contenido?access_token=<token>
```

node-web debe pasar `access_token` a `Authorization: Bearer …`, **quitarlo de
la URL** antes de reenviar, propagar la cabecera `Range` y devolver tal cual el
`206 Partial Content`. Que no quede el token en los registros de acceso de
Nginx (`access_log` sin query string en esa ruta).

## 2. Reenvíos directos

| El front llama a | node-web reenvía a | Servicio |
|---|---|---|
| `/api/storage/**` | `node-repository:8084/storage/**` | Storage |
| `/api/album/**` | `node-media:8083/album/**` | Photo Album |
| `/api/streaming/**` | `node-media:8083/streaming/**` | Streaming |
| `/api/jobs`, `/api/jobs/**` | `node-rmi:8082/jobs/**` (HTTPS) | HPC (job-api) |
| `/api/cluster/**` | `node-rmi:8082/cluster/**` (HTTPS) | HPC (job-api) |
| `/api/shared-file/**` | `node-repository:8085/shared-file/**` | Shared File |
| `/monitoreo/**` | `node-monitoreo:3000/monitoreo/**` | Grafana (sin `/api`: es otra aplicación web) |

Requisitos del reenvío:

- **Pasar el cuerpo como flujo**, sin parsearlo: la subida de archivos es
  `multipart/form-data` y puede pesar cientos de MB. En Express, montar el
  proxy **antes** de `express.json()`.
- **Pasar los códigos de estado y el cuerpo de error** del servicio sin
  cambiarlos: el front muestra el `mensaje` que manda cada servicio
  (`{ error, mensaje }`), que es el que mejor explica qué pasó.
- **Propagar `Range`, `Content-Range`, `Accept-Ranges`, `Content-Disposition`
  y `Content-Length`** (descargas y video).
- job-api usa un certificado autofirmado en desarrollo: node-web debe confiar
  en él (CA propia), no desactivar la verificación TLS.
- Si el servicio no responde, devolver **502/503** con `{ "mensaje": "…" }`.

## 3. Rutas exactas que usa este front

**Storage** (`src/datos/almacenamiento.js`)
```
GET    /api/storage/directorios/{id}          ("root" para la raíz)
POST   /api/storage/directorios               { nombre, directorioPadreId }
POST   /api/storage/archivos?directorioDestino={id}&sobrescribir=false   (multipart, campo "archivo")
GET    /api/storage/archivos/{id}/descargar
DELETE /api/storage/archivos/{id}
GET    /api/storage/cuota
```

**Photo Album** (`src/datos/medios.js`; contrato `Contrato PhotoAlbum.md` del monorepo)
```
GET    /api/album/fotos?pagina=N&ordenPor=RECIENTES|ALFABETICO
GET    /api/album/fotos/{id}/miniatura
GET    /api/album/fotos/{id}/contenido
POST   /api/album/indexar
GET    /api/album/albumes
POST   /api/album/albumes                     { nombre, descripcion }
GET    /api/album/albumes/{id}
POST   /api/album/albumes/{id}/fotos          { medioId }
DELETE /api/album/albumes/{id}/fotos/{medioId}
```

**Streaming** (`src/datos/medios.js`)
```
GET    /api/streaming/catalogo?pagina=N&ordenPor=RECIENTES|MAS_VISTOS|ALFABETICO
GET    /api/streaming/{id}/miniatura
GET    /api/streaming/{id}/sesion             -> { sesionId, manifestUrl: "/streaming/{id}/contenido" }
GET    /api/streaming/{id}/contenido?access_token=…   (Range)
```

**HPC** (`src/datos/hpc.js`)
```
GET    /api/jobs
POST   /api/jobs                              { nombre, rutaCodigoFuente, rutaDataset, numeroProcesos, prioridad }
DELETE /api/jobs/{id}
GET    /api/cluster/estado
```

**Shared File** (`src/datos/compartidos.js`)
```
GET    /api/shared-file/compartidos-conmigo
GET    /api/shared-file/que-yo-comparto
POST   /api/shared-file/compartir             { archivoId, destinatarioTipo, destinatarioId, nivelPermiso }
POST   /api/shared-file/compartir-directorio  { directorioId, destinatarioTipo, destinatarioId, nivelPermiso }
PATCH  /api/shared-file/compartir/{id}        { nuevoNivelPermiso }
DELETE /api/shared-file/compartir/{id}
```

**Sonda de vida** (indicador de conexión): `GET /salud`, la que node-web ya expone.

**Sesión:** `POST /api/sesion` responde además `429 DEMASIADOS_INTENTOS` (con
`Retry-After`) tras 5 contraseñas incorrectas en 15 minutos para ese usuario.

## 4. Estado en node-web

**Hecho.** node-web ya es una pasarela 1 a 1 (`node-web/src/pasarela.js` del
monorepo): reenvía la tabla 2, traduce solo `POST`/`DELETE /api/sesion` a SOAP,
pasa `?access_token=` a `Authorization` (y lo quita de la URL y del registro) y
sirve este repositorio como contenido estático. Además añade cabeceras de
seguridad (CSP, anti-clickjacking), 404 a rutas ocultas y el límite de intentos
de login (ver `node-web/README.md`, sección Seguridad).

Pendiente fuera de node-web: job-api todavía no implementa el `POST /jobs` de
`Contrato_HPC` ni `GET /cluster/estado` (responde 404).
