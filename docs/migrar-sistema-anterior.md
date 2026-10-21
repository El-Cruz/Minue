# Migrar el sistema anterior sin alterar la fuente

La hoja madre es la referencia. El Excel exportado es una instantánea; hasta poder leer la hoja en Drive, no se puede afirmar que ambas versiones coinciden ni que no existen más pestañas en el original. Tampoco se puede inspeccionar un Apps Script vinculado a partir del Excel: hacen falta su código, la plantilla y permisos de lectura sobre los archivos asociados.

## Estructura observada en el archivo exportado

| Pestaña | Encabezado | Clave y relación |
| --- | --- | --- |
| Reporte Entregas | A1:K1 | ID identifica la entrega; CodigoEntrega conserva el código original. |
| Productos Entrega | A1:G1 | IDProducto identifica la línea. IDEntrega apunta al ID de Reporte Entregas. Receta apunta a ID Receta. |
| Recetas | B2:C2 | ID Receta identifica cada producto del catálogo. |

El exportador conserva todas las pestañas, columnas, filas pobladas, fórmulas con valores calculados disponibles y posiciones de origen en un JSON **privado**. Si aparecen otras pestañas pobladas, encabezados desconocidos, fórmulas sin valor calculado, claves duplicadas o relaciones sin resolver, se detiene para revisión.

## Correspondencia con la aplicación

- ID, CodigoEntrega y Entregado por se guardan sin sustituirlos por UUID o nombres de usuarios. Los UUID internos se relacionan mediante una tabla privada de correspondencias.
- Fecha se interpreta como fecha local de Quito en los datos sin zona horaria y se conserva como instante UTC. La instantánea privada mantiene el valor original.
- Estado convierte Pendiente a pending y Entregado a delivered. Un estado desconocido detiene la importación.
- Las líneas conservan su ID, receta, kg y valores originales. Una discrepancia entre el código de la línea y la cabecera se señala; la relación se resuelve mediante IDEntrega.
- Los ceros históricos se conservan. Las nuevas entregas siguen exigiendo cantidades positivas.
- Recibido por y Observaciones conservan incluso textos como N/A. No se crean contactos ficticios.
- Firma guarda la referencia original, no una imagen inventada. ComprobantePDF conserva el enlace de Drive. Los bytes requieren comprobar los permisos y copiar los originales a almacenamiento privado sin sobrescribirlos.
- GenerarComprobante se conserva en la instantánea privada. No se reproduce como una orden que vuelva a generar todos los documentos al importar.
- Los documentos históricos no pasan por el generador nuevo ni por su cola de archivo. Su diseño queda protegido hasta revisar el Apps Script y la plantilla de Slides.
- Los destinos sin dirección no reciben una dirección supuesta. Se crean inactivos hasta que administración la registre.
- Los participantes de reparto se enlazan con cuentas existentes únicamente mediante correspondencias expresas. No se crean usuarios o asignaciones a partir de nombres ambiguos. Administración puede consultar todo el historial.
- Los números originales no cambian. Cada contador queda como el máximo entre su valor vigente, el máximo importado más uno y el máximo ya emitido más uno.

## Preparación privada

Instalar Python 3 y las dependencias de scripts/migration/requirements.txt. Crear migration-data, que Git ignora. No guardar exportaciones, firmas, PDF, resultados o copias de base en public/ ni en el repositorio.

~~~sh
python scripts/migration/prepare.py /ruta/exportacion.xlsx --output migration-data/prepared.json --species-by-name
node scripts/migration/catalog.mjs migration-data/prepared.json
~~~

La clasificación por nombre se usa únicamente tras la indicación del propietario: nombres que contienen Gatos son de gatos; el resto se clasifica para perros. El catálogo distingue los nombres tal como están escritos; no fusiona variantes sin revisión. Sin --species-by-name queda sin clasificar y no se publica automáticamente.

El comando catalog solo revisa hasta añadir --apply. Conserva productos existentes que coincidan exactamente por nombre y crea los ausentes con identificadores estables. No elimina ni reemplaza productos.

## Activación de la base y publicación

Si todavía no se aplicó receipt_documents_drive, ejecutar **docs/activar-migracion-historica.sql una sola vez** en el SQL Editor del proyecto indicado por el propietario. Combina esa actualización y la histórica en una transacción. Conserva los datos operativos originales y prepara la numeración y estructuras nuevas.

Si receipt_documents_drive ya se aplicó, ejecutar solamente la migración adicional que termina en _legacy_sheet_import.sql. No ejecutar el esquema inicial ni ambas alternativas.

Publicar la rama que admite campos históricos, destinos sin dirección y comprobantes originales **antes de importar las filas históricas**. El código anterior no admite esas formas de datos. El redeploy por sí solo no aplica SQL.

~~~sh
NODE_USE_ENV_PROXY=1 node scripts/migration/import.mjs migration-data/prepared.json
NODE_USE_ENV_PROXY=1 node scripts/migration/import.mjs migration-data/prepared.json --apply
~~~

Los scripts de servidor usan el .env privado y verifican el proyecto de destino. No imprimen claves, datos completos ni enlaces de PDF. La transacción solo acepta el rol de servidor y exige un administrador activo. Reimportar la misma fuente reutiliza las claves; si cambia el contenido de una fila ya importada, se rechaza la transacción y se conserva lo anterior.

Para asociar repartidores, preparar un JSON privado con cada texto original de Entregado por como clave y una lista de UUID de perfiles confirmados como valor. Pasarlo con --assignments=migration-data/participants.json. Volver a ejecutar permite actualizar estas correspondencias sin reescribir los documentos históricos. Un perfil ajeno no obtiene acceso.

## Verificar y cerrar

~~~sh
python -m unittest discover -s scripts/migration -p 'test_*.py'
node scripts/migration/verify-local.mjs migration-data/prepared.json /ruta/copia-privada-app.json
npm run db:test
npm test
npm run build
npm run test:e2e
~~~

La validación local compara cada entrega, línea, código, fecha, receptor, observación, referencia de firma y enlace de PDF, y repite la importación para comprobar que no duplica registros. Puede comprobar una copia previa de la aplicación sin conectarse a ningún servicio externo.

Antes de considerar terminada la migración: comparar la instantánea con la hoja madre accesible, revisar el generador Apps Script y la plantilla, leer las firmas y PDF originales, comprobar los archivos preservados, validar accesos con cuentas reales y verificar los flujos Pendiente → Entregado → comprobante en la aplicación publicada. El sistema anterior y sus documentos se mantienen hasta completar estas comprobaciones.

## Uno o dos repartidores por entrega

Después de activar la base histórica, ejecutar docs/activar-dos-repartidores.sql. Añade un segundo perfil opcional, exige perfiles activos y diferentes, y permite que cualquiera de los dos confirme. El bloqueo de la entrega y la unicidad del comprobante mantienen una sola confirmación efectiva. La instantánea registra ambos nombres y quién confirmó.

En una entrega histórica, administración puede abrir «Relacionar repartidores del historial» y seleccionar hasta dos usuarios. Esta acción actualiza únicamente sus accesos y deja un evento administrativo; no cambia la fecha, productos, firma, receptor, texto original del reparto ni PDF. No se crean cuentas a partir de los nombres del Excel.
