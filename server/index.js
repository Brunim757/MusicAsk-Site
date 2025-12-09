const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PATCH", "DELETE"]
  }
});

app.use(cors());
app.use(express.json());

const DATA_FILE = path.join(__dirname, 'data.json');

// Spotify API Configuration
let spotifyToken = null;
let tokenExpiry = null;

async function getSpotifyToken() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.warn('Spotify credentials not configured. Using mock data.');
    return null;
  }

  if (spotifyToken && tokenExpiry && Date.now() < tokenExpiry) {
    return spotifyToken;
  }

  try {
    const response = await axios.post('https://accounts.spotify.com/api/token', 
      'grant_type=client_credentials', {
      headers: {
        'Authorization': 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    spotifyToken = response.data.access_token;
    tokenExpiry = Date.now() + (response.data.expires_in * 1000);
    return spotifyToken;
  } catch (error) {
    console.error('Error getting Spotify token:', error.message);
    return null;
  }
}

async function searchSpotifyTracks(query) {
  const token = await getSpotifyToken();
  
  if (!token) {
    // Retorna dados mock se não houver token
    return [
      { name: query, artist: 'Artista 1', image: null, uri: null },
      { name: query + ' (Remix)', artist: 'Artista 2', image: null, uri: null },
      { name: 'Outra ' + query, artist: 'Artista 3', image: null, uri: null }
    ];
  }

  try {
    const response = await axios.get('https://api.spotify.com/v1/search', {
      params: {
        q: query,
        type: 'track',
        limit: 10
      },
      headers: {
        'Authorization': 'Bearer ' + token
      }
    });

    return response.data.tracks.items.map(track => ({
      name: track.name,
      artist: track.artists.map(a => a.name).join(', '),
      image: track.album.images[0]?.url || null,
      uri: track.uri
    }));
  } catch (error) {
    console.error('Error searching Spotify:', error.message);
    return [];
  }
}

let data = {
  events: [],
  requests: []
};

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const rawData = fs.readFileSync(DATA_FILE, 'utf8');
      data = JSON.parse(rawData);
    }
  } catch (error) {
    console.log('No existing data file, starting fresh');
  }
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error saving data:', error);
  }
}

loadData();

function sendResponse(res, success, message, responseData = null) {
  res.json({ success, message, data: responseData });
}

app.post('/api/events', (req, res) => {
  const { name, code } = req.body;

  const existingActive = data.events.find(e => e.active);
  if (existingActive) {
    return sendResponse(res, false, 'Já existe um evento ativo');
  }

  const event = {
    id: uuidv4(),
    name: name || `Evento ${code}`,
    code: code || String(Math.floor(1000 + Math.random() * 9000)),
    active: true,
    createdAt: Date.now(),
    endedAt: null,
    acceptedStyles: [],
    totalRequests: 0
  };

  data.events.push(event);
  saveData();

  io.emit('event_created', event);
  sendResponse(res, true, 'Evento criado com sucesso', event);
});

app.get('/api/events/active', (req, res) => {
  const activeEvent = data.events.find(e => e.active);
  if (activeEvent) {
    activeEvent.totalRequests = data.requests.filter(r => r.eventId === activeEvent.id).length;
    sendResponse(res, true, 'Evento ativo encontrado', activeEvent);
  } else {
    sendResponse(res, false, 'Nenhum evento ativo');
  }
});

app.get('/api/events', (req, res) => {
  const eventsWithCounts = data.events.map(event => ({
    ...event,
    totalRequests: data.requests.filter(r => r.eventId === event.id).length
  })).sort((a, b) => b.createdAt - a.createdAt);

  sendResponse(res, true, 'Eventos carregados', eventsWithCounts);
});

app.get('/api/events/:eventId', (req, res) => {
  const event = data.events.find(e => e.id === req.params.eventId);
  if (event) {
    event.totalRequests = data.requests.filter(r => r.eventId === event.id).length;
    sendResponse(res, true, 'Evento encontrado', event);
  } else {
    sendResponse(res, false, 'Evento não encontrado');
  }
});

app.patch('/api/events/:eventId', (req, res) => {
  const event = data.events.find(e => e.id === req.params.eventId);
  if (!event) {
    return sendResponse(res, false, 'Evento não encontrado');
  }

  const { name, acceptedStyles, active } = req.body;
  if (name !== undefined) event.name = name;
  if (acceptedStyles !== undefined) event.acceptedStyles = acceptedStyles;
  if (active !== undefined) event.active = active;

  saveData();
  io.emit('event_updated', event);
  sendResponse(res, true, 'Evento atualizado', event);
});

