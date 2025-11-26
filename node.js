// --- Importaciones ---
const express = require('express');
const path = require('path');
const multer = require("multer");
const mysql = require('mysql2/promise');
const { parse: parseCsv } = require("csv-parse");
const xml2js = require("xml2js");
const { writeFile } = require('fs/promises'); // Agregado para escribir archivos

// --- CONFIGURACIÓN DE EXPRESS ---
const app = express();
const port = 3000;
// Se asume que el frontend (index.html, index.js) está en la carpeta 'public'
const frontendPath = path.join(__dirname, 'public'); 

// Configuración de la Base de Datos
// Utiliza las credenciales de tu MySQL.
const DB_CONFIG = {
    host: "localhost",
    user: "root",
    password: "hola1234",
    database: "migration_db",
    port: 3306, 
    multipleStatements: true,
};

// Middleware para recibir archivos en memoria
const upload = multer({ storage: multer.memoryStorage() }); 

// Servir el frontend
app.use(express.static(frontendPath));
app.use(express.json());

// --- MODULO DE UTILIDADES DE DATOS (Adaptado de migration_tool.mjs) ---

/**
 * Función auxiliar para aplanar objetos anidados.
 */
function flattenRecord(record, parentKey = "", res = {}) {
    for (const key in record) {
        const val = record[key];
        const newKey = parentKey ? `${parentKey}_${key}` : key;
        
        if (typeof val === "object" && val !== null && !Array.isArray(val)) {
            flattenRecord(val, newKey, res);
        } else {
            res[newKey] = val;
        }
    }
    return res;
}

/**
 * Función auxiliar para intentar parsear CSV con un delimitador.
 */
function tryParseCsvPromise(content, delimiter) {
    return new Promise((resolve) => {
        parseCsv(content, { columns: true, skip_empty_lines: true, delimiter: delimiter, relax_column_count: true }, (err, recs) => {
            // Se acepta si no hay error de parsing.
            if (!err) { 
                resolve(recs); 
            } else {
                resolve(null);
            }
        });
    });
}


/**
 * MODULO 2 & 4: Inferencia DDL y Validación Avanzada de Datos.
 */
