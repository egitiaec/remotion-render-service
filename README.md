# EGIT Remotion Render Service

Microservicio propio, **open source y self-hosted**, que reemplaza a Creatomate
en el pipeline de contenido de Hispanamur: recibe una imagen + un audio y
devuelve un video corto (MP4) listo para publicar, con efecto Ken Burns,
caption opcional y logo opcional.

Construido sobre [Remotion](https://www.remotion.dev). Bajo su licencia,
EGIT (persona natural / hasta 3 empleados) califica para la **Free License**,
incluso usándolo en automatizaciones — sin costo de licencia. Ver
`remotion.dev/docs/license` si el equipo crece más allá de eso.

## 1. Requisitos

- Node.js 20+ (o usar directamente el Dockerfile, que ya trae todo)
- Docker + docker-compose (para desplegar en la VPS vía Dokploy)

## 2. Correr en local (para probar antes de desplegar)

```bash
npm install
npx remotion browser ensure   # descarga el Chrome headless una sola vez
npm start
```

El servicio queda escuchando en `http://localhost:4000`.

## 3. Endpoints

### `POST /render`

Encola un render. Body JSON:

```json
{
  "imageUrl": "https://.../imagen-campania.png",
  "audioUrl": "https://.../jingle.mp3",
  "durationInSeconds": 18,
  "captionText": "¡Pipas, tu snack favorito!",
  "logoUrl": "https://.../logo-pipas.png",
  "fadeOutSeconds": 1,
  "width": 1080,
  "height": 1920,
  "fps": 30
}
```

Solo `imageUrl` y `durationInSeconds` son obligatorios. `audioUrl` es opcional
(si no se envía, el video queda mudo — útil para el caso de Instagram +
catálogo nativo, donde el audio se adjunta del lado de Instagram y no aquí).

Respuesta (202):
```json
{ "renderId": "a1b2c3...", "status": "queued" }
```

### `GET /render/:id`

Consulta el estado (para hacer polling desde n8n).

- En progreso: `{ "status": "queued" }` o `{ "status": "rendering" }`
- Listo: `{ "status": "done", "videoUrl": "https://.../render/a1b2c3/download" }`
- Error: `{ "status": "error", "error": "..." }`

### `GET /render/:id/download`

Descarga el MP4 ya renderizado (esta es la URL que se usa en `videoUrl`).

### `GET /health`

Chequeo simple de salud del servicio.

## 4. Autenticación

Si se define la variable de entorno `API_TOKEN`, todos los endpoints de
`/render` exigen el header:

```
Authorization: Bearer <API_TOKEN>
```

Configura el mismo valor en el nodo HTTP Request de n8n.

## 5. Integración en n8n (flujo sugerido)

1. **HTTP Request (POST)** → `https://render.hispanamur.digital/render`
   con el body descrito arriba (imagen de Gemini Nano Banana + audio de
   Musicful o silencio si va por catálogo de Instagram)
2. **Wait** (10-15 seg)
3. **HTTP Request (GET)** → `/render/{{ $json.renderId }}`
4. **If**: `status != "done"` y `status != "error"` → volver al paso 2 (loop)
5. Si `status == "done"` → usar `videoUrl` para publicar en el canal
   correspondiente
6. Si `status == "error"` → notificar y reintentar o caer a un fallback

## 6. Despliegue como nuevo contenedor/app en Dokploy

Este servicio va como una **aplicación nueva e independiente** en tu Dokploy (no
dentro del proyecto de n8n/NocoDB de Hispanamur), para no acoplar su ciclo de
vida ni sus recursos (CPU/RAM para renderizar) al resto del stack.

1. Sube este proyecto a un repo del org `egitiaec` en GitHub (ej.
   `egitiaec/remotion-render-service`)
2. En Dokploy: **Projects → Create Project** (o usa uno existente si prefieres
   agruparlo) → **Create Service → Docker Compose**
3. Conecta el repo de GitHub, rama `main`, y define el path del compose:
   `docker-compose.yml` (raíz del repo)
4. En **Environment**, agrega la variable `API_TOKEN` con un valor secreto
   (no la subas al repo) — el resto de variables ya vienen definidas en el
   `docker-compose.yml`
5. En **Domains**, agrega el subdominio que le vayas a asignar (ej.
   `render.hispanamur.digital`), puerto interno `4000` — Dokploy provisiona el
   certificado SSL automáticamente vía Let's Encrypt, igual que ya lo tienen
   configurado para `n8n.hispanamur.digital` y NocoDB
6. Actualiza `PUBLIC_BASE_URL` en el compose (o como variable de entorno) para
   que coincida exactamente con ese dominio — es el que se usa para construir
   la URL de descarga del video que consume n8n
7. Si quieren protegerlo detrás de Cloudflare Zero Trust como ya hacen con
   n8n/NocoDB/Dokploy, agrégalo ahí también — recuerda dejar accesible el
   endpoint para que n8n (que corre en la misma VPS) pueda llamarlo; si ambos
   contenedores están en la red interna de Dokploy, pueden comunicarse por el
   nombre del servicio sin pasar por el dominio público en absoluto (ver nota
   abajo)
8. Click **Deploy**

### Nota: llamar al servicio desde n8n sin salir a internet

Si n8n y este servicio quedan en la misma red interna de Docker que gestiona
Dokploy, n8n puede llamarlo directo por el nombre del servicio y el puerto
interno (ej. `http://remotion-render:4000/render`) en vez de por el dominio
público — más rápido y no depende de Cloudflare/DNS. Confirma el nombre exacto
del servicio en la red interna desde el panel de Dokploy antes de configurar
el nodo HTTP Request en n8n.

9. El volumen `remotion-output` persiste los MP4 generados — conviene
   agregar una limpieza periódica (ej. borrar archivos de más de 7 días) si
   el volumen de campañas es alto, para no llenar el disco de la VPS

## 7. Notas y límites conocidos de esta PoC

- `RENDER_CONCURRENCY=1` por defecto: cada render usa un Chrome headless,
  que consume CPU/RAM — subir la concurrencia solo si la VPS tiene recursos
  de sobra. Para producción conviene medir cuánto tarda un render típico y
  dimensionar la VPS o mover este servicio a su propio contenedor con más
  recursos asignados.
- Los jobs se guardan en memoria (`Map`) — si el contenedor se reinicia se
  pierde el historial de jobs en curso (no los videos ya generados, esos
  quedan en el volumen). Para producción real conviene mover esto a una
  tabla en la misma Postgres que ya usa el proyecto.
- El efecto visual (Ken Burns + fade-out de audio + caption) es el set
  mínimo para la PoC. Se puede enriquecer después (transiciones, marca de
  agua, múltiples imágenes en un mismo clip, etc.) editando
  `src/CampaignVideo.jsx`.
