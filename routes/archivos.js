const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pool = require('../db');
const authMiddleware = require('../middlewares/authenticate');

const router = express.Router();
const uploadDir = path.join(__dirname, '../uploads');

// Asegura que la carpeta de uploads exista
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Configuración de multer
const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}-${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const upload = multer({ 
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB por archivo
    files: 10 // Máximo 10 archivos por petición
  }
});

// Obtener archivos del usuario
router.get('/', authMiddleware, async (req, res) => {
  try {
    const [files] = await pool.query(
      'SELECT * FROM archivos WHERE id_usuario = ? AND en_papelera = FALSE ORDER BY fecha_subida DESC',
      [req.user.id]
    );
    res.json(files);
  } catch (error) {
    console.error('Error al obtener archivos:', error);
    res.status(500).json({ message: 'Error al obtener archivos' });
  }
});

// Obtener archivos en la papelera
router.get('/trash', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const [archivos] = await pool.query(
      'SELECT * FROM archivos WHERE id_usuario = ? AND en_papelera = TRUE ORDER BY fecha_eliminacion DESC',
      [userId]
    );
    res.json(archivos);
  } catch (error) {
    console.error('Error al obtener archivos de la papelera:', error);
    res.status(500).json({ error: 'Error al obtener archivos de la papelera' });
  }
});

