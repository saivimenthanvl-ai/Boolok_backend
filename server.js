const dns = require('dns');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

/*
 * Windows can occasionally fail MongoDB Atlas SRV lookups through c-ares.
 * Using public DNS resolvers is acceptable for local development only.
 * On Render (Linux), this should always be disabled.
 */
if (process.platform === 'win32' && process.env.DISABLE_CUSTOM_DNS !== 'true') {
  try {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
  } catch (error) {
    console.warn('Unable to configure custom DNS resolvers:', error.message);
  }
}

const app = express();
const PORT = Number(process.env.PORT) || 5000;

function requireEnvironmentVariable(name) {
  const value = process.env[name];

  if (!value || !value.trim()) {
    throw new Error(`${name} is missing from the backend environment.`);
  }

  return value.trim();
}

app.disable('x-powered-by');

/*
 * Robust CORS setup allowing requests from mobile apps (no Origin header)
 * as well as web applications (localhost, vercel.app, render.com, and configured domains).
 */
function isAllowedOrigin(origin) {
  // Mobile apps, Postman, curl, and server-to-server calls don't send an Origin header.
  if (!origin) return true;

  // Allow all local subnet IP addresses (192.168.x.x, 10.x.x.x, 172.x.x.x) and localhost
  const isLocalSubnet = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/.test(origin);
  if (isLocalSubnet) return true;

  // Allow all Vercel deployments (*.vercel.app, preview branches, production)
  const isVercel = /^https?:\/\/([a-zA-Z0-9_-]+\.)*vercel\.app(:\d+)?$/.test(origin);
  if (isVercel) return true;

  // Allow Render deployments (*.onrender.com)
  const isRender = /^https?:\/\/([a-zA-Z0-9_-]+\.)*onrender\.com(:\d+)?$/.test(origin);
  if (isRender) return true;

  const configuredOrigins = [
    process.env.FRONTEND_URL,
    process.env.WEB_APP_URL,
    process.env.CORS_ORIGINS,
  ]
    .filter(Boolean)
    .flatMap((val) => String(val).split(',').map((v) => v.trim()).filter(Boolean));

  if (configuredOrigins.some((allowed) => allowed === origin || origin.endsWith(allowed))) {
    return true;
  }

  return false;
}

app.use(
  cors({
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) {
        return callback(null, true);
      }

      console.warn(`Blocked by CORS: ${origin}`);
      return callback(new Error('This origin is not allowed by the API CORS policy.'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Range', 'Accept', 'Origin', 'X-Requested-With'],
    exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length', 'Content-Type'],
  })
);

app.use(
  express.json({
    limit: '20mb',
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: '20mb',
  })
);

const http = require('http');
const { Server: SocketServer } = require('socket.io');
const jwt = require('jsonwebtoken');
const Message = require('./models/Message');
const Conversation = require('./models/Conversation');

/*
 * API routes
 */
app.use('/api/auth', require('./routes/auth'));
app.use('/api/feed', require('./routes/feedRoutes'));
app.use('/api/reels', require('./routes/reels'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/users', require('./routes/users'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/blueprint', require('./routes/blueprint'));
app.use('/api/legal', require('./routes/legal'));

/*
 * Public uploaded files with Cross-Origin and Range header support
 */
app.use(
  '/uploads',
  (req, res, next) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Accept-Ranges', 'bytes');
    next();
  },
  express.static(path.join(__dirname, 'uploads'), {
    setHeaders(res) {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Accept-Ranges', 'bytes');
    },
  })
);

/*
 * Health route
 */
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    database:
      mongoose.connection.readyState === 1
        ? 'connected'
        : 'disconnected',
    time: new Date().toISOString(),
  });
});

/*
 * Base route
 */
app.get('/', (req, res) => {
  res.status(200).json({
    name: 'BOOLOK GPT API',
    status: 'running',
  });
});

/*
 * 404 handler
 */
