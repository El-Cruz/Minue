# Minue · Entregas con propósito

Aplicación web en español para distribuir dietas de perros y gatos. Incluye dashboard personal, administración de destinos/contactos/productos/equipo, programación de entregas, firma táctil, incidencias, historial y comprobantes PDF privados. Es una PWA instalable en Android y requiere internet para operar.

## Estado de esta entrega

- Código funcional y compilación de producción disponibles.
- Demostración interactiva sin datos reales cuando no hay configuración de Supabase. Los cambios de la demostración solo viven en memoria y se borran al recargar.
- Backend, migración, políticas de acceso y funciones transaccionales incluidos y comprobados localmente con PostgreSQL (PGlite).
- **Claves verificadas para el proyecto `cpycykduhgwsalgwhkxd`.** La clave publicable responde y la clave secreta permite administrar usuarios. Faltan las tablas, el bucket privado y el primer usuario; aún no está desplegado en Vercel. El conector MCP continúa sin permiso para ese proyecto y este entorno no dispone de conexión SQL directa. No se creó nada en Talos.
- La entrega de correos y el inicio de sesión con una cuenta real requieren configurar el proyecto, sus URLs y SMTP. Las pruebas locales no sustituyen esta comprobación en el servicio real.

## Abrir la aplicación

Requiere Node.js 22 o superior.

```sh
npm ci
npm run dev
```

Abrir `http://localhost:5173`. Sin `.env`, se abre la demostración identificada con una banda superior. Para volver a probar el flujo desde cero, recargar la página o usar **Mi aplicación → Reiniciar demostración**.

Con Supabase configurado, se abre el inicio de sesión. La demostración sigue accesible desde el botón de la pantalla de acceso o con `/?demo=1`; usa un estado separado, nunca escribe en Supabase y no envía invitaciones.

## Conectar datos reales y publicar

Para publicar sin el MCP de Vercel, seguir [la guía de despliegue manual](docs/desplegar-en-vercel.md). El paquete incluye las funciones de servidor y excluye `.env`; las claves se configuran en Vercel.

1. Usar el proyecto existente `cpycykduhgwsalgwhkxd`, indicado por el propietario. Comprobar en Supabase que pertenece a la organización **Minue** y autorizar su acceso desde la conexión. No crear un proyecto duplicado.
2. Aplicar **una sola vez** la migración `supabase/migrations/20261020174822_minue_delivery_system.sql` mediante el SQL Editor o el flujo de migraciones de Supabase. `supabase/schema.sql` es una copia de referencia y **no** se aplica después de la migración. La migración crea tablas, RLS, funciones e índices y un bucket privado.
   Para el editor SQL también está disponible `docs/configurar-supabase.sql`: envuelve la misma migración en una transacción y añade consultas de verificación. Usar uno de los dos archivos, nunca ambos. Este archivo no crea usuarios ni carga datos de ejemplo.
3. Copiar `.env.example` a `.env` y completar las variables. Nunca subir `.env` al repositorio ni incluir claves privilegiadas en capturas, chats o variables `VITE_`.
4. Importar este directorio como proyecto de **Vercel**. Framework: Vite; comando: `npm run build`; salida: `dist`; Node.js 22 o 24. `vercel.json` configura las funciones `/api/command` y `/api/receipt`, los enlaces de acceso y las cabeceras.
5. Configurar las mismas variables en Vercel antes de compilar. `APP_URL` debe ser el origen HTTPS final, sin `/` al final. Las variables `VITE_` requieren una nueva compilación después de cambiarlas.
6. En Supabase **Authentication → URL Configuration**, poner la URL final en **Site URL** y permitir exactamente `https://TU-DOMINIO/auth/invite` y `https://TU-DOMINIO/auth/reset`. Agregar las URLs locales solo para desarrollo.
7. En **Authentication → Providers → Email**, desactivar los registros públicos, mantener la confirmación por correo y exigir contraseña de al menos 12 caracteres. `config.toml` aplica estos valores al entorno local, no cambia por sí solo el proyecto alojado.
8. Configurar un proveedor SMTP propio para invitaciones y recuperación de contraseña. El servidor de correo predeterminado de Supabase tiene restricciones; verificar remitente, dominio y entrega a usuarios externos.
9. Crear la primera cuenta mediante el comando siguiente, con `.env` apuntando al proyecto correcto y `APP_URL` definitivo. **Este comando envía una invitación real por correo.** Solo sirve para el primer administrador; si ya hay uno, se detiene.

