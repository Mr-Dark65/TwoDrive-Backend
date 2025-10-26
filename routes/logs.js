const express = require('express');
const router = express.Router();
const db = require('../db');
const authMiddleware = require('../middlewares/authenticate');

// Obtener logs de actividad del usuario autenticado
router.get('/mis-logs', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const [logs] = await db.query(
      `SELECT l.id_log, l.accion, l.detalle, l.fecha, u.username, a.nombre_original as nombre_archivo
       FROM logs_actividad l
       JOIN users u ON u.id = l.id_usuario
       JOIN archivos a ON a.id_archivo = l.id_archivo
       WHERE l.id_usuario = ? 
       ORDER BY l.fecha DESC`, 
      [userId]
    );
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener los logs de actividad' });
  }
});

module.exports = router;