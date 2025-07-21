// middleware/auth.js
const jwt = require('jsonwebtoken');
const { User } = require('../models');
const logger = require('../utils/logger');

const authenticate = async (req, res, next) => {
try {
const token = req.header('Authorization')?.replace('Bearer ', '');

if (!token) {
return res.status(401).json({ message: 'Access denied. No token provided.' });
}

const decoded = jwt.verify(token, process.env.JWT_SECRET);
const user = await User.findByPk(decoded.userId);

if (!user || !user.isActive) {
return res.status(401).json({ message: 'Invalid token or user inactive.' });
}

req.user = user;
next();
} catch (error) {
logger.error('Authentication error:', error);
res.status(401).json({ message: 'Invalid token.' });
}
};

const authorize = (...roles) => {
return (req, res, next) => {
if (!roles.includes(req.user.role)) {
return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
}
next();
};
};


// //const jwt = require('jsonwebtoken');
// // const { User } = require('../models');
// // const logger = require('../utils/logger');

// const authenticateToken = async (req, res, next) => {
//   const authHeader = req.headers['authorization'];
//   const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

//   if (!token) {
//     logger.warn('No token provided in request');
//     return res.status(401).json({ message: 'No token provided' });
//   }

//   try {
//     const decoded = jwt.verify(token, process.env.JWT_SECRET);
//     const user = await User.findByPk(decoded.id, {
//       attributes: ['id', 'firstName', 'lastName', 'email', 'role', 'patientId']
//     });

//     if (!user) {
//       logger.warn(`User not found for token: ${decoded.id}`);
//       return res.status(401).json({ message: 'Invalid token' });
//     }

//     req.user = user;
//     next();
//   } catch (error) {
//     logger.error('Error verifying token:', error);
//     return res.status(403).json({ message: 'Invalid or expired token' });
//   }
// };

// const requireRole = (roles) => {
//   return (req, res, next) => {
//     if (!req.user || !req.user.role) {
//       logger.warn('User or role not found in request');
//       return res.status(403).json({ message: 'User role not found' });
//     }

//     if (!Array.isArray(roles)) {
//       logger.error('Invalid roles configuration: roles must be an array');
//       return res.status(500).json({ message: 'Server configuration error' });
//     }

//     if (!roles.includes(req.user.role)) {
//       logger.warn(`Unauthorized access attempt by user ${req.user.id} with role ${req.user.role}`);
//       return res.status(403).json({ message: `Access denied: Requires one of the following roles: ${roles.join(', ')}` });
//     }

//     next();
//   };
// };

//const jwt = require('jsonwebtoken');
//const { User } = require('../models');
//const logger = require('../utils/logger');

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

  if (!token) {
    logger.warn('No token provided in request');
    return res.status(401).json({ message: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findByPk(decoded.id, {
      attributes: ['id', 'firstName', 'lastName', 'email', 'role', 'patientId', 'isActive']
    });

    if (!user || !user.isActive) {
      logger.warn(`User not found or inactive for token: ${decoded.id}`);
      return res.status(401).json({ message: 'Invalid token or user inactive.' });
    }

    req.user = user;
    next();
  } catch (error) {
    logger.error('Error verifying token:', error);
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
};

const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      logger.warn('User or role not found in request');
      return res.status(403).json({ message: 'User role not found.' });
    }

    if (!Array.isArray(roles)) {
      logger.error('Invalid roles configuration: roles must be an array');
      return res.status(500).json({ message: 'Server configuration error.' });
    }

    if (!roles.includes(req.user.role)) {
      logger.warn(`Unauthorized access attempt by user ${req.user.id} with role ${req.user.role}`);
      return res.status(403).json({ message: `Access denied: Requires one of the following roles: ${roles.join(', ')}.` });
    }

    next();
  };
};

// module.exports = { authenticateToken, requireRole };

module.exports = { authenticateToken, requireRole, authenticate, authorize };
