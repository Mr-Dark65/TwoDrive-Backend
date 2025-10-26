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

const authRoutes = require("./routes/auth");
app.use("/api/auth", authRoutes);

app.use('/', archivosRouter);
app.use('/api/share', shareRouter)
app.use('/api/users', userRoutes);
app.use('/api/logs', logsRoutes);

app.listen(3001, () => {
  console.log('Servidor corriendo en http://localhost:3001');
});
