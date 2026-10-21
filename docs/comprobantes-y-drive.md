# Activar los comprobantes y Google Drive

El diseño v2 usa la plantilla vacía del Word y Poppins. Los datos y firmas operativos se guardan en almacenamiento privado; no subirlos a GitHub. El PDF firmado de referencia no forma parte del repositorio.

## 1. Actualizar la base de datos existente

Aplicar el archivo nuevo que termina en _receipt_documents_drive.sql, dentro de supabase/migrations, en el SQL Editor del proyecto cpycykduhgwsalgwhkxd. Es una migración adicional: **no volver a ejecutar el esquema inicial**.

La migración conserva los folios, fechas, snapshots y rutas originales. Asigna PRA-065 a la copia nueva del comprobante existente de Pradera y deja PRA-066 como siguiente número. Genera tareas pendientes de PDF y Drive. No importa la antigua base de datos.

Aplicar después docs/activar-archivo-drive.sql. Habilita Cron, pg_net y Vault; el trabajo todavía no se programa hasta configurar su secreto.

## 2. Preparar Google OAuth y variables

En Google Cloud, crear un proyecto, habilitar Google Drive API y crear un cliente OAuth de tipo **Aplicación web**. Configurar consentimiento externo para el uso de la cuenta Gmail de Minue. Solicitar únicamente openid, email y https://www.googleapis.com/auth/drive.file.

Usar como URI de redirección autorizada, exactamente:

~~~
https://minue-delta.vercel.app/api/drive-callback
~~~

Para pruebas OAuth, incluir puntodeentregasminue@gmail.com entre los usuarios de prueba. Antes de dejar funcionando el archivo sin supervisión, publicar la configuración de consentimiento: en modo de prueba los refresh tokens pueden vencer a los siete días.

Ejecutar: node scripts/prepare-drive-env.mjs. Genera dos secretos en el .env ignorado por Git. Completar allí las credenciales del cliente Google. Nunca compartir los valores por el chat ni incorporarlos al repositorio.

Configurar estas variables **solo en Production**, tipo Secret, en el proyecto Minue de Vercel:

| Variable | Procedencia |
| --- | --- |
| GOOGLE_DRIVE_CLIENT_ID | Cliente OAuth de Google Cloud |
| GOOGLE_DRIVE_CLIENT_SECRET | Secreto de ese cliente |
| DRIVE_TOKEN_ENCRYPTION_KEY | .env, generada por el script; 32 bytes en base64 |
| DRIVE_WORKER_SECRET | .env, generada por el script |

Conservar APP_URL=https://minue-delta.vercel.app. La clave de cifrado debe mantenerse estable; si se pierde o cambia habrá que reconectar Drive.

## 3. Publicar y conectar

Publicar el código desde GitHub después de aplicar la migración y configurar las variables. Verificar que el despliegue quede READY.

Ejecutar: node scripts/configure-drive-worker.mjs con acceso de red. El secreto local debe coincidir con DRIVE_WORKER_SECRET de Vercel. El script lo almacena en Vault y programa el trabajador cada cinco minutos sin imprimirlo.

Entrar a Minue como administrador → Mi aplicación → **Conectar Google Drive**. Autorizar **puntodeentregasminue@gmail.com**; cualquier otra cuenta se rechaza. La conexión de Google Drive de ChatGPT no conecta la aplicación.

Los PDF se archivan en Minue - Comprobantes / AÑO / AAAA-MM Mes / Comprobante-CODIGO-NNN.pdf. El mes corresponde a la confirmación original, en Quito. La carpeta y los archivos se crean con los permisos privados de esa cuenta.

## 4. Verificar y recuperar

Confirmar una entrega de prueba controlada, abrir la vista previa y comprobar el mismo PDF en Drive. Probar «Pantalla completa para foto», descarga, Historial y consulta del original cuando exista.

Una falla de Drive no revierte la entrega. El sistema conserva la tarea y el archivo privado, reintenta con pausas de 5 minutos, 15 minutos, 1 hora y 6 horas y verifica los bytes subidos. La reconexión reactiva las tareas pausadas. Los ID reservados impiden duplicados ante respuestas perdidas.

Los estados visibles son «Pendiente de Drive», «Guardado en Drive» y «Requiere reconexión de Drive». El trabajador solo acepta su secreto; los usuarios consultan o reintentan comprobantes propios y los administradores pueden consultar todos.

## Importación posterior de la base antigua

Conservar los códigos originales de los comprobantes importados y las fechas reales de confirmación. No volver a ejecutar la inicialización PRA-065 ni reducir receipt_next_number. Al finalizar una importación, conservar el mayor entre el contador vigente y el máximo número importado más uno. La importación y deduplicación de esa base no forman parte de este cambio.

## Formato vectorial v3 y animación

El formato v3 dibuja el portapapeles, la pinza, la hoja, los textos y los adornos con primitivas vectoriales. La composición compartida produce el SVG de carga y el fondo del PDF; la firma es la única imagen incrustada. La vista final sigue mostrando con PDF.js el mismo archivo que se descarga y se envía a Drive.

Primero publicar el código compatible con v2/v3. Después ejecutar `docs/activar-comprobante-vectorial.sql` en el SQL Editor del proyecto Minue. Este SQL activa v3 solo para las siguientes confirmaciones; no cambia recibos anteriores, números, fechas ni tareas de Drive existentes. El archivo nuevo se guarda en `receipts/{id}/v3.pdf`. Las versiones 1 y 2 y los PDF históricos conservan sus rutas y bytes.

La carga termina cuando la página se renderiza, sin demoras artificiales. El modo foto queda inmóvil, adapta la página completa al espacio disponible y permite recuperar controles tocando el documento. La preferencia del sistema de movimiento reducido desactiva las animaciones.

Para revisar sin generar entregas reales: abrir la demostración, confirmar una entrega ficticia con una firma de ejemplo y abrir «Pantalla completa para foto». Antes de activar SQL, las entregas reales siguen emitiéndose como v2.