function inferAndValidate(tableName, records) {
    const columnDefinitions = {};
    const errorLog = [];
    const processedRecords = [];
    const uniqueValueTracker = {};
    
    // Se asume que la primera columna es la candidata a Clave Primaria
    const primaryKeyCandidate = Object.keys(records[0])[0]; 

    for (let rowIndex = 0; rowIndex < records.length; rowIndex++) {
        const record = records[rowIndex];
        let recordValid = true;
        let recordErrors = [];

        for (const key in record) {
            const value = record[key];

            if (!columnDefinitions[key]) {
                columnDefinitions[key] = { dataType: 'VARCHAR(255)', isNullable: true, maxLength: 0 };
            }

            if (!(value === null || value === '' || value === undefined)) {
                let inferredType = 'VARCHAR(255)';
                const numValue = Number(value);
                
                // 1. Rastreo de Longitud Máxima (para TEXT)
                if (typeof value === 'string') {
                    const length = value.length;
                    if (length > columnDefinitions[key].maxLength) {
                        columnDefinitions[key].maxLength = length;
                    }
                }

                // 2. Inferencia y Validación de Rango (Números)
                if (!isNaN(numValue) && isFinite(numValue) && value !== '') {
                    if (Number.isInteger(numValue)) {
                        inferredType = numValue > 2147483647 ? 'BIGINT' : 'INT';
                    } else {
                        inferredType = 'DECIMAL(10, 2)';
                    }
                    
                    // Validación de Rango: Números Negativos
                    if (numValue < 0 && key !== 'price' && key !== 'amount') { 
                        recordValid = false;
                        recordErrors.push(`Valor fuera de rango: número negativo (${numValue}) en la columna '${key}'.`);
                    }
                } 
                
                // 3. Inferencia y Validación de Rango (Fechas)
                const dateObj = new Date(value);
                const isParsableDate = dateObj.toString() !== 'Invalid Date' && dateObj.getTime() === dateObj.getTime();

                if (isParsableDate && String(value).length < 25) { 
                    inferredType = 'DATETIME'; 
                    // Validación de Fechas Imposibles (Febrero 30/31)
                    if (typeof value === 'string') {
                        const month = dateObj.getMonth() + 1; 
                        const day = dateObj.getDate();
                        if (month === 2 && day > 29) { 
                             recordValid = false;
                             recordErrors.push(`Fecha inválida: Febrero solo tiene 28 o 29 días, valor: ${value}.`);
                        }
                    }
                }
                
                // 4. Promoción de Tipo (Evitar Downgrade)
                const currentType = columnDefinitions[key].dataType;
                
                if (inferredType === 'VARCHAR(255)' || currentType === 'VARCHAR(255)') {
                    columnDefinitions[key].dataType = 'VARCHAR(255)';
                } else if (inferredType === 'DECIMAL(10, 2)' && currentType.startsWith('INT')) {
                    columnDefinitions[key].dataType = 'DECIMAL(10, 2)';
                } else if (inferredType === 'BIGINT' && currentType === 'INT') {
                    columnDefinitions[key].dataType = 'BIGINT';
                } else if (inferredType !== currentType) {
                    columnDefinitions[key].dataType = inferredType;
                }
            }
        }
        
        // 5. Validación de Duplicados (En memoria)
        const pkVal = record[primaryKeyCandidate];
        if (pkVal !== null && pkVal !== undefined && pkVal !== '') {
            if (!uniqueValueTracker[primaryKeyCandidate]) {
                uniqueValueTracker[primaryKeyCandidate] = new Set();
            }
            if (uniqueValueTracker[primaryKeyCandidate].has(pkVal)) {
                recordValid = false;
                recordErrors.push(`Valor duplicado detectado para la Clave Primaria '${primaryKeyCandidate}': ${pkVal}.`);
            } else {
                uniqueValueTracker[primaryKeyCandidate].add(pkVal);
            }
        }

        if (recordValid) {
            processedRecords.push(record);
        } else {
            errorLog.push({ rowIndex: rowIndex + 1, record: record, errors: recordErrors });
        }
    }

    // 6. Generación de DDL (CREATE TABLE)
    const columnDDLs = [];
    let primaryKeySet = false;

    for (const columnName in columnDefinitions) {
        const def = columnDefinitions[columnName];
        let ddlLine = `  \`${columnName}\` `;

        // Promoción a TEXT si es necesario
        if (def.dataType === 'VARCHAR(255)' && def.maxLength > 255) {
            def.dataType = 'TEXT';
        }
        ddlLine += def.dataType;

        const isNumericPKCandidate = def.dataType.startsWith('INT') || def.dataType === 'BIGINT';

        // Definición de NOT NULL
        const hasNulls = records.some(r => r[columnName] === null || r[columnName] === undefined || r[columnName] === '');
        if (!hasNulls) {
            ddlLine += ' NOT NULL';
        }

        // Definición de PRIMARY KEY
        if (!primaryKeySet && columnName === primaryKeyCandidate) {
            if (isNumericPKCandidate) {
                 ddlLine += ' AUTO_INCREMENT'; 
            }
            ddlLine += ' PRIMARY KEY';
            primaryKeySet = true;
        }

        columnDDLs.push(ddlLine);
    }
    
    // Si ninguna columna fue marcada como PK, usamos la primera por defecto
    if (!primaryKeySet && columnDDLs.length > 0) {
        columnDDLs[0] += ' PRIMARY KEY';
    }


    const ddlScript = `
        DROP TABLE IF EXISTS \`${tableName}\`;
        
        CREATE TABLE \`${tableName}\` (
            ${columnDDLs.join(',\n')}
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;

    return { ddl: ddlScript, validRecords: processedRecords, errorCount: errorLog.length, errorDetails: errorLog };
}


// --- RUTA PRINCIPAL DE MIGRACIÓN: /upload ---

app.post("/upload", upload.single("archivo"), async (req, res) => {
    const startTime = process.hrtime.bigint();
    if (!req.file) {
        return res.status(400).json({ error: "No se recibió archivo" });
    }

    const filename = req.file.originalname.toLowerCase();
    const fileExtension = path.extname(filename);
    const fileContent = req.file.buffer.toString("utf8"); 
    let records = [];
    const tableName = filename.split(".")[0].replace(/[^a-z0-9_]/gi, "_");
    
    let connection;
    let totalRecords = 0;

    try {
        // 1. PARSING ROBUSTO
        if (fileExtension === ".json") {
            const jsonData = JSON.parse(fileContent);
            const keys = Object.keys(jsonData);
            records = Array.isArray(jsonData) 
                ? jsonData 
                : (keys.length > 0 && Array.isArray(jsonData[keys[0]]) ? jsonData[keys[0]] : [jsonData]);

        } else if (fileExtension === ".csv") {
            // Detección de Delimitadores (coma, punto y coma, tabulación, etc.)
            const commonDelimiters = [',', ';', '\t', '|'];
            let parsedRecords = null;

            for (const delimiter of commonDelimiters) {
                parsedRecords = await tryParseCsvPromise(fileContent, delimiter);
                if (parsedRecords && Object.keys(parsedRecords[0] || {}).length > 1) { 
                    records = parsedRecords;
                    break;
                }
            }
            
            // Fallback para espacios (Heurística)
            if (!parsedRecords || Object.keys(records[0] || {}).length <= 1) {
                const lines = fileContent.trim().split(/\r?\n/);
                if (lines.length > 1) {
                    const headers = lines[0].trim().split(/\s{2,}/).map(h => h.trim().replace(/[^a-z0-9_]/gi, '').toLowerCase());
                    records = lines.slice(1).map(line => {
                        const values = line.trim().split(/\s{2,}/).map(v => v.trim()); 
                        const record = {};
                        headers.forEach((header, index) => {
                            if (index < values.length) {
                                record[header] = values[index];
                            }
                        });
                        return record;
                    }).filter(r => Object.keys(r).length > 0);
                    
                    if (records.length === 0) {
                         throw new Error("No se pudo determinar el delimitador CSV ni parsear los datos.");
                    }
                }
            }

        } else if (fileExtension === ".xml") {
            const result = await new Promise((resolve, reject) => {
                xml2js.parseString(fileContent, { explicitArray: false, trim: true }, (err, resu) => {
                    if (err) reject(err);
                    else resolve(resu);
                });
            });

            const rootKey = Object.keys(result)[0];
            const primaryArrayKey = result[rootKey] && Object.keys(result[rootKey]).length > 0 
                ? Object.keys(result[rootKey]).find(k => Array.isArray(result[rootKey][k])) || Object.keys(result[rootKey])[0]
                : rootKey;
            
            records = result[rootKey] && Array.isArray(result[rootKey][primaryArrayKey]) 
                ? result[rootKey][primaryArrayKey] 
                : (result[rootKey] ? [result[rootKey]] : [result]);

        } else {
            return res.status(400).json({ error: "Formato de archivo no soportado (solo CSV, JSON o XML)" });
        }
        
        if (records.length === 0) {
            return res.status(400).json({ error: "El archivo no contiene registros válidos para migrar." });
        }

        // 2. NORMALIZACIÓN y APLANAMIENTO
        records = records.map(r => flattenRecord(r));
        records = records.map(record => {
            const newRecord = {};
            for (const key in record) {
                const sanitizedKey = key.replace(/[^a-z0-9_]/gi, '').toLowerCase();
                
                // Conversión de arrays a string (para frontend y MySQL)
                let value = record[key];
                if (Array.isArray(value)) {
                    value = value.map(v => typeof v === 'object' && v !== null ? JSON.stringify(v) : v).join(', ');
                }
                
                newRecord[sanitizedKey] = value;
            }
            return newRecord;
        });
        totalRecords = records.length;


        // 3. MODULO DE INFERENCIA Y VALIDACIÓN
        const { ddl, validRecords, errorCount, errorDetails } = inferAndValidate(tableName, records, {});
        
        // 4. MODULO DE CARGA DE DATOS (MySQL)
        connection = await mysql.createConnection(DB_CONFIG);

        // Ejecutar DDL (Crear la tabla)
        await connection.query(ddl); 

        // Insertar registros (Bulk Insert)
        let insertedRows = 0;
        if (validRecords.length > 0) {
            const columns = Object.keys(validRecords[0]);
            
            const bulkValues = validRecords.map(record => columns.map(col => {
                const value = record[col];
                if (value === null || value === undefined || value === '') {
                    return null;
                }
                // Conversión al formato MySQL DATETIME
                if (new Date(value).toString() !== 'Invalid Date' && typeof value === 'string' && !isNaN(Date.parse(value))) {
                    return new Date(value).toISOString().slice(0, 19).replace('T', ' '); 
                }
                return value;
            }));

            const [result] = await connection.query(`INSERT INTO \`${tableName}\` (\`${columns.join('`, `')}\`) VALUES ?`, [bulkValues]);
            insertedRows = result.affectedRows;
        }
        
        // 5. MODULO DE REPORTE BÁSICO (Consolidado)
        const endTime = process.hrtime.bigint();
        const durationMs = Number(endTime - startTime) / 1e6;
        
        // --- LÓGICA DE EXPORTACIÓN DE ARCHIVOS (DDL y Reporte MD) ---
        const timestamp = Date.now();
        const exportFilenameBase = `${tableName}_${timestamp}`;
        const ddlFilename = `${exportFilenameBase}_schema.sql`;
        const reportFilename = `${exportFilenameBase}_report.md`;
        
        const ddlExportPath = path.join(process.cwd(), ddlFilename);
        const reportExportPath = path.join(process.cwd(), reportFilename);
        
        // Escribir DDL en archivo .sql
        await writeFile(ddlExportPath, ddl);
        console.log(`[EXPORT] DDL exportado a: ${ddlExportPath}`);

        // Construir Reporte en Markdown
        const overallStatus = errorCount > 0 ? 'ÉXITO PARCIAL CON ERRORES' : 'ÉXITO TOTAL';
        const reportContent = `
# 📄 Reporte de Migración - ${tableName.toUpperCase()}

**Estado General:** ${overallStatus}
**Tabla Destino:** \`${tableName}\`
**Tiempo de Ejecución:** ${(durationMs / 1000).toFixed(2)} segundos

---

## Resumen de Registros
| Métrica | Valor |
| :--- | :--- |
| Registros Procesados: | ${totalRecords} |
| Registros Válidos: | ${validRecords.length} |
| Registros Insertados: | ${insertedRows} |
| Registros con Errores de Validación: | ${errorCount} |

---

## Esquema DDL Generado

\`\`\`sql
${ddl}
\`\`\`

---

## 🛑 Detalles de Errores de Validación (${errorCount} Registros)

${errorCount > 0 
    ? errorDetails.map(err => 
        `### Fila ${err.rowIndex}\n\n` +
        `**Problemas:** ${err.errors.join(', ')}\n` +
        `**Datos:** \`${JSON.stringify(err.record)}\`\n`
      ).join('\n')
    : 'No se encontraron errores de validación en los registros.'}