```sh
npm run bootstrap -- --email tu@correo.com --name "Tu nombre"
```

Si `INITIAL_ADMIN_NAME` y `INITIAL_ADMIN_EMAIL` ya están en `.env`, `npm run bootstrap` usa esos valores. Sigue enviando una invitación real; se ejecuta cuando la URL pública y el envío de correo estén configurados.

Abrir el enlace del correo y elegir contraseña. Después, invitar a otras personas desde **Equipo**. No existe un formulario público de registro.

Si una invitación se creó pero falló la escritura del perfil, completar la fila correspondiente de `profiles` desde el panel de Supabase usando el ID de Authentication. No repetir invitaciones a ciegas ni eliminar usuarios existentes. Una cuenta sin perfil activo no puede operar.

### Variables

| Variable | Dónde se utiliza | Contenido |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Navegador | URL HTTPS del proyecto |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Navegador | Clave publicable; no una clave secreta |
| `SUPABASE_URL` | Servidor | La misma URL del proyecto |
| `SUPABASE_SECRET_KEY` | Solo servidor | Clave secreta de Supabase o `service_role` heredada |
| `APP_URL` | Solo servidor | Origen de la aplicación; validación de solicitudes e invitaciones |
| `INITIAL_ADMIN_NAME` | Solo configuración inicial | Nombre del primer administrador |
| `INITIAL_ADMIN_EMAIL` | Solo configuración inicial | Correo del primer administrador |

El servidor exige una sesión verificada y vuelve a consultar el perfil activo en cada operación. Las políticas de PostgreSQL protegen también las consultas directas del navegador. Los roles se guardan en `profiles`, sin confiar en metadatos editables por el usuario.

`npm run check:connection` verifica las claves, las siete tablas y el bucket sin mostrar claves ni datos de usuarios. No modifica el proyecto. En un entorno que requiere proxy para Node.js, ejecutarlo con `NODE_USE_ENV_PROXY=1`.

## Funcionamiento

- Las fechas de reparto se calculan con `America/Bogota` (UTC−5). La hora de confirmación viene del servidor, no del teléfono.
- El dashboard muestra las entregas del perfil para el día seleccionado. Incluye búsqueda, filtros, progreso, próxima entrega y pendientes de fechas anteriores.
- Una entrega futura se puede consultar; solo se confirma a partir de su día programado. Una entrega atrasada pendiente se puede confirmar. Un intento fallido necesita reprogramación previa.
- Para confirmar se exige receptor y firma con trazos. Se puede seleccionar un contacto existente o crear uno. La observación es opcional.
- La confirmación bloquea la fila en PostgreSQL, crea un único comprobante y guarda el evento en una sola transacción. Reintentar la misma entrega devuelve su comprobante existente, incluso con otra clave de solicitud.
- El servidor obtiene los nombres y unidades del catálogo; no acepta como verdad los nombres enviados por el navegador.
- La copia confirmada del destino, productos, receptor y repartidor queda en el comprobante. Editar catálogos no la altera. Una entrega confirmada no puede editarse ni reprogramarse desde la aplicación.
- La firma se guarda antes de confirmar. Si no se puede guardar, la entrega sigue pendiente. Si se desconoce el resultado de una petición, se puede reintentar sin duplicar la confirmación.
- El PDF se genera después de confirmar. Si falla, la entrega sigue confirmada y el usuario puede generarlo de nuevo desde Historial. No se vuelve a pedir firma.
- No hay recepciones parciales, cobros, inventario, rutas optimizadas ni envíos automáticos por correo o WhatsApp.

