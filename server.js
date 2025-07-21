// server.js
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const { sequelize } = require('./models');
const logger = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');

// Route imports
const authRoutes = require('./routes/auth');
const patientRoutes = require('./routes/patients');
const doctorRoutes = require('./routes/doctors');
const labTechRoutes = require('./routes/labTech');
const testRoutes = require('./routes/tests');
const resultRoutes = require('./routes/labResults');
const adminRoutes = require('./routes/admin');
const importRoutes = require('./routes/import');
//const resultRoutes = require('./routes/results');

const app = express();
const server = createServer(app);
const io = new Server(server, {
cors: {
origin: process.env.FRONTEND_URL || "http://localhost:3000",
methods: ["GET", "POST"]
}
});

// Security middleware
app.use(helmet());
app.use(cors({
origin: process.env.FRONTEND_URL || "http://localhost:3000",
credentials: true
}));

// Rate limiting
const limiter = rateLimit({
windowMs: 15 * 60 * 1000, // 15 minutes
max: 100, // limit each IP to 100 requests per windowMs
message: 'Too many requests from this IP'
});
app.use('/api', limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Socket.io for real-time notifications
io.on('connection', (socket) => {
logger.info('User connected:', socket.id);

socket.on('join-room', (role) => {
socket.join(role);
logger.info(`User joined ${role} room`);
});

socket.on('disconnect', () => {
logger.info('User disconnected:', socket.id);
});
});

// Make io available to routes
app.use((req, res, next) => {
req.io = io;
next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/doctors', doctorRoutes);
app.use('/api/lab-tech', labTechRoutes);
app.use('/api/tests', testRoutes);
app.use('/api/results', resultRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/import', importRoutes);

// Health check
app.get('/health', (req, res) => {
res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Error handling
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
res.status(404).json({ message: 'Route not found' });
});

const PORT = process.env.PORT || 5000;

// Database connection and server start
sequelize.authenticate()
.then(() => {
logger.info('Database connected successfully');
return sequelize.sync({ alter: true }); // Use migrations in production
})
.then(() => {
server.listen(PORT, () => {
logger.info(`Server running on port ${PORT}`);
});
})
.catch(err => {
logger.error('Unable to connect to database:', err);
process.exit(1);
});