#!/usr/bin/env node
/*
 * servir.js — servidor de desarrollo del front web. NO es parte del despliegue.
 *
 * En producción quien entrega esta interfaz es node-web (VM node-web). Este
 * script solo sirve para trabajar en el front desde un portátil:
 *
 *   node herramientas/servir.js
 *       Sirve la interfaz en http://localhost:5173. Úsala con
 *       "Entrar en modo demostración".
 *
 *   NODE_WEB=http://192.168.1.50:8080 node herramientas/servir.js
 *       Además reenvía /api y /salud a un node-web real, así la interfaz
 *       habla con los servicios de verdad sin problemas de CORS.
 *
 * Sin dependencias: solo módulos que trae Node.js.
 */

import http from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PUERTO = Number(process.env.PORT || 5173);
const NODE_WEB = process.env.NODE_WEB ? new URL(process.env.NODE_WEB) : null;

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function reenviar(peticion, respuesta) {
  const destino = new URL(peticion.url, NODE_WEB);
  const salida = http.request(destino, { method: peticion.method, headers: { ...peticion.headers, host: destino.host } }, (r) => {
    respuesta.writeHead(r.statusCode, r.headers);
    r.pipe(respuesta);
  });
  salida.on("error", () => {
    respuesta.writeHead(502, { "Content-Type": "application/json" });
    respuesta.end(JSON.stringify({ error: "SIN_NODE_WEB", mensaje: `No hay respuesta de node-web en ${NODE_WEB.origin}` }));
  });
  peticion.pipe(salida);
}

const servidor = http.createServer((peticion, respuesta) => {
  const ruta = decodeURIComponent(new URL(peticion.url, "http://x").pathname);

  if (ruta.startsWith("/api/") || ruta === "/api" || ruta === "/salud") {
    if (NODE_WEB) return reenviar(peticion, respuesta);
    respuesta.writeHead(503, { "Content-Type": "application/json" });
    return respuesta.end(JSON.stringify({ error: "SIN_NODE_WEB", mensaje: "Servidor de desarrollo sin node-web: usa el modo demostración o define NODE_WEB." }));
  }

  // Archivos estáticos, sin salir de la carpeta del proyecto.
  const archivo = normalize(join(RAIZ, ruta === "/" ? "index.html" : ruta));
  if (!archivo.startsWith(RAIZ)) {
    respuesta.writeHead(403);
    return respuesta.end();
  }
  try {
    if (!statSync(archivo).isFile()) throw new Error();
    respuesta.writeHead(200, { "Content-Type": TIPOS[extname(archivo)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
    createReadStream(archivo).pipe(respuesta);
  } catch {
    respuesta.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    respuesta.end("No encontrado");
  }
});

servidor.listen(PUERTO, () => {
  console.log(`Front web en http://localhost:${PUERTO}`);
  console.log(NODE_WEB ? `Reenviando /api y /salud a ${NODE_WEB.origin}` : "Sin node-web: entra con \"Entrar en modo demostración\".");
});
