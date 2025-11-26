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

| **Módulo** | **Descripción** | **Cumplimiento** | 
| :--- | :--- | :--- |
| **Parsing Robusto** | Lee archivos CSV, JSON y XML. Implementa heurísticas para detectar delimitadores CSV comunes (`,`, `;`, `\t`, `|`) y maneja archivos con múltiples espacios. | ✅ | 
| **Inferencia DDL Avanzada** | Analiza el contenido para generar `CREATE TABLE` con el tipo de dato más apropiado (`INT`, `DATETIME`, `DECIMAL`, `TEXT`). | ✅ | 
| **Promoción de Tipo** | Rastrea la longitud máxima de las cadenas y promueve automáticamente `VARCHAR(255)` a `TEXT` si es necesario, evitando el error **"Data too long"**. | ✅ | 
| **Claves y Restricciones** | Define `PRIMARY KEY` (usando la primera columna como candidata) y añade `AUTO_INCREMENT` si la columna es numérica. Añade `NOT NULL` si no se encuentran valores vacíos. | ✅ | 
| **Carga Optimizada** | Utiliza la inserción masiva (`Bulk INSERT`) de MySQL para un rendimiento superior. | ✅ | 
| **Validación Avanzada** | Realiza validaciones en memoria, incluyendo la detección de valores duplicados (en la columna PK candidata) y valores fuera de rango (ej. números negativos, fechas imposibles como el 30 de febrero). | ✅ | 
| **Reporte y Exportación** | Genera un reporte de migración detallado en Markdown (`.md`) y el script DDL final (`.sql`) en la carpeta del servidor. | ✅ | 

## ⚙️ Configuración e Instalación

### 1. Requisitos

* Node.js (versión 18 o superior)

* Servidor MySQL

### 2. Instalación de Dependencias

Ejecuta estos comandos en la carpeta raíz del proyecto:
