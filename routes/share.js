const express = require('express');
const router = express.Router();
const db = require('../db');
const fs = require('fs');
const path = require('path');
const authMiddleware = require('../middlewares/authenticate');


router.get('/search-users', authMiddleware, async (req, res) => {
  const { query } = req.query;
  const userId = req.user.id; 
  
  try {
    const [users] = await db.query(
      `SELECT id, username, email 
       FROM users 
       WHERE (email LIKE ? OR username LIKE ?) AND id != ? 
       LIMIT 10`,
      [`%${query}%`, `%${query}%`, userId]
    );
    
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error buscando usuarios' });
  }
});


// Obtener archivos compartidos que el usuario ha movido a la papelera
router.get('/shared-trash', authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    const [trashFiles] = await db.query(
      `SELECT a.id_archivo, a.nombre_original, a.tipo_archivo, a.tamanio, 
              a.fecha_subida, u.username as owner_name, ac.permisos, p.fecha_eliminacion
       FROM papelera p
       JOIN archivos_compartidos ac ON p.id_archivo = ac.id_archivo AND p.id_usuario = ac.id_receptor
       JOIN archivos a ON p.id_archivo = a.id_archivo
       JOIN users u ON ac.id_propietario = u.id
       WHERE p.id_usuario = ?`,
      [userId]
    );

    res.json(trashFiles);
  } catch (err) {
    console.error('Error al obtener archivos compartidos en papelera:', err);
    res.status(500).json({ error: 'Error al obtener archivos en papelera compartida' });
  }
});


// Compartir archivo con otro usuario
router.post('/share-file', authMiddleware, async (req, res) => {
  const { fileId, recipientEmail, permission } = req.body;
  const ownerId = req.user.id;

  if (!fileId || !recipientEmail || !permission) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }

  try {
    // Verificar que el archivo existe y pertenece al usuario
    const [files] = await db.query(
      `SELECT id_archivo FROM archivos 
       WHERE id_archivo = ? AND id_usuario = ?`,
      [fileId, ownerId]
    );
    
    if (files.length === 0) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    // Buscar al usuario receptor
    const [recipients] = await db.query(
      `SELECT id FROM users WHERE email = ?`,
      [recipientEmail]
    );
    
    if (recipients.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const recipientId = recipients[0].id;

    // Verificar si ya está compartido
    const [existingShares] = await db.query(
      `SELECT id FROM archivos_compartidos 
       WHERE id_archivo = ? AND id_receptor = ?`,
      [fileId, recipientId]
    );
    
    if (existingShares.length > 0) {
      return res.status(409).json({ error: 'El archivo ya está compartido con este usuario' });
    }

    // Crear el registro de compartir
    await db.query(
      `INSERT INTO archivos_compartidos 
       (id_archivo, id_propietario, id_receptor, permisos) 
       VALUES (?, ?, ?, ?)`,
      [fileId, ownerId, recipientId, permission]
    );

    // Registrar en logs
    await db.query(
      `INSERT INTO logs_actividad 
       (id_usuario, id_archivo, accion, detalle) 
       VALUES (?, ?, ?, ?)`,
      [ownerId, fileId, 'compartir', `Compartido con usuario ${recipientId}`]
    );

    res.json({ message: 'Archivo compartido exitosamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al compartir archivo' });
  }
});

// Obtener archivos compartidos con el usuario actual
router.get('/shared-with-me', authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    const [sharedFiles] = await db.query(
      `SELECT a.id_archivo, a.nombre_original, a.tipo_archivo, a.tamanio, 
              a.fecha_subida, u.username as owner_name, ac.permisos
       FROM archivos_compartidos ac
       JOIN archivos a ON ac.id_archivo = a.id_archivo
       JOIN users u ON ac.id_propietario = u.id
       WHERE ac.id_receptor = ?`,
      [userId]
    );
    
    res.json(sharedFiles);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo archivos compartidos' });
  }
});

// Dejar de compartir un archivo (para el receptor)
router.delete('/stop-sharing/:fileId', authMiddleware, async (req, res) => {
  const { fileId } = req.params;
  const userId = req.user.id;

  try {
    // Verificar que el archivo está compartido con el usuario
    const [sharedFiles] = await db.query(
      `SELECT id FROM archivos_compartidos 
       WHERE id_archivo = ? AND id_receptor = ?`,
      [fileId, userId]
    );
    
    if (sharedFiles.length === 0) {
      return res.status(404).json({ error: 'Archivo compartido no encontrado' });
    }

    // Eliminar el registro de compartir
    await db.query(
      `DELETE FROM archivos_compartidos 
       WHERE id_archivo = ? AND id_receptor = ?`,
      [fileId, userId]
    );

    // Registrar en logs
    await db.query(
      `INSERT INTO logs_actividad 
       (id_usuario, id_archivo, accion, detalle) 
       VALUES (?, ?, ?, ?)`,
      [userId, fileId, 'dejar_compartir', 'Dejó de compartir archivo']
    );

    res.json({ message: 'Archivo dejado de compartir exitosamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al dejar de compartir archivo' });
  }
});

