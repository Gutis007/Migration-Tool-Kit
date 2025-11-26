const form = document.getElementById('uploadForm');
const fileInput = document.getElementById('fileInput');
const dropArea = document.getElementById('drop-area');
const resultDiv = document.getElementById('result');
const loadingDiv = document.getElementById('loading');
const submitBtn = document.getElementById('submitBtn');

// --- Evento principal de subida (llamado por submit o drop) ---
async function handleUpload(file) {
    if (!file) return;

    // Resetear y mostrar carga
    resultDiv.innerHTML = '';
    loadingDiv.classList.remove('hidden');
    submitBtn.disabled = true;

    const formData = new FormData();
    formData.append('archivo', file);

    try {
        const res = await fetch('/upload', { method: 'POST', body: formData });
        const data = await res.json();
        
        if (!res.ok) {
            // Manejar errores 400/500 del servidor
            mostrarError(data.error || 'Error desconocido del servidor.', data.details);
            return;
        }

        mostrarResultados(data); // Mostrar el resumen de la migración

    } catch (err) {
        mostrarError('Error de conexión con el servidor.', err.message);
    } finally {
        loadingDiv.classList.add('hidden');
        submitBtn.disabled = false;
    }
}

// --- Manejo de Eventos ---
form.addEventListener('submit', (e) => {
    e.preventDefault();
    handleUpload(fileInput.files[0]);
});

// Drag & Drop
dropArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropArea.classList.add('highlight');
});
dropArea.addEventListener('dragleave', () => {
    dropArea.classList.remove('highlight');
});
dropArea.addEventListener('drop', (e) => {
    e.preventDefault();
    dropArea.classList.remove('highlight');

    const file = e.dataTransfer.files[0];
    if (file) {
        handleUpload(file);
    }
});

// --- Funciones de Visualización ---

function mostrarError(title, message) {
    resultDiv.innerHTML = `
        <div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative" role="alert">
            <strong class="font-bold">${title}</strong>
            <span class="block sm:inline">${message ? ' Detalles: ' + message : ''}</span>
        </div>
    `;
}

function mostrarResultados(summary) {
    let statusClass = summary.errorCount > 0 ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800';
    let statusTitle = summary.errorCount > 0 ? '¡Éxito Parcial con Errores de Validación!' : '¡Migración Exitosa!';

    let errorDetailsHtml = '';
    if (summary.errorCount > 0) {
        // Mostrar detalles de los errores de validación
        errorDetailsHtml = `
            <h3 class="text-xl font-semibold text-red-600 mt-6 mb-3">Detalles de Errores (${summary.errorCount} registros inválidos)</h3>
            <table class="w-full text-sm">
                <thead>
                    <tr>
                        <th class="w-1/12">Fila</th>
                        <th class="w-1/12">Datos</th>
                        <th class="w-10/12">Razones del Fallo</th>
                    </tr>
                </thead>
                <tbody>
                    ${summary.errorDetails.map(err => `
                        <tr class="align-top">
                            <td>${err.rowIndex}</td>
                            <td>${JSON.stringify(err.record).substring(0, 100)}...</td>
                            <td class="text-red-600">${err.errors.join('<br>')}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }

    resultDiv.innerHTML = `
        <div class="bg-white p-6 rounded-lg shadow-xl">
            <h2 class="text-2xl font-bold mb-4 ${statusClass.replace('bg-', 'text-')}" >${statusTitle}</h2>
            
            <div class="grid grid-cols-2 gap-4">
                <p><strong>Tabla Destino:</strong> <span class="font-mono">${summary.tableName}</span></p>
                <p><strong>Tiempo de Ejecución:</strong> ${summary.duration}</p>
                <p><strong>Registros Procesados:</strong> ${summary.totalRecords}</p>
                <p><strong>Registros Insertados:</strong> <span class="text-green-600 font-bold">${summary.insertedRecords}</span></p>
                <p><strong>Registros Válidos:</strong> ${summary.validRecords}</p>
                <p><strong>Registros con Errores:</strong> <span class="text-red-600 font-bold">${summary.errorCount}</span></p>
            </div>
            
            <!-- DDL generado -->
            <h3 class="text-xl font-semibold mt-6 mb-3">Esquema DDL Generado</h3>
            <pre class="bg-gray-100 p-3 rounded-md overflow-auto text-sm border border-gray-300">${summary.ddl}</pre>

            ${errorDetailsHtml}

        </div>
    `;
}