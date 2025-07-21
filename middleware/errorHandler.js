// middleware/errorHandler.js
const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
logger.error(err.message, err);

if (err.name === 'SequelizeValidationError') {
const errors = err.errors.map(e => ({
field: e.path,
message: e.message
}));
return res.status(400).json({ message: 'Validation error', errors });
}

if (err.name === 'SequelizeUniqueConstraintError') {
return res.status(409).json({ message: 'Resource already exists' });
}

if (err.name === 'JsonWebTokenError') {
return res.status(401).json({ message: 'Invalid token' });
}

res.status(err.statusCode || 500).json({
message: err.message || 'Internal server error',
...(process.env.NODE_ENV === 'development' && { stack: err.stack })
});
};

module.exports = errorHandler;