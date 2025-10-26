const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const db = require("../db");
const otplib = require("otplib");
const nodemailer = require("nodemailer");
const router = express.Router();
require("dotenv").config();

const JWT_SECRET = process.env.JWT_SECRET || "supersecreto";
const authMiddleware = require("../middlewares/authenticate");

// Configuración de Nodemailer (para email)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Generar código de 6 dígitos
const generateCode = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

// Enviar código por email
const sendEmailCode = async (email, code) => {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: "Tu código de verificación TwoDrive",
    text: `Tu código de verificación para TwoDrive es: ${code}\n\nEl código expirará en 15 minutos.`,
    html: `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body {
          font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
        }
        .header {
          text-align: center;
          padding: 20px 0;
          border-bottom: 1px solid #eaeaea;
        }
        .logo {
          max-width: 150px;
        }
        .content {
          padding: 20px 0;
        }
        .code-container {
          background: #f5f7fa;
          padding: 15px;
          border-radius: 8px;
          text-align: center;
          margin: 25px 0;
          font-size: 24px;
          font-weight: bold;
          color: #2c3e50;
          letter-spacing: 2px;
        }
        .footer {
          margin-top: 30px;
          padding-top: 20px;
          border-top: 1px solid #eaeaea;
          font-size: 12px;
          color: #7f8c8d;
          text-align: center;
        }
        .button {
          display: inline-block;
          padding: 12px 24px;
          background-color: #3498db;
          color: white;
          text-decoration: none;
          border-radius: 5px;
          font-weight: bold;
          margin-top: 15px;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <img src="https://example.com/logo.png" alt="TwoDrive Logo" class="logo">
        <h2>Verificación de tu cuenta</h2>
      </div>
      
      <div class="content">
        <p>Hola,</p>
        <p>Hemos recibido una solicitud para verificar tu cuenta en TwoDrive. Utiliza el siguiente código de verificación:</p>
        
        <div class="code-container">
          ${code}
        </div>
        
        <p>Este código expirará en <strong>15 minutos</strong>. Si no has solicitado este código, puedes ignorar este mensaje.</p>
        
        <p>Gracias,<br>El equipo de TwoDrive</p>
      </div>
      
      <div class="footer">
        <p>© ${new Date().getFullYear()} TwoDrive. Todos los derechos reservados.</p>
        <p>Si tienes alguna pregunta, contáctanos en soporte@twodrive.com</p>
      </div>
    </body>
    </html>
    `,
  };

  await transporter.sendMail(mailOptions);
};

// Ruta para registrar nuevo usuario
router.post("/register", async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: "Todos los campos son obligatorios" });
  }

  try {
    // Verificar si el usuario ya existe
    const [existing] = await db.query("SELECT id FROM users WHERE email = ?", [
      email,
    ]);
    if (existing.length > 0) {
      return res.status(409).json({ error: "El correo ya está registrado" });
    }

    // Hashear la contraseña
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insertar nuevo usuario
    const [result] = await db.query(
      `INSERT INTO users (username, email, password_hash, is_2fa_enabled) 
       VALUES (?, ?, ?, 0)`,
      [username, email, hashedPassword]
    );

    res
      .status(201)
      .json({
        message: "Usuario registrado con éxito",
        userId: result.insertId,
      });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al registrar usuario" });
  }
});

// Modifica la ruta de login para incluir 2FA
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const [rows] = await db.query("SELECT * FROM users WHERE email = ?", [
      email,
    ]);
    if (rows.length === 0)
      return res.status(401).json({ error: "Usuario no encontrado" });

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: "Contraseña incorrecta" });

    // Si tiene 2FA habilitado
    if (user.is_2fa_enabled) {
      const verificationCode = generateCode();
      const expiresAt = new Date(Date.now() + 10 * 60000);

      await db.query(
        "INSERT INTO verification_codes (user_id, code, expires_at, method) VALUES (?, ?, ?, ?)",
        [user.id, verificationCode, expiresAt, user.two_factor_method]
      );

      await sendEmailCode(user.email, verificationCode);

      const tempToken = jwt.sign({ id: user.id, needs2FA: true }, JWT_SECRET, {
        expiresIn: "15m",
      });

      return res.json({
        tempToken,
        message: "Código de verificación enviado",
        method: user.two_factor_method,
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        email: user.email,
        rol: user.rol,
      },
      JWT_SECRET,
      { expiresIn: "2h" }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        is_2fa_enabled: user.is_2fa_enabled,
        rol: user.rol,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al iniciar sesión" });
  }
});

