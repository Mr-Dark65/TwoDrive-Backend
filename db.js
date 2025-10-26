// db.js
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: 'StevenLoor24',
  database: 'two_drive',
});

module.exports = pool;
