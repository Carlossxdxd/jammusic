require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Servir archivos estáticos desde /public
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  next();
});

// Guardar el estado de cada sala en memoria
const salas = {};

io.on('connection', (socket) => {
  console.log('Usuario conectado:', socket.id);

  // Crear o unirse a una sala
  socket.on('unirse-sala', ({ codigo, nombre }) => {
    socket.join(codigo);
    socket.data.nombre = nombre;
    socket.data.sala = codigo;

    if (!salas[codigo]) {
      salas[codigo] = {
        cola: [],
        videoActual: null,
        timestamp: 0,
        reproduciendo: false
      };
    }

    // Enviar el estado actual al usuario que acaba de entrar
    socket.emit('estado-sala', salas[codigo]);

    // Avisar a todos en la sala que alguien entró
    io.to(codigo).emit('usuario-entro', { nombre });

    console.log(`${nombre} se unió a la sala ${codigo}`);
  });

  // Sincronizar play / pause / seek
  socket.on('sync-video', (data) => {
    const sala = socket.data.sala;
    if (!sala || !salas[sala]) return;

    salas[sala].videoActual    = data.videoId;
    salas[sala].timestamp      = data.timestamp;
    salas[sala].reproduciendo  = data.reproduciendo;

    // Reenviar a todos en la sala menos al que lo envió
    socket.to(sala).emit('sync-video', data);
  });

  // Agregar video a la cola
  socket.on('cola-agregar', (video) => {
    const sala = socket.data.sala;
    if (!sala || !salas[sala]) return;

    // Si mandan un array (al quitar un video), reemplazar la cola
    if (Array.isArray(video)) {
      salas[sala].cola = video;
    } else {
      salas[sala].cola.push(video);
    }

    io.to(sala).emit('cola-actualizada', salas[sala].cola);
  });

  // Mensaje de chat
  socket.on('chat-mensaje', (mensaje) => {
    const sala = socket.data.sala;
    if (!sala) return;

    io.to(sala).emit('chat-mensaje', {
      nombre: socket.data.nombre,
      texto: mensaje,
      hora: new Date().toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit' })
    });
  });

  // Usuario desconectado
  socket.on('disconnect', () => {
    const { nombre, sala } = socket.data;
    if (sala) {
      io.to(sala).emit('usuario-salio', { nombre });
    }
    console.log('Usuario desconectado:', socket.id);
  });
});

// Búsqueda de YouTube
app.get('/api/buscar', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Faltó el parámetro q' });

  const url = `https://www.googleapis.com/youtube/v3/search`
    + `?key=${process.env.YOUTUBE_API_KEY}`
    + `&type=video&part=snippet&maxResults=10`
    + `&q=${encodeURIComponent(q)}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    const videos = data.items.map(item => ({
      videoId:   item.id.videoId,
      titulo:    item.snippet.title,
      canal:     item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails.medium.url
    }));
    res.json(videos);
  } catch (error) {
    res.status(500).json({ error: 'Error al buscar en YouTube' });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`JamSync corriendo en http://localhost:${PORT}`);
});