// En tu backend (routes/auth.js)
router.get("/profile", authMiddleware, async (req, res) => {
  try {
    const [userRows] = await db.query("SELECT * FROM users WHERE id = ?", [
      req.user.id,
    ]);
    const user = userRows[0];

    // Calcular almacenamiento usado
    const [storageRows] = await db.query(
      "SELECT SUM(tamanio) as total FROM archivos WHERE id_usuario = ?",
      [req.user.id]
    );

    res.json({
      username: user.username,
      email: user.email,
      is_2fa_enabled: user.is_2fa_enabled,
      storage_used: storageRows[0].total || 0,
      storage_limit: 1073741824,
      created_at: user.created_at,
      rol: user.rol,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener perfil" });
  }
});

router.post("/enable-2fa", authMiddleware, async (req, res) => {
  const { method } = req.body;
  const userId = req.user.id;

  try {
    const code = generateCode();
    const expiresAt = new Date(Date.now() + 10 * 60000);

    await db.query(
      "INSERT INTO verification_codes (user_id, code, expires_at, method) VALUES (?, ?, ?, ?)",
      [userId, code, expiresAt, method]
    );

    const [userRows] = await db.query("SELECT * FROM users WHERE id = ?", [
      userId,
    ]);
    const user = userRows[0];

    if (method === "email") {
      await sendEmailCode(user.email, code);
    }

    const tempToken = jwt.sign({ id: user.id, needs2FA: true }, JWT_SECRET, {
      expiresIn: "15m",
    });

    res.json({
      message: "Código enviado",
      tempToken,
      method,
    });
  } catch (err) {
    console.error("Error en /enable-2fa:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Ruta para verificar el código 2FA
router.post("/verify-2fa", async (req, res) => {
  const { code, tempToken } = req.body;

  try {
    const decoded = jwt.verify(tempToken, JWT_SECRET);
    if (!decoded.needs2FA) {
      return res.status(400).json({ error: "Token inválido" });
    }

    await db.query(
      "UPDATE verification_codes SET used = 1 WHERE user_id = ? AND expires_at <= NOW()",
      [decoded.id]
    );

    // Verificar código en base de datos (convertir a string para asegurar comparación)
    const [rows] = await db.query(
      `SELECT * FROM verification_codes 
       WHERE user_id = ? AND code = ? AND expires_at > NOW() AND used = 0`,
      [decoded.id, code.toString()]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: "Código inválido o expirado" });
    }

    await db.query("UPDATE verification_codes SET used = 1 WHERE id = ?", [
      rows[0].id,
    ]);

    const [userRows] = await db.query("SELECT * FROM users WHERE id = ?", [
      decoded.id,
    ]);
    const user = userRows[0];

    // Generar token final
    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        email: user.email,
        rol: user.rol,
      },
      JWT_SECRET,
      { expiresIn: "2h" }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        is_2fa_enabled: user.is_2fa_enabled,
        rol: user.rol,
      },
    });
  } catch (err) {
    console.error("Error en verify-2fa:", err);
    if (err.name === "JsonWebTokenError") {
      return res.status(400).json({ error: "Token inválido" });
    }
    res.status(500).json({ error: "Error al verificar código" });
  }
});

// Ruta para configurar el método 2FA (solo email)
router.post("/setup-2fa", authMiddleware, async (req, res) => {
  const { method } = req.body;
  const userId = req.user.id;

  try {
    if (method !== "email") {
      return res.status(400).json({ error: "Método no soportado" });
    }

    await db.query(
      "UPDATE users SET is_2fa_enabled = 1, two_factor_method = ? WHERE id = ?",
      [method, userId]
    );

    res.json({ message: `2FA configurado para ${method}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al configurar 2FA" });
  }
});

// Solicitar restablecimiento de contraseña
router.post("/forgot-password", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Correo requerido" });

  try {
    const [users] = await db.query("SELECT * FROM users WHERE email = ?", [
      email,
    ]);
    if (users.length === 0) {
      return res.status(404).json({ error: "Correo no registrado" });
    }

    const user = users[0];

    // Generar token temporal de 30 minutos
    const resetToken = jwt.sign({ id: user.id }, JWT_SECRET, {
      expiresIn: "30m",
    });

    const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Restablecimiento de contraseña - TwoDrive",
      html: `<p>Haz clic en el siguiente enlace para restablecer tu contraseña:</p>
             <a href="${resetLink}">${resetLink}</a>
             <p>Este enlace expirará en 30 minutos.</p>`,
    };

    await transporter.sendMail(mailOptions);

    res.json({
      message: "Enlace para restablecer contraseña enviado al correo",
    });
  } catch (err) {
    console.error("Error en /forgot-password:", err);
    res
      .status(500)
      .json({ error: "Error al enviar el correo de recuperación" });
  }
});

// Restablecer contraseña con token
router.post("/reset-password", async (req, res) => {
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    return res
      .status(400)
      .json({ error: "Token y nueva contraseña requeridos" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await db.query("UPDATE users SET password_hash = ? WHERE id = ?", [
      hashedPassword,
      decoded.id,
    ]);

    res.json({ message: "Contraseña restablecida correctamente" });
  } catch (err) {
    console.error("Error en /reset-password:", err);
    res.status(400).json({ error: "Token inválido o expirado" });
  }
});

module.exports = router;
