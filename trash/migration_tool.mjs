import { Command } from 'commander'; // Para la interfaz CLI
import { readFile, writeFile } from 'fs/promises'; // Módulo nativo para manejo de archivos asíncrono
import * as path from 'path'; // Módulo nativo para manejo de rutas
import mysql from 'mysql2/promise'; // Para la conexión a MySQL
import { parse as parseCsv } from 'csv-parse/sync'; // Para parsear CSV de forma síncrona/fácil
import { parseStringPromise } from 'xml2js'; // Para parsear XML

// --- CONFIGURACIÓN DE LA BASE DE DATOS ---
const DB_CONFIG = {
    host: 'localhost',
    user: 'root',
    password: 'hola1234', // ¡REEMPLAZAR con tu contraseña real si no es 'hola1234'!
    database: 'migration_db',
    port: 3306,
    // Permite ejecutar múltiples comandos SQL (DROP TABLE y CREATE TABLE) en una sola llamada.
    multipleStatements: true, 
};

// --- PLAN DE MIGRACIÓN MULTI-TABLA (Define la lista y el ORDEN de los archivos) ---
// NOTA: Es crucial que las tablas "padre" (sin claves foráneas dependientes) vayan primero.
const MIGRATION_PLAN = [
    // Ejemplo: Reemplaza estas rutas con tus archivos reales.
    // { filePath: './data/clientes.csv', uniqueColumns: ['id', 'email'] }, // Se puede definir la unicidad aquí
    // { filePath: './data/productos.json' }, 
];

// --- MÓDULOS DEL SISTEMA ---

/**
 * Función auxiliar para intentar parsear un CSV con un delimitador específico.
 */
function tryParseCsv(content, delimiter) {
    try {
        const records = parseCsv(content, {
            columns: true,
            skip_empty_lines: true,
            delimiter: delimiter,
            relax_column_count: true 
        });
        if (records.length > 0 && Object.keys(records[0]).length > 1) {
             // Si el delimitador es un espacio, se etiqueta como heurístico
            console.log(`[INFO] Delimitador detectado: '${delimiter === ' ' ? 'Múltiples Espacios (Heurística)' : delimiter}'`);
            return records;
        }
        return null;
    } catch (e) {
        return null;
    }
}


/**
    * Módulo 1: Parsing de Archivos (CSV, JSON, XML)
    * Convierte el contenido del archivo a una estructura uniforme (Array de Objetos).
    * @param {string} filePath - La ruta del archivo de entrada.
    * @returns {Promise<{tableName: string, records: Object[]}>}
    */
async function parseFile(filePath) {
    const fileExtension = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath, fileExtension);
    const tableName = fileName.replace(/[^a-z0-9_]/gi, '_').toLowerCase(); // Nombre de tabla sanitizado
    const content = await readFile(filePath, 'utf-8');

    console.log(`\n[INFO] Analizando archivo: ${filePath} (Tipo: ${fileExtension})`);

    let records = [];

    switch (fileExtension) {
        case '.csv':
            // --- Lógica de Detección Automática de Delimitador ---
            const commonDelimiters = [',', ';', '\t', '|'];
            let parsedRecords = null;

            for (const delimiter of commonDelimiters) {
                parsedRecords = tryParseCsv(content, delimiter);
                if (parsedRecords) {
                    records = parsedRecords;
                    break;
                }
            }
            
            // Caso especial: Separado por Espacios (Heurística)
            if (!parsedRecords) {
                const lines = content.trim().split(/\r?\n/);
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
                    
                    if (records.length > 0) {
                        console.log(`[INFO] Delimitador detectado: Múltiples Espacios (Heurística)`);
                    } else {
                        throw new Error("[ERROR] No se pudo determinar el delimitador CSV ni parsear los datos.");
                    }
                }
            }
            
            if (records.length === 0) {
                throw new Error("[ERROR] El archivo CSV no contiene registros válidos.");
            }
            
            break;
            case '.json':
            records = JSON.parse(content);
            if (!Array.isArray(records)) {
                const keys = Object.keys(records);
                records = keys.length > 0 && Array.isArray(records[keys[0]]) ? records[keys[0]] : [];
            }
            break;
        case '.xml':
            const result = await parseStringPromise(content);
            const rootKey = Object.keys(result)[0];
            const primaryArrayKey = Object.keys(result[rootKey])[0];
            records = result[rootKey][primaryArrayKey] || [];
            
            records = records.map(record => {
                let flatRecord = {};
                for (const key in record) {
                    flatRecord[key] = Array.isArray(record[key]) && record[key].length === 1 ? record[key][0] : record[key];
                }
                return flatRecord;
            });
            break;
        default:
            throw new Error(`[ERROR] Tipo de archivo no soportado: ${fileExtension}`);
    }

    if (records.length === 0) {
        throw new Error("[ERROR] No se encontraron registros válidos para la migración.");
    }

    // Normalizar claves a snake_case para MySQL y sanitizar
    records = records.map(record => {
        const newRecord = {};
        for (const key in record) {
            const sanitizedKey = key.replace(/[^a-z0-9_]/gi, '').toLowerCase();
            newRecord[sanitizedKey] = record[key];
        }
        return newRecord;
    });

    return { tableName, records };
}