app.post('/api/events/:eventId/end', (req, res) => {
  const event = data.events.find(e => e.id === req.params.eventId);
  if (!event) {
    return sendResponse(res, false, 'Evento não encontrado');
  }

  event.active = false;
  event.endedAt = Date.now();
  saveData();

  io.emit('event_ended', event);
  sendResponse(res, true, 'Evento encerrado', event);
});

app.get('/api/events/:eventId/requests', (req, res) => {
  const { status } = req.query;
  let eventRequests = data.requests.filter(r => r.eventId === req.params.eventId);

  if (status) {
    if (status === 'later') {
      eventRequests = eventRequests.filter(r =>
        r.status === 'later_5_15' || r.status === 'later_15_30' || r.status === 'later_30_plus'
      );
    } else {
      eventRequests = eventRequests.filter(r => r.status === status);
    }
  }

  eventRequests.sort((a, b) => b.requestedAt - a.requestedAt);
  sendResponse(res, true, 'Pedidos carregados', eventRequests);
});

app.get('/api/events/:eventId/stats', (req, res) => {
  const eventRequests = data.requests.filter(r => r.eventId === req.params.eventId);

  const stats = {
    totalRequests: eventRequests.length,
    acceptedRequests: eventRequests.filter(r => r.status === 'accepted').length,
    rejectedRequests: eventRequests.filter(r => r.status === 'rejected').length,
    laterRequests: eventRequests.filter(r =>
      r.status === 'later_5_15' || r.status === 'later_15_30' || r.status === 'later_30_plus'
    ).length,
    topTracks: []
  };

  const trackCounts = {};
  eventRequests.forEach(r => {
    const key = `${r.trackName}|||${r.artistName}`;
    if (!trackCounts[key]) {
      trackCounts[key] = { trackName: r.trackName, artistName: r.artistName, count: 0 };
    }
    trackCounts[key].count++;
  });

  stats.topTracks = Object.values(trackCounts)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  sendResponse(res, true, 'Estatísticas carregadas', stats);
});

app.post('/api/events/validate', (req, res) => {
  const { code } = req.body;
  const event = data.events.find(e => e.code === code && e.active);

  if (event) {
    sendResponse(res, true, 'Código válido', { eventId: event.id, eventName: event.name });
  } else {
    sendResponse(res, false, 'Código inválido ou evento encerrado');
  }
});

app.post('/api/requests', (req, res) => {
  const { eventId, trackName, artistName, albumImage, spotifyUri, requesterName } = req.body;

  const event = data.events.find(e => e.id === eventId && e.active);
  if (!event) {
    return sendResponse(res, false, 'Evento não encontrado ou encerrado');
  }

  const request = {
    id: uuidv4(),
    eventId,
    trackName,
    artistName,
    albumImage: albumImage || null,
    spotifyUri: spotifyUri || null,
    requesterName: requesterName || 'Anônimo',
    status: 'pending',
    requestedAt: Date.now(),
    respondedAt: null
  };

  data.requests.push(request);
  saveData();

  io.emit('new_request', request);
  sendResponse(res, true, 'Pedido enviado com sucesso', request);
});

app.get('/api/requests/:requestId', (req, res) => {
  const request = data.requests.find(r => r.id === req.params.requestId);
  if (request) {
    sendResponse(res, true, 'Pedido encontrado', request);
  } else {
    sendResponse(res, false, 'Pedido não encontrado');
  }
});

app.patch('/api/requests/:requestId', (req, res) => {
  const request = data.requests.find(r => r.id === req.params.requestId);
  if (!request) {
    return sendResponse(res, false, 'Pedido não encontrado');
  }

  const { status } = req.body;
  if (status) {
    request.status = status;
    request.respondedAt = Date.now();
  }

  saveData();
  io.emit('request_updated', request);
  sendResponse(res, true, 'Status atualizado', request);
});

app.get('/api/stats/top-tracks', (req, res) => {
  const trackCounts = {};
  data.requests.forEach(r => {
    const key = `${r.trackName}|||${r.artistName}`;
    if (!trackCounts[key]) {
      trackCounts[key] = { trackName: r.trackName, artistName: r.artistName, count: 0 };
    }
    trackCounts[key].count++;
  });

  const topTracks = Object.values(trackCounts)
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  sendResponse(res, true, 'Top tracks carregados', topTracks);
});