// Mover a la papelera un archivo compartido (para el receptor)
router.post('/move-to-trash/:fileId', authMiddleware, async (req, res) => {
  const { fileId } = req.params;
  const userId = req.user.id;

  try {
    // Verificar que el archivo está compartido con el usuario
    const [sharedFiles] = await db.query(
      `SELECT id FROM archivos_compartidos 
       WHERE id_archivo = ? AND id_receptor = ?`,
      [fileId, userId]
    );
    
    if (sharedFiles.length === 0) {
      return res.status(404).json({ 
        error: 'Archivo compartido no encontrado o no tienes permisos' 
      });
    }

    // Verificar si el archivo existe
    const [files] = await db.query(
      `SELECT id_archivo FROM archivos WHERE id_archivo = ?`,
      [fileId]
    );
    
    if (files.length === 0) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    // Crear registro en la papelera para el receptor
    await db.query(
      `INSERT INTO papelera 
       (id_usuario, id_archivo, fecha_eliminacion) 
       VALUES (?, ?, NOW()) 
       ON DUPLICATE KEY UPDATE fecha_eliminacion = NOW()`,
      [userId, fileId]
    );

    // Registrar en logs
    await db.query(
      `INSERT INTO logs_actividad 
       (id_usuario, id_archivo, accion, detalle) 
       VALUES (?, ?, ?, ?)`,
      [userId, fileId, 'mover_papelera', 'Movió archivo compartido a la papelera']
    );

    res.json({ 
      success: true,
      message: 'Archivo movido a la papelera exitosamente' 
    });
  } catch (err) {
    console.error('Error en /api/share/move-to-trash:', err);
    res.status(500).json({ 
      error: 'Error al mover archivo a la papelera',
      details: err.message 
    });
  }
});


router.get('/download/:fileId', authMiddleware, async (req, res) => {
  const { fileId } = req.params;
  const userId = req.user.id;

  console.log(`Iniciando descarga - Archivo: ${fileId}, Usuario: ${userId}`);

  try {
    // 1. Verificar que el archivo existe y está compartido con el usuario
    const [sharedFiles] = await db.query(
      `SELECT 
        a.id_archivo,
        a.nombre_original,
        a.nombre_guardado,
        a.tipo_archivo,
        a.tamanio,
        a.hash_sha256,
        ac.permisos,
        ac.id_propietario
      FROM archivos_compartidos ac
      JOIN archivos a ON ac.id_archivo = a.id_archivo
      WHERE ac.id_archivo = ? AND ac.id_receptor = ?`,
      [fileId, userId]
    );

    if (sharedFiles.length === 0) {
      console.error('Archivo no compartido con el usuario', { fileId, userId });
      return res.status(404).json({
        success: false,
        error: 'Archivo no encontrado o no tienes permisos',
        details: `El archivo ${fileId} no está compartido con tu usuario`
      });
    }

    const fileData = sharedFiles[0];

    // 2. Verificar permisos (lectura no permite descarga)
    if (fileData.permisos === 'lectura') {
      return res.status(403).json({
        success: false,
        error: 'Permisos insuficientes',
        details: 'Necesitas permisos de descarga o edición para este archivo'
      });
    }

    // 3. Construir ruta del archivo físico
    const uploadsDir = path.join(__dirname, '../uploads');
    const filePath = path.join(uploadsDir, fileData.nombre_guardado);

    console.log('Buscando archivo en:', filePath);

    // 4. Verificar existencia del archivo físico
    if (!fs.existsSync(filePath)) {
      console.error('Archivo físico no encontrado:', {
        ruta_esperada: filePath,
        nombre_guardado: fileData.nombre_guardado,
        id_archivo: fileData.id_archivo
      });
      return res.status(404).json({
        success: false,
        error: 'Archivo físico no encontrado',
        details: 'El archivo no existe en el servidor'
      });
    }

    // 5. Configurar headers de respuesta
    res.set({
      'Content-Type': fileData.tipo_archivo || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(fileData.nombre_original)}"`,
      'Content-Length': fileData.tamanio,
      'X-File-ID': fileData.id_archivo,
      'X-File-Hash': fileData.hash_sha256
    });

    // 6. Enviar el archivo
    const fileStream = fs.createReadStream(filePath);
    
    fileStream.on('error', (err) => {
      console.error('Error al leer el archivo:', err);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: 'Error al leer el archivo',
          details: err.message
        });
      }
    });

    fileStream.pipe(res);

    // Registrar la descarga en logs
    await db.query(
      `INSERT INTO logs_actividad 
       (id_usuario, id_archivo, accion, detalle) 
       VALUES (?, ?, ?, ?)`,
      [userId, fileId, 'descarga', `Descargó archivo compartido (propietario: ${fileData.id_propietario})`]
    );

  } catch (err) {
    console.error('Error en el servidor:', {
      error: err,
      stack: err.stack,
      fileId,
      userId
    });

    res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined,
      code: 'SERVER_ERROR'
    });
  }
});