`;
        
        // Escribir Reporte en archivo .md
        await writeFile(reportExportPath, reportContent);
        console.log(`[EXPORT] Reporte exportado a: ${reportExportPath}`);
        // --- FIN LÓGICA DE EXPORTACIÓN ---

        const summary = {
            tableName: tableName,
            totalRecords: totalRecords,
            validRecords: validRecords.length,
            insertedRecords: insertedRows,
            errorCount: errorCount,
            errorDetails: errorDetails,
            ddl: ddl, // Se mantiene para la visualización del frontend
            duration: `${(durationMs / 1000).toFixed(2)} segundos`, // Se mantiene para la visualización del frontend
            ddlFilename: ddlFilename, // Nuevo: Nombre de archivo para la descarga
            reportFilename: reportFilename // Nuevo: Nombre de archivo para la descarga
        };

        // 6. DEVOLVER RESULTADOS AL CLIENTE
        res.status(200).json(summary);

    } catch (err) {
        console.error("Error FATAL en el proceso de migración:", err.message);
        res.status(500).json({ 
            error: "Error al procesar/migrar archivo",
            details: err.message 
        });
    } finally {
        if (connection) {
            await connection.end();
        }
    }
});


// --- NUEVA RUTA PARA DESCARGAS ---
app.get("/download/:filename", (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(process.cwd(), filename);
    
    // Seguridad: Aseguramos que solo se descarguen los archivos generados con la convención de nombres
    if (filename.match(/^[a-z0-9_]+_\d+_(schema\.sql|report\.md)$/i)) {
        res.download(filePath, filename, (err) => {
            if (err) {
                console.error(`[DOWNLOAD ERROR] Error al intentar descargar ${filename}:`, err.message);
                // Si el archivo no existe (ej. fue eliminado), mostramos 404
                res.status(404).send("Archivo no encontrado o error de lectura.");
            }
        });
    } else {
        // Bloquear intentos de descargar archivos fuera del directorio de trabajo
        res.status(403).send("Acceso denegado a este tipo de archivo.");
    }
});


// --- LÓGICA DE INICIO Y BASE DE DATOS ---

// Crea la base de datos si no existe al iniciar el servidor
async function initializeDb() {
    let connection;
    try {
        connection = await mysql.createConnection({
            host: DB_CONFIG.host,
            user: DB_CONFIG.user,
            password: DB_CONFIG.password,
            multipleStatements: true
        });
        await connection.query(`CREATE DATABASE IF NOT EXISTS ${DB_CONFIG.database}`);
        console.log(`[DB INIT] Asegurando que la base de datos '${DB_CONFIG.database}' exista.`);
    } catch (e) {
        console.error(`[DB INIT ERROR] No se pudo inicializar la base de datos. Asegura que MySQL esté corriendo y que las credenciales sean correctas.`, e.message);
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

app.listen(port, async () => {
    console.log(`\nServidor corriendo en http://localhost:${port}`);
    await initializeDb();
});