// Subir múltiples archivos
router.post('/upload', authMiddleware, upload.array('files'), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No se han subido archivos' });
    }

    const id_usuario = req.user.id;
    const uploadedFiles = [];

    // Procesar cada archivo en paralelo
    await Promise.all(req.files.map(async (file) => {
      try {
        const fileBuffer = fs.readFileSync(file.path);
        const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

        const [result] = await pool.execute(
          `INSERT INTO archivos 
            (nombre_original, nombre_guardado, hash_sha256, tipo_archivo, tamanio, id_usuario) 
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            file.originalname,
            file.filename,
            hash,
            file.mimetype,
            file.size,
            id_usuario
          ]
        );

        uploadedFiles.push({
          id: result.insertId,
          name: file.originalname,
          size: file.size,
          type: file.mimetype
        });
      } catch (error) {
        console.error(`Error procesando archivo ${file.originalname}:`, error);
        // Eliminar el archivo si hubo error al guardar en BD
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
        throw error;
      }
    }));

    res.json({ 
      message: 'Archivos subidos correctamente',
      files: uploadedFiles,
      total: uploadedFiles.length
    });
  } catch (error) {
    console.error('Error al subir archivos:', error);
    
    // Limpiar archivos subidos si hay error
    if (req.files) {
      req.files.forEach(file => {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      });
    }

    res.status(500).json({ 
      error: 'Error al subir archivos',
      details: error.message 
    });
  }
});

// Listar archivos por usuario
router.get('/files', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const [archivos] = await pool.query(
      'SELECT * FROM archivos WHERE id_usuario = ? ORDER BY fecha_subida DESC',
      [userId]
    );

    res.json(archivos);
  } catch (error) {
    console.error("Error al listar archivos:", error);
    res.status(500).json({ error: 'Error al obtener archivos' });
  }
});

// Descargar archivo
router.get('/download/:filename', (req, res) => {
  const filePath = path.join(uploadDir, req.params.filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Archivo no encontrado' });
  }

  res.download(filePath);
});

// Eliminar archivo
router.delete('/delete/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    // 1. Obtener información del archivo desde la BD
    const [rows] = await pool.query(
      "SELECT nombre_guardado FROM archivos WHERE id_archivo = ? AND id_usuario = ?", 
      [id, req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Archivo no encontrado" });
    }

    const nombreArchivo = rows[0].nombre_guardado;
    const filePath = path.join(uploadDir, nombreArchivo);

    // 2. Eliminar archivo del sistema de archivos
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    } else {
      console.warn(`El archivo ${filePath} no existe en el sistema de archivos`);
    }

    // 3. Eliminar registro de la base de datos
    await pool.query("DELETE FROM archivos WHERE id_archivo = ? AND id_usuario = ?", [id, req.user.id]);

    res.json({ mensaje: "Archivo eliminado correctamente" });
  } catch (err) {
    console.error("Error al eliminar archivo:", err);
    res.status(500).json({ 
      error: "Error al eliminar el archivo",
      details: err.message 
    });
  }
});

// Mover archivo a la papelera
router.post('/move-to-trash/:id', authMiddleware, async (req, res) => {
  try {
    const [result] = await pool.query(
      'UPDATE archivos SET en_papelera = TRUE, fecha_eliminacion = CURRENT_TIMESTAMP WHERE id_archivo = ? AND id_usuario = ?',
      [req.params.id, req.user.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    res.json({ message: 'Archivo movido a la papelera' });
  } catch (error) {
    console.error('Error al mover archivo a la papelera:', error);
    res.status(500).json({ error: 'Error al mover el archivo a la papelera' });
  }
});

// Restaurar archivo de la papelera
router.post('/restore/:id', authMiddleware, async (req, res) => {
  try {
    const [result] = await pool.query(
      'UPDATE archivos SET en_papelera = FALSE, fecha_eliminacion = NULL WHERE id_archivo = ? AND id_usuario = ?',
      [req.params.id, req.user.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    res.json({ message: 'Archivo restaurado correctamente' });
  } catch (error) {
    console.error('Error al restaurar archivo:', error);
    res.status(500).json({ error: 'Error al restaurar el archivo' });
  }
});

// Eliminar archivo permanentemente
router.delete('/delete-permanent/:id', authMiddleware, async (req, res) => {
  try {
    // Primero obtenemos la información del archivo
    const [files] = await pool.query(
      'SELECT nombre_guardado FROM archivos WHERE id_archivo = ? AND id_usuario = ?',
      [req.params.id, req.user.id]
    );

    if (files.length === 0) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    const filePath = path.join(uploadDir, files[0].nombre_guardado);

    // Eliminamos el archivo físico
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Eliminamos el registro de la base de datos
    await pool.query(
      'DELETE FROM archivos WHERE id_archivo = ? AND id_usuario = ?',
      [req.params.id, req.user.id]
    );

    res.json({ message: 'Archivo eliminado permanentemente' });
  } catch (error) {
    console.error('Error al eliminar archivo permanentemente:', error);
    res.status(500).json({ error: 'Error al eliminar el archivo permanentemente' });
  }
});

// Compartir archivo
router.post('/share/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { email } = req.body;

    // Verificar que el archivo existe y pertenece al usuario
    const [archivo] = await pool.query(
      'SELECT * FROM archivos WHERE id_archivo = ? AND id_usuario = ?',
      [id, req.user.id]
    );

    if (archivo.length === 0) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    // Verificar que el usuario con el que se quiere compartir existe
    const [usuario] = await pool.query(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (usuario.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // Verificar si ya está compartido
    const [compartido] = await pool.query(
      'SELECT * FROM archivos_compartidos WHERE id_archivo = ? AND id_usuario_compartido = ?',
      [id, usuario[0].id]
    );

    if (compartido.length > 0) {
      return res.status(400).json({ error: 'El archivo ya está compartido con este usuario' });
    }

    // Compartir el archivo
    await pool.query(
      'INSERT INTO archivos_compartidos (id_archivo, id_usuario_compartido) VALUES (?, ?)',
      [id, usuario[0].id]
    );

    res.json({ message: 'Archivo compartido correctamente' });
  } catch (error) {
    console.error('Error al compartir archivo:', error);
    res.status(500).json({ error: 'Error al compartir el archivo' });
  }
});

// Obtener archivos compartidos con el usuario
router.get('/shared', authMiddleware, async (req, res) => {
  try {
    const [archivos] = await pool.query(
      `SELECT a.*, u.username as propietario 
       FROM archivos a 
       JOIN archivos_compartidos ac ON a.id_archivo = ac.id_archivo 
       JOIN users u ON a.id_usuario = u.id 
       WHERE ac.id_usuario_compartido = ? 
       ORDER BY a.fecha_subida DESC`,
      [req.user.id]
    );

    res.json(archivos);
  } catch (error) {
    console.error('Error al obtener archivos compartidos:', error);
    res.status(500).json({ error: 'Error al obtener archivos compartidos' });
  }
});

// Dejar de compartir archivo
router.delete('/unshare/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { email } = req.body;

    // Verificar que el archivo existe y pertenece al usuario
    const [archivo] = await pool.query(
      'SELECT * FROM archivos WHERE id_archivo = ? AND id_usuario = ?',
      [id, req.user.id]
    );

    if (archivo.length === 0) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    // Obtener el ID del usuario con el que se compartió
    const [usuario] = await pool.query(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (usuario.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // Eliminar el compartido
    await pool.query(
      'DELETE FROM archivos_compartidos WHERE id_archivo = ? AND id_usuario_compartido = ?',
      [id, usuario[0].id]
    );

    res.json({ message: 'Archivo dejado de compartir correctamente' });
  } catch (error) {
    console.error('Error al dejar de compartir archivo:', error);
    res.status(500).json({ error: 'Error al dejar de compartir el archivo' });
  }
});

module.exports = router;