// Restaurar archivo compartido desde la papelera
router.post('/restore-from-trash/:fileId', authMiddleware, async (req, res) => {
  const { fileId } = req.params;
  const userId = req.user.id;

  try {
    // 1. Verificar que el archivo está en la papelera compartida
    const [trashedFiles] = await db.query(
      `SELECT p.id_usuario, p.id_archivo 
       FROM papelera p
       JOIN archivos_compartidos ac ON p.id_archivo = ac.id_archivo
       WHERE p.id_archivo = ? AND p.id_usuario = ? AND ac.id_receptor = ?`,
      [fileId, userId, userId]
    );

    if (trashedFiles.length === 0) {
      return res.status(404).json({ 
        error: 'Archivo no encontrado en la papelera compartida' 
      });
    }

    // 2. Eliminar de la papelera
    await db.query(
      `DELETE FROM papelera 
       WHERE id_archivo = ? AND id_usuario = ?`,
      [fileId, userId]
    );

    // 3. Registrar en logs
    await db.query(
      `INSERT INTO logs_actividad 
       (id_usuario, id_archivo, accion, detalle) 
       VALUES (?, ?, ?, ?)`,
      [userId, fileId, 'restaurar', 'Restauró archivo compartido de la papelera']
    );

    res.json({ 
      success: true,
      message: 'Archivo compartido restaurado exitosamente' 
    });
  } catch (err) {
    console.error('Error al restaurar archivo compartido:', err);
    res.status(500).json({ 
      error: 'Error al restaurar archivo',
      details: err.message 
    });
  }
});

// Eliminar permanentemente archivo compartido
router.delete('/delete-permanent/:fileId', authMiddleware, async (req, res) => {
  const { fileId } = req.params;
  const userId = req.user.id;

  try {
    // 1. Verificar permisos (solo el receptor puede eliminar de su papelera)
    const [sharedFiles] = await db.query(
      `SELECT ac.id 
       FROM archivos_compartidos ac
       JOIN papelera p ON ac.id_archivo = p.id_archivo
       WHERE ac.id_archivo = ? AND p.id_usuario = ? AND ac.id_receptor = ?`,
      [fileId, userId, userId]
    );

    if (sharedFiles.length === 0) {
      return res.status(404).json({ 
        error: 'Archivo compartido no encontrado o sin permisos' 
      });
    }

    // 2. Eliminar de la papelera del usuario (no elimina el archivo físico)
    await db.query(
      `DELETE FROM papelera 
       WHERE id_archivo = ? AND id_usuario = ?`,
      [fileId, userId]
    );

    // 4. Registrar en logs
    await db.query(
      `INSERT INTO logs_actividad 
       (id_usuario, id_archivo, accion, detalle) 
       VALUES (?, ?, ?, ?)`,
      [userId, fileId, 'eliminar_permanentemente', 'Eliminó archivo compartido permanentemente']
    );

    res.json({ 
      success: true,
      message: 'Archivo compartido eliminado permanentemente de tu papelera' 
    });
  } catch (err) {
    console.error('Error al eliminar archivo compartido:', err);
    res.status(500).json({ 
      error: 'Error al eliminar archivo',
      details: err.message 
    });
  }
});

// Obtener archivos compartidos en la papelera
router.get('/shared-trash', authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    const [sharedTrash] = await db.query(
      `SELECT 
        a.id_archivo,
        a.nombre_original,
        a.tipo_archivo,
        a.tamanio,
        p.fecha_eliminacion,
        u.username as owner_name,
        ac.permisos,
        1 as es_compartido
       FROM papelera p
       JOIN archivos a ON p.id_archivo = a.id_archivo
       JOIN archivos_compartidos ac ON a.id_archivo = ac.id_archivo
       JOIN users u ON ac.id_propietario = u.id
       WHERE p.id_usuario = ? AND ac.id_receptor = ?`,
      [userId, userId]
    );

    res.json(sharedTrash);
  } catch (err) {
    console.error('Error obteniendo papelera compartida:', err);
    res.status(500).json({ 
      error: 'Error al obtener archivos compartidos en papelera' 
    });
  }
});

module.exports = router;