## Privacidad e instalación

Las firmas y PDF viven en `minue-private`. El bucket no tiene acceso público ni políticas de navegador: las descargas pasan por el servidor, que comprueba el perfil vigente y la asignación. Administración puede descargar todos; reparto, solo los de sus entregas. Las respuestas tienen `Cache-Control: private, no-store`.

La sesión se conserva con el cliente de Supabase. No se guardan datos operativos reales en localStorage o IndexedDB. El service worker cachea únicamente recursos estáticos incluidos en el build y una página de desconexión; excluye las APIs y cualquier recurso externo.

En Chrome para Android: abrir la URL HTTPS final → menú **⋮** → **Instalar aplicación** o **Agregar a pantalla de inicio**. También puede usarse el botón de instalación cuando Chrome lo habilite. No es una APK ni requiere Google Play. La instalación real debe comprobarse en un dispositivo Android después del despliegue.

## Comprobante provisional

La plantilla está en `src/lib/pdf.ts`. Incluye folio único, veterinaria, dirección, fecha programada y efectiva, detalle de alimentos, repartidor, receptor, firma y observación. Admite varias páginas. Cambiar esa plantilla cuando el propietario proporcione el formato definitivo; los PDF ya emitidos se conservan y no se sustituyen automáticamente.

## Verificación

```sh
npm test
npm run build
npm run test:e2e
```

Para verificar el service worker y la pantalla sin conexión del build, ejecutar `npm run preview` y, en otra terminal, `npm run test:pwa`. Esta prueba abre `/?demo=1`, incluso si hay claves configuradas; no opera con datos reales. Las pruebas de navegador también abren la demostración explícitamente.

- Pruebas unitarias e integración: zona horaria, entrada de API, PNG con trazos, PDF con varias páginas, fallos de almacenamiento y generación de PDF, y reglas de negocio/RLS sobre PostgreSQL embebido con PGlite.
- Pruebas de navegador: dashboard móvil, receptor nuevo, firma dibujada, PDF descargable y válido, incidencias, reprogramaciones, altas administrativas, desconexión y endpoints sin autenticación. Usan la demostración; no una cuenta real de Supabase.
- Playwright usa Chromium en `/usr/bin/chromium` en este entorno. En otro equipo, instalar un navegador y definir `CHROMIUM_PATH=/ruta/al/navegador` al ejecutar las pruebas.
- `npm run db:test` ejecuta solo las pruebas PostgreSQL. No modifica ningún proyecto remoto.

### Antes de usar entregas reales

Comprobar con dos repartidores distintos: acceso a entregas y PDF propios, denegación de los ajenos y de cuentas desactivadas. Probar un correo de invitación y uno de recuperación reales. Registrar una entrega de prueba, recargar, descargar el PDF y verificar el historial desde otro dispositivo. Instalar en Android y simular pérdida de internet. Ejecutar los asesores de seguridad y rendimiento de Supabase sobre el proyecto desplegado.

No se incluyen datos de demostración en la migración. La operación comienza sin destinos, productos ni entregas. El administrador los agrega desde la aplicación.

## Operación

Revisar errores de `/api/command` y `/api/receipt` en Vercel y avisos del proyecto en Supabase. Los errores no registran cuerpos con firmas ni claves. Configurar copias de seguridad según el plan contratado. No borrar firmas ni comprobantes de entregas confirmadas. Una interrupción entre la subida de una firma y la transacción puede dejar un archivo huérfano: se conserva para evitar pérdida cuando no se sabe si la transacción terminó; cualquier limpieza futura debe cotejar las referencias de `receipts` antes de borrar.

Para cambiar el esquema tras el despliegue, crear una migración adicional. No editar la migración ya aplicada. Para una reversión de interfaz, desplegar una versión anterior compatible sin borrar los datos operativos.
