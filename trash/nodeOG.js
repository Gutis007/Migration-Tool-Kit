const express = require('express');
const path = require('path');
const app = express();
const port = 3000;
const multer = require("multer");
const CSV = require("csv-string");
const { parse } = require("csv-parse");
const xml2js = require("xml2js"); // para XML

app.use(express.static(path.join(__dirname, 'public')));
app.listen(port, () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
});

const upload = multer({ storage: multer.memoryStorage() });

app.post("/upload", upload.single("archivo"), (req, res) => {
  if (!req.file) {
    return res.status(400).send("No se recibió archivo");
  }

  let fileContent;
  try {
    fileContent = req.file.buffer.toString("utf8");
  } catch (e) {
    fileContent = req.file.buffer.toString("latin1");
  }

  // Detectar tipo de archivo
  const filename = req.file.originalname.toLowerCase();

  if (filename.endsWith(".json")) {
    // Procesar JSON
    try {
      const jsonData = JSON.parse(fileContent);
      return res.json(jsonData);
    } catch (err) {
      return res.status(500).send("Error al parsear JSON");
    }
  } else if (filename.endsWith(".csv")) {
    // Procesar CSV
    const detected = CSV.detect(fileContent);
    parse(fileContent, { delimiter: detected, columns: true }, (err, records) => {
      if (err) {
        return res.status(500).send("Error al parsear CSV");
      }
      res.json(records);
    });
  } else if (filename.endsWith(".xml")) {
    // Procesar XML
    xml2js.parseString(fileContent, { explicitArray: false, trim: true }, (err, result) => {
      if (err) {
        return res.status(500).send("Error al parsear XML");
      }

    // Normalizar: si existe personas.persona, devolverlo como array
      if (result.personas && result.personas.persona) {
        const personas = Array.isArray(result.personas.persona)
        ? result.personas.persona
        : [result.personas.persona];
        return res.json(personas);
      }
    // Si no es la estructura esperada, devolver todo el objeto
    return res.json(result);
  });

  } else {
    return res.status(400).send("Formato de archivo no soportado (usa CSV, JSON o XML)");
  }
});