app.get('/api/search/tracks', async (req, res) => {
  const { q } = req.query;
  
  if (!q || q.trim().length < 2) {
    return sendResponse(res, false, 'Query muito curta', []);
  }

  try {
    const tracks = await searchSpotifyTracks(q);
    sendResponse(res, true, 'Músicas encontradas', tracks);
  } catch (error) {
    console.error('Search error:', error);
    sendResponse(res, false, 'Erro ao buscar músicas', []);
  }
});

app.use(express.static(path.join(__dirname, '../client/dist')));

app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, '../client/dist/index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>MusicAsk</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
          
          * { 
            margin: 0; 
            padding: 0; 
            box-sizing: border-box; 
          }
          
          body { 
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            background: linear-gradient(135deg, #0a0e27 0%, #1a1a2e 50%, #16213e 100%);
            color: #fff; 
            min-height: 100vh; 
            display: flex; 
            flex-direction: column; 
            align-items: center; 
            justify-content: center; 
            padding: 20px;
            position: relative;
            overflow-x: hidden;
          }
          
          body::before {
            content: '';
            position: fixed;
            top: -50%;
            left: -50%;
            width: 200%;
            height: 200%;
            background: radial-gradient(circle, rgba(108, 99, 255, 0.1) 0%, transparent 70%);
            animation: pulse 15s ease-in-out infinite;
            pointer-events: none;
          }
          
          @keyframes pulse {
            0%, 100% { transform: scale(1); opacity: 0.5; }
            50% { transform: scale(1.1); opacity: 0.8; }
          }
          
          @keyframes fadeInUp {
            from {
              opacity: 0;
              transform: translateY(30px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          
          @keyframes slideIn {
            from {
              opacity: 0;
              transform: translateX(-20px);
            }
            to {
              opacity: 1;
              transform: translateX(0);
            }
          }
          
          .container { 
            max-width: 480px; 
            width: 100%; 
            text-align: center;
            position: relative;
            z-index: 1;
            animation: fadeInUp 0.8s ease-out;
          }
          
          .logo {
            width: 80px;
            height: 80px;
            margin: 0 auto 1.5rem;
            background: linear-gradient(135deg, #6C63FF 0%, #5A52D9 100%);
            border-radius: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 2.5rem;
            box-shadow: 0 20px 60px rgba(108, 99, 255, 0.4);
            animation: fadeInUp 0.8s ease-out 0.2s both;
          }
          
          h1 { 
            background: linear-gradient(135deg, #6C63FF 0%, #9D8CFF 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            font-size: 2.8rem; 
            font-weight: 800;
            margin-bottom: 0.5rem;
            letter-spacing: -0.5px;
            animation: fadeInUp 0.8s ease-out 0.3s both;
          }
          
          p { 
            color: rgba(255, 255, 255, 0.6); 
            margin-bottom: 2.5rem;
            font-size: 1rem;
            font-weight: 400;
            animation: fadeInUp 0.8s ease-out 0.4s both;
          }
          
          .form-group { 
            margin-bottom: 1.5rem;
            position: relative;
            animation: fadeInUp 0.8s ease-out 0.5s both;
          }
          
          input { 
            width: 100%; 
            padding: 18px 20px; 
            font-size: 16px; 
            border: 2px solid rgba(255, 255, 255, 0.1); 
            border-radius: 16px; 
            background: rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(10px);
            color: #fff; 
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            font-family: 'Inter', sans-serif;
          }
          
          input.code-input {
            font-size: 28px;
            text-align: center;
            letter-spacing: 12px;
            font-weight: 600;
          }
          
          input:focus { 
            outline: none; 
            border-color: #6C63FF;
            background: rgba(108, 99, 255, 0.1);
            box-shadow: 0 0 0 4px rgba(108, 99, 255, 0.1);
            transform: translateY(-2px);
          }
          
          input::placeholder {
            color: rgba(255, 255, 255, 0.3);
          }
          
          button { 
            width: 100%; 
            padding: 18px; 
            font-size: 16px; 
            font-weight: 600;
            background: linear-gradient(135deg, #6C63FF 0%, #5A52D9 100%);
            color: #fff; 
            border: none; 
            border-radius: 16px; 
            cursor: pointer; 
            margin-top: 1rem;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: 0 10px 30px rgba(108, 99, 255, 0.3);
            position: relative;
            overflow: hidden;
          }
          
          button::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
            transition: left 0.5s;
          }
          
          button:hover::before {
            left: 100%;
          }
          
          button:hover { 
            transform: translateY(-2px);
            box-shadow: 0 15px 40px rgba(108, 99, 255, 0.4);
          }
          
          button:active {
            transform: translateY(0);
          }
          
          .error { 
            color: #FF6B6B; 
            margin-top: 1rem; 
            display: none;
            padding: 12px;
            background: rgba(255, 107, 107, 0.1);
            border-radius: 12px;
            font-size: 14px;
            animation: slideIn 0.3s ease-out;
          }
          
          #requestForm { 
            display: none; 
          }
          
          .search-input { 
            letter-spacing: normal; 
            text-align: left; 
          }
          
          .track-list { 
            margin-top: 1.5rem; 
            text-align: left;
            max-height: 400px;
            overflow-y: auto;
            padding-right: 8px;
          }
          
          .track-list::-webkit-scrollbar {
            width: 6px;
          }
          
          .track-list::-webkit-scrollbar-track {
            background: rgba(255, 255, 255, 0.05);
            border-radius: 10px;
          }
          
          .track-list::-webkit-scrollbar-thumb {
            background: rgba(108, 99, 255, 0.5);
            border-radius: 10px;
          }
          
          .track-item { 
            background: rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(10px);
            padding: 16px; 
            border-radius: 14px; 
            margin-bottom: 10px; 
            cursor: pointer; 
            border: 2px solid transparent;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            animation: slideIn 0.4s ease-out backwards;
          }
          
          .track-item:nth-child(1) { animation-delay: 0.1s; }
          .track-item:nth-child(2) { animation-delay: 0.2s; }
          .track-item:nth-child(3) { animation-delay: 0.3s; }
          
          .track-item:hover { 
            border-color: #6C63FF;
            background: rgba(108, 99, 255, 0.1);
            transform: translateX(8px);
            box-shadow: 0 8px 24px rgba(108, 99, 255, 0.2);
          }
          
          .track-name { 
            font-weight: 600;
            font-size: 15px;
            margin-bottom: 4px;
            color: #fff;
          }
          
          .artist-name { 
            color: rgba(255, 255, 255, 0.5); 
            font-size: 13px;
            font-weight: 400;
          }
          
          .name-input { 
            letter-spacing: normal; 
            text-align: left; 
          }
          
          .status { 
            padding: 20px; 
            background: rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(10px);
            border-radius: 16px; 
            margin-top: 1rem;
            border-left: 4px solid;
            transition: all 0.3s ease;
            animation: slideIn 0.4s ease-out;
          }
          
          .status:hover {
            transform: translateX(4px);
          }
          
          .status.pending { 
            border-left-color: #FFA726;
            background: rgba(255, 167, 38, 0.1);
          }
          
          .status.accepted { 
            border-left-color: #66BB6A;
            background: rgba(102, 187, 106, 0.1);
          }
          
          .status.rejected { 
            border-left-color: #EF5350;
            background: rgba(239, 83, 80, 0.1);
          }
          
          .status.later { 
            border-left-color: #42A5F5;
            background: rgba(66, 165, 245, 0.1);
          }
          
          #myRequests { 
            margin-top: 2.5rem; 
            text-align: left; 
          }
          
          #myRequests h3 {
            font-size: 1.2rem;
            font-weight: 700;
            margin-bottom: 1rem;
            color: rgba(255, 255, 255, 0.9);
          }
          
          .back-btn { 
            background: transparent; 
            border: 2px solid rgba(108, 99, 255, 0.5); 
            color: #6C63FF; 
            margin-top: 1rem;
            box-shadow: none;
          }
          
          .back-btn:hover {
            background: rgba(108, 99, 255, 0.1);
            border-color: #6C63FF;
          }
          
          #selectedTrack {
            margin-top: 1.5rem;
          }
          
          #selectedTrack .track-item {
            border-color: #6C63FF;
            background: rgba(108, 99, 255, 0.15);
            animation: none;
          }
          
          .status-badge {
            display: inline-block;
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            margin-top: 8px;
          }
          
          .status-badge.pending { background: rgba(255, 167, 38, 0.2); color: #FFA726; }
          .status-badge.accepted { background: rgba(102, 187, 106, 0.2); color: #66BB6A; }
          .status-badge.rejected { background: rgba(239, 83, 80, 0.2); color: #EF5350; }
          .status-badge.later { background: rgba(66, 165, 245, 0.2); color: #42A5F5; }
          
          @media (max-width: 480px) {
            h1 { font-size: 2.2rem; }
            .container { padding: 0 10px; }
            input.code-input { font-size: 24px; letter-spacing: 8px; }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div id="codeForm">
            <div class="logo">🎵</div>
            <h1>MusicAsk</h1>
            <p>Digite o código do evento para fazer seu pedido</p>
            <div class="form-group">
              <input type="text" id="eventCode" class="code-input" maxlength="4" placeholder="0000" pattern="[0-9]*" inputmode="numeric">
            </div>
            <button onclick="validateCode()">Entrar</button>
            <p class="error" id="codeError">Código inválido ou evento encerrado</p>
          </div>
          <div id="requestForm">
            <div class="logo">🎵</div>
            <h1>Pedir Música</h1>
            <p id="eventName">Evento</p>
            <div class="form-group">
              <input type="text" id="searchInput" class="search-input" placeholder="Buscar música...">
            </div>
            <div class="form-group">
              <input type="text" id="requesterName" class="name-input" placeholder="Seu nome (opcional)">
            </div>
            <div id="trackList" class="track-list"></div>
            <div id="selectedTrack" style="display:none;">
              <div class="track-item" style="border-color: #6C63FF;">
                <div class="track-name" id="selectedTrackName"></div>
                <div class="artist-name" id="selectedArtistName"></div>
              </div>
              <button onclick="submitRequest()">Enviar Pedido</button>
            </div>
            <p class="error" id="requestError"></p>
            <div id="myRequests"></div>
            <button class="back-btn" onclick="goBack()">Voltar</button>
          </div>
        </div>
        <script src="/socket.io/socket.io.js"></script>
        <script>
          let currentEventId = null;
          let selectedTrack = null;
          let myRequests = JSON.parse(localStorage.getItem('myRequests') || '[]');
          let socket = null;
          try {
            socket = typeof io !== 'undefined' ? io() : null;
            if (socket) {
              socket.on('request_updated', (request) => {
                updateMyRequestStatus(request);
              });
            }
          } catch(e) { console.log('Socket not available'); }
          function validateCode() {
            const code = document.getElementById('eventCode').value;
            fetch('/api/events/validate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ code })
            })
            .then(res => res.json())
            .then(data => {
              if (data.success) {
                currentEventId = data.data.eventId;
                document.getElementById('eventName').textContent = data.data.eventName;
                document.getElementById('codeForm').style.display = 'none';
                document.getElementById('requestForm').style.display = 'block';
                renderMyRequests();
              } else {
                document.getElementById('codeError').style.display = 'block';
              }
            });
          }
          document.getElementById('eventCode').addEventListener('input', function() {
            document.getElementById('codeError').style.display = 'none';
          });
          document.getElementById('eventCode').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') validateCode();
          });
          let searchTimeout;
          let searchResults = [];
          
          document.getElementById('searchInput').addEventListener('input', function() {
            clearTimeout(searchTimeout);
            const query = this.value.trim();
            if (query.length < 2) {
              document.getElementById('trackList').innerHTML = '';
              searchResults = [];
              return;
            }
            searchTimeout = setTimeout(() => searchTracks(query), 500);
          });
          
          async function searchTracks(query) {
            try {
              const response = await fetch('/api/search/tracks?q=' + encodeURIComponent(query));
              const data = await response.json();
              if (data.success) {
                searchResults = data.data;
                renderTracks(searchResults);
              }
            } catch (error) {
              console.error('Error searching tracks:', error);
            }
          }
          
          function renderTracks(tracks) {
            const list = document.getElementById('trackList');
            if (tracks.length === 0) {
              list.innerHTML = '<div style="text-align: center; padding: 20px; color: rgba(255,255,255,0.5);">Nenhuma música encontrada</div>';
              return;
            }
            list.innerHTML = tracks.map((t, i) => {
              const imageHtml = t.image ? 
                '<img src="' + t.image + '" style="width: 48px; height: 48px; border-radius: 8px; margin-right: 12px; object-fit: cover;">' : 
                '<div style="width: 48px; height: 48px; border-radius: 8px; margin-right: 12px; background: rgba(108,99,255,0.2); display: flex; align-items: center; justify-content: center; font-size: 20px;">🎵</div>';
              return '<div class="track-item" onclick="selectTrack(' + i + ')" style="display: flex; align-items: center;">' +
                imageHtml +
                '<div style="flex: 1; min-width: 0;">' +
                '<div class="track-name" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">' + t.name + '</div>' +
                '<div class="artist-name" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">' + t.artist + '</div>' +
                '</div>' +
              '</div>';
            }).join('');
          }
          
          function selectTrack(index) {
            const track = searchResults[index];
            selectedTrack = {
              name: track.name,
              artist: track.artist,
              image: track.image,
              uri: track.uri
            };
            
            const imageHtml = track.image ? 
              '<img src="' + track.image + '" style="width: 64px; height: 64px; border-radius: 12px; margin-bottom: 12px; object-fit: cover;">' : 
              '';
              
            document.getElementById('selectedTrack').innerHTML = 
              '<div class="track-item" style="border-color: #6C63FF; text-align: center;">' +
                imageHtml +
                '<div class="track-name" id="selectedTrackName">' + track.name + '</div>' +
                '<div class="artist-name" id="selectedArtistName">' + track.artist + '</div>' +
              '</div>' +
              '<button onclick="submitRequest()">Enviar Pedido</button>';
              
            document.getElementById('trackList').style.display = 'none';
            document.getElementById('selectedTrack').style.display = 'block';
          }
          function submitRequest() {
            if (!selectedTrack) return;
            const requesterName = document.getElementById('requesterName').value.trim() || 'Anônimo';
            fetch('/api/requests', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                eventId: currentEventId,
                trackName: selectedTrack.name,
                artistName: selectedTrack.artist,
                albumImage: selectedTrack.image,
                spotifyUri: selectedTrack.uri,
                requesterName
              })
            })
            .then(res => res.json())
            .then(data => {
              if (data.success) {
                myRequests.push(data.data);
                localStorage.setItem('myRequests', JSON.stringify(myRequests));
                renderMyRequests();
                document.getElementById('searchInput').value = '';
                document.getElementById('trackList').innerHTML = '';
                document.getElementById('trackList').style.display = 'block';
                document.getElementById('selectedTrack').style.display = 'none';
                selectedTrack = null;
                searchResults = [];
                alert('✓ Pedido enviado com sucesso!');
              } else {
                document.getElementById('requestError').textContent = data.message;
                document.getElementById('requestError').style.display = 'block';
              }
            });
          }
          function renderMyRequests() {
            const eventRequests = myRequests.filter(r => r.eventId === currentEventId);
            if (eventRequests.length === 0) {
              document.getElementById('myRequests').innerHTML = '';
              return;
            }
            document.getElementById('myRequests').innerHTML = '<h3>Seus pedidos</h3>' +
              eventRequests.map(r => {
                let statusClass = 'pending';
                let statusText = 'Aguardando...';
                let icon = '⏳';
                if (r.status === 'accepted') { statusClass = 'accepted'; statusText = 'Programada para tocar'; icon = '✓'; }
                else if (r.status === 'rejected') { statusClass = 'rejected'; statusText = 'Não disponível'; icon = '✗'; }
                else if (r.status.startsWith('later')) { statusClass = 'later'; statusText = 'Agendada para mais tarde'; icon = '⏰'; }
                return '<div class="status ' + statusClass + '" id="req-' + r.id + '">' +
                  '<div class="track-name">' + r.trackName + '</div>' +
                  '<div class="artist-name">' + r.artistName + '</div>' +
                  '<div class="status-badge ' + statusClass + '">' + icon + ' ' + statusText + '</div>' +
                '</div>';
              }).join('');
          }
          function updateMyRequestStatus(request) {
            const idx = myRequests.findIndex(r => r.id === request.id);
            if (idx !== -1) {
              myRequests[idx] = request;
              localStorage.setItem('myRequests', JSON.stringify(myRequests));
              renderMyRequests();
            }
          }
          function goBack() {
            document.getElementById('codeForm').style.display = 'block';
            document.getElementById('requestForm').style.display = 'none';
            document.getElementById('eventCode').value = '';
            currentEventId = null;
          }
        </script>
      </body>
      </html>
    `);
  }
});

io.on('connection', (socket) => {
  console.log('Client connected');

  socket.on('join_event', (eventId) => {
    socket.join(eventId);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`MusicAsk server running on port ${PORT}`);
});
