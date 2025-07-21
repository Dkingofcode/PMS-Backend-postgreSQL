// routes/auth.js
const express = require('express');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { User } = require('../models');
const { authenticate } = require('../middleware/auth');
const { validationResult, body } = require('express-validator');
const logger = require('../utils/logger');

const router = express.Router();

// Login
router.post('/login', [
body('email').isEmail().normalizeEmail(),
body('password').isLength({ min: 6 }),
], async (req, res) => {
try {
const errors = validationResult(req);
if (!errors.isEmpty()) {
return res.status(400).json({ errors: errors.array() });
}

const { email, password, twoFactorToken } = req.body;

const user = await User.findOne({ where: { email, isActive: true } });
if (!user || !(await user.comparePassword(password))) {
return res.status(401).json({ message: 'Invalid credentials' });
}

// Check 2FA if enabled
if (user.twoFactorEnabled) {
if (!twoFactorToken) {
return res.status(202).json({
message: 'Two-factor authentication required',
requiresTwoFactor: true
});
}

const verified = speakeasy.totp.verify({
secret: user.twoFactorSecret,
encoding: 'base32',
token: twoFactorToken,
window: 2
});

if (!verified) {
return res.status(401).json({ message: 'Invalid two-factor token' });
}
}

// Update last login
await user.update({ lastLogin: new Date() });

const token = jwt.sign(
{ userId: user.id, role: user.role },
process.env.JWT_SECRET,
{ expiresIn: '8h' }
);

logger.info(`User ${user.email} logged in successfully`);

res.json({
token,
user: {
id: user.id,
email: user.email,
firstName: user.firstName,
lastName: user.lastName,
role: user.role,
twoFactorEnabled: user.twoFactorEnabled
}
});
} catch (error) {
logger.error('Login error:', error);
res.status(500).json({ message: 'Server error' });
}
});


// Setup 2FA
router.post('/setup-2fa', authenticate, async (req, res) => {
try {
const secret = speakeasy.generateSecret({
name: `Healthcare Platform (${req.user.email})`,
issuer: 'Healthcare Platform'
});

await req.user.update({ twoFactorSecret: secret.base32 });

const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

res.json({
secret: secret.base32,
qrCode: qrCodeUrl
});
} catch (error) {
logger.error('2FA setup error:', error);
res.status(500).json({ message: 'Server error' });
}
});



// Verify and enable 2FA
router.post('/verify-2fa', authenticate, [
body('token').isLength({ min: 6, max: 6 }),
], async (req, res) => {
try {
const errors = validationResult(req);
if (!errors.isEmpty()) {
return res.status(400).json({ errors: errors.array() });
}

const { token } = req.body;

const verified = speakeasy.totp.verify({
secret: req.user.twoFactorSecret,
encoding: 'base32',
token: token,
window: 2
});

if (!verified) {
return res.status(400).json({ message: 'Invalid token' });
}

await req.user.update({ twoFactorEnabled: true });

res.json({ message: 'Two-factor authentication enabled successfully' });
} catch (error) {
logger.error('2FA verification error:', error);
res.status(500).json({ message: 'Server error' });
}
});

module.exports = router;



