# 🚀 DataMigrator Web Edition

**Herramienta unificada de ingeniería de datos para la migración de archivos heterogéneos (CSV, JSON, XML) a MySQL a través de una interfaz web.**

Este proyecto combina la facilidad de uso de una aplicación web (Express + Frontend) con un motor robusto de análisis de datos desarrollado en Node.js, garantizando una migración de alta calidad y con validación avanzada.

## 🛠️ Arquitectura del Proyecto

El proyecto está diseñado como una aplicación **monolítica** en Node.js, organizada en tres capas principales:

1. **Frontend (`public/`):** Interfaz de usuario para la subida de archivos (Drag & Drop y botón).

2. **Backend (`server.js`):** El servidor Express que maneja las rutas y actúa como el **Motor de Migración**.

3. **Capa de Persistencia:** Base de datos MySQL.

## ✨ Características y Funcionalidades

El motor de migración encapsulado en `server.js` incluye estrictamente los siguientes módulos avanzados:

| **Módulo**                  | **Descripción**                                                                                                                                                                                        | **Cumplimiento**                             |
| :-------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------- | --- |
| **Parsing Robusto**         | Lee archivos CSV, JSON y XML. Implementa heurísticas para detectar delimitadores CSV comunes (`,`, `;`, `\t`, `                                                                                        | `) y maneja archivos con múltiples espacios. | ✅  |
| **Inferencia DDL Avanzada** | Analiza el contenido para generar `CREATE TABLE` con el tipo de dato más apropiado (`INT`, `DATETIME`, `DECIMAL`, `TEXT`).                                                                             | ✅                                           |
| **Promoción de Tipo**       | Rastrea la longitud máxima de las cadenas y promueve automáticamente `VARCHAR(255)` a `TEXT` si es necesario, evitando el error **"Data too long"**.                                                   | ✅                                           |
| **Claves y Restricciones**  | Define `PRIMARY KEY` (usando la primera columna como candidata) y añade `AUTO_INCREMENT` si la columna es numérica. Añade `NOT NULL` si no se encuentran valores vacíos.                               | ✅                                           |
| **Carga Optimizada**        | Utiliza la inserción masiva (`Bulk INSERT`) de MySQL para un rendimiento superior.                                                                                                                     | ✅                                           |
| **Validación Avanzada**     | Realiza validaciones en memoria, incluyendo la detección de valores duplicados (en la columna PK candidata) y valores fuera de rango (ej. números negativos, fechas imposibles como el 30 de febrero). | ✅                                           |
| **Reporte y Exportación**   | Genera un reporte de migración detallado en Markdown (`.md`) y el script DDL final (`.sql`) en la carpeta del servidor.                                                                                | ✅                                           |

## ⚙️ Configuración e Instalación

### 1. Requisitos

- Node.js (versión 18 o superior)

- Servidor MySQL

### 2. Instalación de Dependencias

Ejecuta estos comandos en la carpeta raíz del proyecto:

```

npm init -y
npm install express multer mysql2 csv-parse xml2js

```

### 3. Configuración de Base de Datos

Abre el archivo `server.js` y ajusta el objeto `DB_CONFIG` con tus credenciales de MySQL.

```

// Fragmento de server.js
const DB\_CONFIG = {
host: "localhost",
user: "root",
password: "TU\_CONTRASEÑA\_AQUI", // \<--- ¡Asegúrate de cambiar esto\!
database: "migration\_db",
port: 3306,
multipleStatements: true,
};

```

**Importante:** La función `initializeDb()` en `server.js` creará la base de datos `migration_db` si no existe al iniciar el servidor.

### 4. Estructura de Archivos

Tu proyecto debe tener la siguiente estructura:

```

/tu-proyecto
|-- server.js        \<-- Backend, Motor de Migración y Rutas de descarga
|-- package.json
|-- /public
|   |-- index.html   \<-- Interfaz de usuario (HTML)
|   |-- index.js     \<-- Lógica del cliente (Envío y visualización)

```

## 🚀 Uso de la Aplicación

1. **Iniciar el Servidor:**

```

node server.js

```

Verás el mensaje: `Servidor corriendo en http://localhost:3000`

2. **Acceder a la Interfaz:**
   Abre tu navegador y ve a `http://localhost:3000`.

3. **Migrar un Archivo:**

- Sube o arrastra un archivo (`.csv`, `.json`, `.xml`).

- Haz clic en **Migrar**.

### 📂 Salidas y Descargas

Al finalizar la migración, la interfaz mostrará un resumen y dos botones de descarga. Los archivos se guardarán localmente en la carpeta donde ejecutaste `node server.js`:

- **DDL (`[tabla]_[timestamp]_schema.sql`):** El script SQL para crear la tabla.

- **Reporte (`[tabla]_[timestamp]_report.md`):** Un reporte en formato Markdown con el resumen de registros, el DDL y los detalles de cualquier error de validación encontrado.

```

```