app.use((req, res) => {
  res.status(404).json({
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

/*
 * Global error handler
 */
app.use((error, req, res, next) => {
  console.error('GLOBAL SERVER ERROR:', error);

  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      message: 'Image is too large. Maximum size is 10 MB.',
    });
  }

  if (error.type === 'entity.too.large') {
    return res.status(413).json({
      message: 'Request payload is too large.',
    });
  }

  if (error.name === 'MulterError') {
    return res.status(400).json({
      message: error.message || 'File upload failed.',
    });
  }

  if (
    typeof error.message === 'string' &&
    error.message.includes('CORS policy')
  ) {
    return res.status(403).json({
      message: error.message,
    });
  }

  return res.status(error.status || 500).json({
    message:
      process.env.NODE_ENV === 'production'
        ? 'Internal server error.'
        : error.message || 'Internal server error.',
  });
});

const server = http.createServer(app);
const io = new SocketServer(server, {
  cors: {
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) {
        return callback(null, true);
      }
      return callback(new Error('This origin is not allowed by the Socket CORS policy.'));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  },
  // Allow both polling and WebSocket transports.
  // Render free tier doesn't reliably support WebSocket upgrades,
  // so polling must stay enabled as the primary fallback.
  transports: ['polling', 'websocket'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
  upgradeTimeout: 10000,
});

app.set('io', io);

// Socket JWT authentication middleware
io.use((socket, next) => {
  const token =
    socket.handshake.auth?.token ||
    socket.handshake.headers?.authorization?.replace('Bearer ', '');

  if (!token) {
    return next(new Error('Authentication token required'));
  }

  const secrets = [
    process.env.JWT_SECRET,
    'boolok_default_jwt_secret_key_2026',
    'boolok_secret_key_2026',
  ].filter(Boolean);

  let decoded = null;
  let lastErr = null;

  for (const secret of secrets) {
    try {
      decoded = jwt.verify(token, secret);
      if (decoded && (decoded.userId || decoded.id)) {
        break;
      }
    } catch (err) {
      lastErr = err;
    }
  }

  if (decoded && (decoded.userId || decoded.id)) {
    socket.userId = (decoded.userId || decoded.id).toString();
    return next();
  }

  console.warn('[socket] Token verification failed:', lastErr ? lastErr.message : 'Invalid token');
  return next(new Error('Invalid token'));
});

io.on('connection', (socket) => {
  if (socket.userId) {
    const userRoom = `user_${socket.userId}`;
    socket.join(userRoom);
  }

  // Join active conversation channel
  socket.on('join_conversation', (conversationId) => {
    if (conversationId) {
      socket.join(`conv_${conversationId}`);
    }
  });

  socket.on('leave_conversation', (conversationId) => {
    if (conversationId) {
      socket.leave(`conv_${conversationId}`);
    }
  });

  // Typing indicator broadcast
  socket.on('typing', ({ conversationId }) => {
    if (conversationId) {
      socket.to(`conv_${conversationId}`).emit('user_typing', {
        conversationId,
        userId: socket.userId,
      });
    }
  });

  socket.on('stop_typing', ({ conversationId }) => {
    if (conversationId) {
      socket.to(`conv_${conversationId}`).emit('user_stop_typing', {
        conversationId,
        userId: socket.userId,
      });
    }
  });

  // Direct socket message delivery
  socket.on('send_message', async ({ conversationId, recipientId, text, mediaUrl }, callback) => {
    try {
      if (!conversationId && !recipientId) return;
      let conv = null;
      if (conversationId && mongoose.Types.ObjectId.isValid(conversationId)) {
        conv = await Conversation.findById(conversationId);
      }
      if (!conv && recipientId) {
        conv = await Conversation.findOne({
          participants: { $all: [socket.userId, recipientId], $size: 2 },
        });
        if (!conv) {
          conv = await Conversation.create({
            participants: [socket.userId, recipientId],
            unreadCounts: new Map([[socket.userId, 0], [recipientId, 0]]),
          });
        }
      }
      if (!conv) return;

      const targetRecipient = (conv.participants || []).find(
        (p) => p.toString() !== socket.userId.toString()
      );

      const msg = await Message.create({
        conversationId: conv._id,
        sender: socket.userId,
        recipient: targetRecipient,
        text: (text || '').trim(),
        mediaUrl: mediaUrl || null,
        read: false,
      });

      const currentUnread = conv.unreadCounts ? conv.unreadCounts.get(targetRecipient.toString()) || 0 : 0;
      const newUnreadMap = new Map(conv.unreadCounts || []);
      newUnreadMap.set(targetRecipient.toString(), currentUnread + 1);

      conv.lastMessage = {
        text: (text || '').trim() || 'Shared a media attachment',
        sender: socket.userId,
        createdAt: new Date(),
        mediaUrl: mediaUrl || null,
      };
      conv.unreadCounts = newUnreadMap;
      await conv.save();

      const populated = await Message.findById(msg._id)
        .populate('sender', 'fullName username profilePicture')
        .populate('recipient', 'fullName username profilePicture');

      // Dispatch to conversation room, recipient personal room, and sender personal room
      io.to(`conv_${conv._id}`).emit('new_message', populated);
      if (targetRecipient) {
        const recipientRoom = `user_${targetRecipient.toString()}`;
        io.to(recipientRoom).emit('new_message', populated);
        io.to(recipientRoom).emit('message_notification', {
          message: populated,
          conversationId: conv._id,
        });
      }
      if (socket.userId) {
        io.to(`user_${socket.userId.toString()}`).emit('new_message', populated);
      }

      if (typeof callback === 'function') {
        callback({ success: true, message: populated });
      }
    } catch (err) {
      console.error('[socket] send_message error:', err);
      if (typeof callback === 'function') {
        callback({ success: false, error: err.message });
      }
    }
  });
});

let httpServer;

async function startServer() {
  try {
    const mongoUri = requireEnvironmentVariable('MONGO_URI');
    requireEnvironmentVariable('JWT_SECRET');

    // 1. Immediately bind to port so Render and cloud hosts detect the service as live
    httpServer = server.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running with WebSockets on http://0.0.0.0:${PORT}`);
    });

    // 2. Connect to MongoDB
    const connectOptions = {
      serverSelectionTimeoutMS: 15000,
    };
    if (process.platform === 'win32') {
      connectOptions.family = 4;
    }

    // TEST SAFETY CHECK: If running in test mode or TEST_ONLY_LOOPBACK is true, refuse any non-loopback host
    if (process.env.TEST_ONLY_LOOPBACK === 'true' || process.env.NODE_ENV === 'test') {
      const parsedUrl = new URL(mongoUri.startsWith('mongodb://') || mongoUri.startsWith('mongodb+srv://') ? mongoUri.replace('mongodb+srv://', 'http://').replace('mongodb://', 'http://') : `http://${mongoUri}`);
      const hostname = parsedUrl.hostname.toLowerCase();
      const isLoopback = hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
      if (!isLoopback) {
        throw new Error(`TEST MODE SAFETY REFUSAL: Refusing to start because MongoDB host "${hostname}" is not loopback (127.0.0.1/localhost).`);
      }
      console.log(`[TEST-SAFETY-CHECK-PASSED] Verified MongoDB host "${hostname}" is strict loopback.`);
    }

    await mongoose.connect(mongoUri, connectOptions);
    console.log(`MongoDB connected: ${mongoose.connection.host}`);

    if (process.env.TEST_ONLY_LOOPBACK === 'true' || process.env.NODE_ENV === 'test') {
      const connectedHost = (mongoose.connection.host || '').toLowerCase();
      if (connectedHost !== '127.0.0.1' && connectedHost !== 'localhost' && connectedHost !== '::1') {
        await mongoose.connection.close();
        throw new Error(`TEST MODE POST-CONNECT SAFETY REFUSAL: Connected host "${connectedHost}" is not loopback! Connection terminated.`);
      }
    }
  } catch (error) {
    console.error('SERVER STARTUP ERROR:', error.message);
    process.exit(1);
  }
}

async function shutdown(signal) {
  console.log(`${signal} received. Shutting down gracefully.`);

  try {
    if (httpServer) {
      await new Promise((resolve, reject) => {
        httpServer.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('Shutdown error:', error);
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED PROMISE REJECTION:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('UNCAUGHT EXCEPTION:', error);
  process.exit(1);
});

startServer();

module.exports = app;
