const express = require('express');
const path = require('path');
const app = express();
const port = 3000;

// Раздаем только статические файлы проекта
app.use(express.static(path.join(__dirname, './')));

app.listen(port, () => {
  console.log(`🚀 P2P Messenger запущен: http://localhost:${port}`);
  console.log(`📱 Откройте этот адрес в двух вкладках`);
});