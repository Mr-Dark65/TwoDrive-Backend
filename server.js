// server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const archivosRouter = require('./routes/archivos');
const shareRouter = require('./routes/share')
const userRoutes = require('./routes/user')
const logsRoutes = require('./routes/logs')
require("dotenv").config();


const app = express();
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Healthcheck simple para pruebas y monitoreo
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const authRoutes = require("./routes/auth");
app.use("/api/auth", authRoutes);

app.use('/', archivosRouter);
app.use('/api/share', shareRouter)
app.use('/api/users', userRoutes);
app.use('/api/logs', logsRoutes);

// Exporta la app para pruebas y arranca el servidor solo si es el proceso principal
const PORT = process.env.PORT || 3001;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
  });
}

module.exports = app;