/**
 * Módulo 2 y 4: Inferencia DDL y Validación Avanzada de Datos
 */
function inferAndValidate(tableName, records, migrationTarget) {
    const columnDefinitions = {};
    const errorLog = [];
    const processedRecords = [];

    if (records.length === 0) return { ddl: '', validRecords: [], errorCount: 0, errorDetails: [] };

    // Set para rastrear duplicados
    const uniqueValueTracker = {};

    for (let rowIndex = 0; rowIndex < records.length; rowIndex++) {
        const record = records[rowIndex];
        let recordValid = true;
        let recordErrors = [];

        for (const key in record) {
            const value = record[key];

            if (!columnDefinitions[key]) {
                columnDefinitions[key] = {
                    dataType: 'VARCHAR(255)', 
                    isNullable: true,
                    maxLength: 0, 
                };
            }

            if (!(value === null || value === '' || value === undefined)) {
                let inferredType = 'VARCHAR(255)';
                const numValue = Number(value);
                
                // 1. Rastreo de Longitud Máxima
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
                    
                    // --- Validación de Rango: Números Negativos donde NO deben ir (Heurística)
                    if (numValue < 0 && key !== 'price' && key !== 'amount') { 
                        recordValid = false;
                        recordErrors.push(`Valor fuera de rango: número negativo (${numValue}) en la columna '${key}'.`);
                    }
                    // --- Fin Validación de Rango ---

                } 
                
                // 3. Inferencia y Validación de Rango (Fechas)
                const dateObj = new Date(value);
                const isParsableDate = dateObj.toString() !== 'Invalid Date' && dateObj.getTime() === dateObj.getTime();

                if (isParsableDate && value.length < 25) { 
                    inferredType = 'DATETIME'; 
                    // --- Validación de Fechas Imposibles
                    // Si el valor es una cadena, se puede intentar validar la fecha
                    if (typeof value === 'string') {
                        const [year, month, day] = value.split(/[-/\s]/).map(Number);
                        if (month === 2 && day > 29) { // Simple check for Feb 30/31
                            recordValid = false;
                            recordErrors.push(`Fecha inválida: Febrero solo tiene 28 o 29 días, valor: ${value}.`);
                        }
                    }
                    // --- Fin Validación de Fechas Imposibles
                }
                
                // --- PROMOCIÓN DE TIPO (Prevenir Downgrade) ---
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
                // --- FIN DE PROMOCIÓN DE TIPO ---
            }
        }
        
        // 4. Validación Avanzada: Detección de Duplicados en Memoria (Simulación)
        const uniqueColumns = migrationTarget.uniqueColumns || []; // Obtener columnas únicas del plan
        uniqueColumns.forEach(col => {
            const val = record[col];
            if (val !== null && val !== undefined && val !== '') {
                if (!uniqueValueTracker[col]) {
                    uniqueValueTracker[col] = new Set();
                }
                if (uniqueValueTracker[col].has(val)) {
                    recordValid = false;
                    recordErrors.push(`Valor duplicado en columna única '${col}': ${val}.`);
                } else {
                    uniqueValueTracker[col].add(val);
                }
            }
        });

        if (recordValid) {
            processedRecords.push(record);
        } else {
            errorLog.push({ 
                rowIndex: rowIndex + 1, // Fila en el archivo (1-based)
                record: record, 
                errors: recordErrors 
            });
        }
    }

    // 1. Promoción de VARCHAR(255) a TEXT si es necesario
    for (const columnName in columnDefinitions) {
        const def = columnDefinitions[columnName];
        if (def.dataType === 'VARCHAR(255)' && def.maxLength > 255) {
            def.dataType = 'TEXT';
            console.log(`[INFO] Columna '${columnName}' promovida a TEXT (longitud máxima: ${def.maxLength}).`);
        }
    }

    // 2. Construcción de DDL
    const columnDDLs = [];
    let primaryKeySet = false;

    for (const columnName in columnDefinitions) {
        const def = columnDefinitions[columnName];
        let ddlLine = `  \`${columnName}\` ${def.dataType}`;

        const isNumericPKCandidate = def.dataType.startsWith('INT') || def.dataType === 'BIGINT';

        // Definición de NOT NULL
        const hasNulls = records.some(r => r[columnName] === null || r[columnName] === undefined || r[columnName] === '');
        if (!hasNulls) {
            ddlLine += ' NOT NULL';
        }

        // Definición de PRIMARY KEY con AUTO_INCREMENT (si es numérico)
        if (!primaryKeySet && (columnName === 'id' || columnName === Object.keys(columnDefinitions)[0])) {
            
            if (isNumericPKCandidate) {
                ddlLine += ' AUTO_INCREMENT'; 
            }
            
            ddlLine += ' PRIMARY KEY';
            primaryKeySet = true;
        }

        // --- Adición de UNIQUE KEY si está definida en el plan ---
        if (migrationTarget.uniqueColumns && migrationTarget.uniqueColumns.includes(columnName)) {
            ddlLine += ' UNIQUE'; // MySQL se encargará de la validación final en la inserción.
        }
        // --- Fin Adición de UNIQUE KEY ---

        columnDDLs.push(ddlLine);
    }
    
    const ddlScript = `
-- Script SQL generado por DataMigrator CLI
-- Tabla: ${tableName}
-- Fecha: ${new Date().toISOString()}

DROP TABLE IF EXISTS \`${tableName}\`;

CREATE TABLE \`${tableName}\` (
${columnDDLs.join(',\n')}
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

    return { ddl: ddlScript, validRecords: processedRecords, errorCount: errorLog.length, errorDetails: errorLog };
}


/**
 * Módulo 3: Cargador de Datos (Ejecuta DDL e Inserciones)
 */
async function loadData(ddl, tableName, validRecords) {
    let connection;
    try {
        connection = await mysql.createConnection(DB_CONFIG); 
        console.log('[INFO] Conexión a MySQL establecida.');

        // 1. Ejecutar DDL (Crear la tabla)
        console.log(`[INFO] Creando o re-creando la tabla '${tableName}'...`);
        await connection.query(ddl); 

        if (validRecords.length === 0) {
            console.log('[INFO] No hay registros válidos para insertar.');
            return 0;
        }

        // 2. Generar y Ejecutar Sentencias INSERT (Bulk Insert)
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

        console.log(`[INFO] Insertando ${validRecords.length} registros en BULK...`);
        const [result] = await connection.query(`INSERT INTO \`${tableName}\` (\`${columns.join('`, `')}\`) VALUES ?`, [bulkValues]);
        
        return result.affectedRows;

    } catch (error) {
        console.error(`[FATAL] Error durante la carga de datos para la tabla '${tableName}':`, error.message);
        throw error;
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

/*
    * Función Principal para el Proceso de Migración
*/
async function run() {
    const startTime = process.hrtime.bigint();
    const tableResults = [];

    // --- Configuración de CLI para la ruta del plan o un archivo único ---
    const program = new Command();
    program
        .version('1.0.0')
        .name('datamigrator')
        .description('Herramienta de migración de datos heterogéneos a MySQL (Soporte Multi-Tabla).')
        .option('-f, --file <path>', 'Ruta a un archivo fuente (Si no usa plan).', null)
        .parse(process.argv);
    
    const options = program.opts();
    let migrationTargets = [];

    if (options.file) {
        // Modo archivo único (compatibilidad con versión anterior)
        migrationTargets = [{ filePath: options.file }];
        console.log(`[INFO] Modo Archivo Único. Archivo: ${options.file}`);
    } else if (MIGRATION_PLAN.length > 0) {
        // Modo Multi-Tabla con plan predefinido
        migrationTargets = MIGRATION_PLAN;
        console.log(`[INFO] Modo Plan de Migración. Procesando ${MIGRATION_PLAN.length} tablas.`);
    } else {
        console.error('[ERROR] No se especificó el archivo (--file) y el MIGRATION_PLAN está vacío. Por favor, configure el plan.');
        return;
    }


    // --- Procesamiento de Múltiples Tablas ---
    let migrationFailed = false;

    for (let i = 0; i < migrationTargets.length; i++) {
        const migrationTarget = migrationTargets[i];
        const { filePath } = migrationTarget;
        
        let tableName = path.basename(filePath, path.extname(filePath)).replace(/[^a-z0-9_]/gi, '_').toLowerCase();
        let totalRecords = 0, insertedRecords = 0, errorCount = 0;
        let status = 'ÉXITO';

        console.log(`\n\n=== INICIANDO TABLA ${i + 1}/${migrationTargets.length}: ${tableName} ===`);

        try {
            // 1. Parsear
            const parsedResult = await parseFile(filePath);
            tableName = parsedResult.tableName;
            totalRecords = parsedResult.records.length;

            // 2. Inferir esquema y validar (Pasando el migrationTarget con las columnas únicas)
            const { ddl, validRecords, errorCount: eCount, errorDetails: eDetails } = inferAndValidate(tableName, parsedResult.records, migrationTarget);
            errorCount = eCount;

            // 3. Guardar DDL
            const ddlFilePath = path.join(path.dirname(filePath), `${tableName}_schema.sql`);
            await writeFile(ddlFilePath, ddl);
            console.log(`[SUCCESS] DDL guardado en: ${ddlFilePath}`);

            // 4. Cargar datos
            if (validRecords.length > 0) {
                insertedRecords = await loadData(ddl, tableName, validRecords);
                console.log(`[SUCCESS] Inserción completada para ${tableName}.`);
            } else {
                console.log(`[INFO] No hay registros válidos para insertar en ${tableName}.`);
            }
            
            // Si hay errores de validación, se reportan, pero la migración no falla.
            if (errorCount > 0) {
                status = `ÉXITO PARCIAL (${errorCount} errores de validación)`;
            }

            // --- 5. Reporte Detallado de Errores de Validación (Nuevo Archivo) ---
            if (errorCount > 0) {
                const errorReportPath = path.join(path.dirname(filePath), `${tableName}_errores_validacion.txt`);
                const errorReportContent = `
--- REPORTE DE ERRORES DE VALIDACIÓN PARA TABLA: ${tableName} ---
Total de Registros Procesados: ${totalRecords}
Registros Inválidos Reportados: ${errorCount}

--- DETALLES DE CADA REGISTRO INVÁLIDO ---
${eDetails.map(err => `
    Fila: ${err.rowIndex}
    Errores: ${err.errors.join(', ')}
    Datos: ${JSON.stringify(err.record)}
`).join('\n')}
`;
                await writeFile(errorReportPath, errorReportContent);
                console.log(`[WARNING] Errores de validación detallados en: ${errorReportPath}`);
            }
            // --- Fin Reporte Detallado ---


        } catch (e) {
            status = 'FALLO FATAL';
            migrationFailed = true;
            console.error(`[ERROR] Proceso detenido por fallo fatal en la tabla ${tableName}.`, e.message);
        } finally {
            tableResults.push({
                tableName: tableName,
                filePath: filePath,
                status: status,
                totalRecords: totalRecords,
                insertedRecords: insertedRecords,
                errorCount: errorCount,
            });

            if (migrationFailed) {
                // Si falla una tabla, rompemos el ciclo para mantener la integridad (por si había Foreign Keys)
                break; 
            }
        }
    }

    // --- 6. Generar Reporte Básico de Migración Consolidado ---
    const endTime = process.hrtime.bigint();
    const durationMs = Number(endTime - startTime) / 1e6;
    const reportPath = path.join(process.cwd(), `reporte_consolidado_${Date.now()}.txt`);
    
    const overallStatus = migrationFailed ? 'FALLO GLOBAL' : (tableResults.some(r => r.errorCount > 0) ? 'ÉXITO PARCIAL' : 'ÉXITO TOTAL');
    
    const tableSummaries = tableResults.map(r => 
        `  - Tabla: ${r.tableName} (${r.status})\n` +
        `    Archivos: ${r.filePath}\n` +
        `    Procesados: ${r.totalRecords}, Insertados: ${r.insertedRecords}, Errores: ${r.errorCount}\n`
    ).join('\n');


    const reportContent = `
--- REPORTE CONSOLIDADO DE MIGRACIÓN ---
Estado General: ${overallStatus}
Tiempo Total de Ejecución: ${(durationMs / 1000).toFixed(2)} segundos.
Destino: MySQL (${DB_CONFIG.database})

Tablas Identificadas y Procesadas: ${migrationTargets.length}
Tablas con Éxito/Parcial: ${tableResults.filter(r => r.status.startsWith('ÉXITO')).length}
Tablas Fallidas: ${tableResults.filter(r => r.status.includes('FALLO')).length}

--- RESUMEN POR TABLA ---
${tableSummaries}

--- DETALLES DE CONEXIÓN ---
Nota: Si hubo FALLO FATAL, el proceso se detuvo inmediatamente para preservar la integridad de la BD.
`;

    await writeFile(reportPath, reportContent);
    console.log(`\n\n[FINAL] Reporte Consolidado generado en: ${reportPath}`);
}

run();

/*
    Instrucciones para correr el script:
    1. Asegúrate de tener Node.js instalado.
    2. Crea un proyecto y descarga las dependencias:
        npm init -y
        npm install commander mysql2 csv-parse xml2js
    3. Para probar la multi-tabla, llena el array MIGRATION_PLAN con las rutas a tus archivos.
        (Puedes añadir un campo 'uniqueColumns' para probar la detección de duplicados)
    4. Ejecuta el script:
        node migration_tool.js
    
    O para compatibilidad con el modo de un solo archivo:
        node migration_tool.js --file ./ruta/a/archivo.csv
*/