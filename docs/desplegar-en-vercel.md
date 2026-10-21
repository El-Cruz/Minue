# Publicar Minue manualmente en Vercel

No hace falta conectar el MCP de Vercel. El proyecto incluye `vercel.json` y las funciones de servidor.

## 1. Subir el código

1. Descomprimir `minue-entregas.zip`.
2. Subir el contenido de la carpeta `minue` a un repositorio de GitHub. No subir el archivo `.env` del equipo; `.gitignore` y `.vercelignore` lo excluyen.
3. En Vercel, abrir **Add New → Project** e importar ese repositorio.
4. Seleccionar como **Root Directory** la carpeta que contiene `package.json`. Si subiste el contenido directamente al repositorio, será la raíz; si subiste la carpeta entera, será `minue`.

Usar el proyecto completo, no solo `dist`: los endpoints de confirmación y generación de comprobantes necesitan las carpetas `api` y `server`.

## 2. Ajustes del proyecto

| Ajuste | Valor |
| --- | --- |
| Framework Preset | Vite |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Node.js | 22 o 24 |

## 3. Variables de entorno

En **Environment Variables**, configurar estas variables para **Production**. Copiar las claves desde el `.env` local; no escribirlas en el código ni en GitHub.

| Nombre | Valor |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://cpycykduhgwsalgwhkxd.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Tu clave publicable de Supabase |
| `SUPABASE_URL` | `https://cpycykduhgwsalgwhkxd.supabase.co` |
| `SUPABASE_SECRET_KEY` | Tu clave secreta, solo para el servidor |
| `APP_URL` | `https://minue-delta.vercel.app` para este proyecto |

Si aún no conoces la URL final, configura primero las cuatro variables de Supabase y despliega. Cuando Vercel asigne el dominio, añadir `APP_URL` en **Settings → Environment Variables** y hacer **Deployments → Redeploy** para aplicarlo. Usa la dirección de producción que abrirás desde el móvil.

`http://localhost:5173` es solo para desarrollo local. No copiar ese valor de `.env.example` a Production: el servidor rechazará los cambios desde el dominio público con «Origen de solicitud no autorizado». Cada cambio de `APP_URL` en Vercel requiere un nuevo despliegue.

Las variables que empiezan por `VITE_` se incluyen en el navegador. La clave secreta solo va en `SUPABASE_SECRET_KEY`.

Esta aplicación no necesita `DATABASE_URL` en Vercel: usa la API de Supabase. Las variables `INITIAL_ADMIN_NAME` y `INITIAL_ADMIN_EMAIL` se usan únicamente en el comando local de creación de la primera cuenta.

## 4. Preparar Supabase

En el proyecto `cpycykduhgwsalgwhkxd`:

1. Ejecutar todo `docs/configurar-supabase.sql` una sola vez en el SQL Editor. Deben aparecer siete tablas con `rowsecurity = true` y el bucket `minue-private` con `public = false`. Si ya aplicaste la migración por otro método, no volver a ejecutar este archivo.
2. En **Authentication → URL Configuration**, poner la URL de producción en **Site URL** y añadir estas dos **Redirect URLs**, reemplazando el dominio:
   - `https://TU-DOMINIO/auth/invite`
   - `https://TU-DOMINIO/auth/reset`
3. Desactivar el registro público de nuevos usuarios. Minue admite cuentas habilitadas por administración.
4. Configurar SMTP y comprobar la entrega de invitaciones y recuperación de contraseña. El correo predeterminado de Supabase tiene restricciones de destinatarios y frecuencia.

## 5. Crear la primera cuenta

Cuando el sitio y el correo estén configurados, actualizar `APP_URL` en el `.env` local con la URL final. El archivo local ya tiene el nombre y correo del administrador indicados por el propietario.

```sh
npm ci
npm run check:connection
npm run bootstrap
```

El último comando envía una invitación real para elegir contraseña; solo se ejecuta una vez para el primer administrador. Si ya existe una cuenta administradora, se detiene. No envía claves secretas por correo.

Si otra persona instala una copia nueva del proyecto, debe configurar `INITIAL_ADMIN_NAME` y `INITIAL_ADMIN_EMAIL` en su `.env`, o proporcionarlos con `--name` y `--email` al comando de bootstrap.

## 6. Revisar e instalar

1. Abrir la URL final: con las claves configuradas debe mostrarse el inicio de sesión. El botón de demostración permite explorar sin modificar datos reales.
2. Entrar con la cuenta inicial, crear un destino y un alimento, asignar una entrega y confirmar con firma. Descargar el PDF y verificar que sigue en Historial después de recargar.
3. Abrir esa misma URL en Chrome para Android y usar **⋮ → Instalar aplicación** o **Agregar a pantalla de inicio**. La aplicación requiere internet para confirmar entregas.

Si el sitio abre pero falla una operación, revisar los registros de funciones en Vercel y comprobar que `APP_URL` coincide con el origen de la página. Si faltan las tablas, ejecutar el paso de Supabase; las claves por sí solas no las crean.
