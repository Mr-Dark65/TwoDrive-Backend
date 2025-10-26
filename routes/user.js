const express = require('express');
const router = express.Router();
const db = require('../db'); // Ajusta según tu conexión
const authMiddleware = require('../middlewares/authenticate');

// Middleware para verificar si el usuario es admin
function isAdmin(req, res, next) {
  if (req.user && req.user.rol === 'admin') {
    next();
  } else {
    return res.status(403).json({ error: 'Acceso denegado: solo administradores' });
  }
}

// Obtener todos los usuarios (solo admin)
router.get('/', authMiddleware, isAdmin, async (req, res) => {
  try {
    const [users] = await db.query(
      'SELECT id, username, email, rol, is_2fa_enabled, created_at FROM users'
    );
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
});

module.exports = router;