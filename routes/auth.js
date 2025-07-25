const express = require('express');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { Op } = require('sequelize'); // Add Sequelize OR operator
const { User } = require('../models');
const { authenticate } = require('../middleware/auth');
const { validationResult, body } = require('express-validator');
const logger = require('../utils/logger');

const router = express.Router();

// Login with email, username, or user ID
router.post('/login', [
  body('identifier').trim().notEmpty().withMessage('Identifier is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    // const { identifier, password, twoFactorToken } = req.body;

    // // Find user by email, username, or user ID
    // const user = await User.findOne({
    //   where: {
    //     [Op.or]: [
    //       { email: identifier },
    //       { username: identifier },
    //       { userId: identifier }, // Assuming you have a userId column
    //     ],
    //     isActive: true,
    //   },
    // });

    const { identifier, password, twoFactorToken } = req.body;

const whereClause = {
  [Op.or]: [
    { email: identifier },
    { username: identifier },
  ],
  
};

// Only try matching userId if it's a valid UUID
if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(identifier)) {
  whereClause[Op.or].push({ userId: identifier });
}

const user = await User.findOne({ where: whereClause });

const testuser = await User.findOne({ where: { email: 'okosoks@gmail.com' } });
console.log(await testuser.comparePassword('ChangeMe123!')); // Should be true

const loguser = await User.findOne({ where: whereClause });
console.log("👉 Login User Result:", loguser?.toJSON?.());

console.log('User loaded:', user?.email);
console.log('Has comparePassword:', typeof user?.comparePassword === 'function');

if (!user) {
  console.log('❌ User not found for identifier:', identifier);
  return res.status(401).json({ message: 'Invalid credentials' });
}

const isValid = await user.comparePassword(password);
if (!isValid) {
  console.log('❌ Invalid password for:', identifier);
  return res.status(401).json({ message: 'Invalid credentials' });
}


    // if (!user || !(await user.comparePassword(password))) {
    //   console.log('User not found');
    //   return res.status(401).json({ message: 'Invalid credentials' });
    // }

    // 2FA Check (if enabled)
    if (user.twoFactorEnabled) {
      if (!twoFactorToken) {
        return res.status(202).json({
          message: 'Two-factor authentication required',
          requiresTwoFactor: true,
        });
      }
      const isMatch = await user.comparePassword(password);
if (!isMatch) {
  console.log('Password mismatch');
  return res.status(401).json({ message: 'Invalid credentials' });
}


      const verified = speakeasy.totp.verify({
        secret: user.twoFactorSecret,
        encoding: 'base32',
        token: twoFactorToken,
        window: 2,
      });

      if (!verified) {
        return res.status(401).json({ message: 'Invalid two-factor token' });
      }
    }

    // Update last login and generate JWT
    await user.update({ lastLogin: new Date() });

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    logger.info(`User ${user.email} logged in successfully`);
    console.log("Login attempt:", identifier, password);
    console.log("Where clause:", whereClause);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username, // Include username in response
        userId: user.userId,     // Include user ID if exists
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        twoFactorEnabled: user.twoFactorEnabled,
      },
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// 2FA Setup (remains unchanged)
router.post('/setup-2fa', authenticate, async (req, res) => {
  try {
    const secret = speakeasy.generateSecret({
      name: `Healthcare Platform (${req.user.email})`,
      issuer: 'Healthcare Platform',
    });

    await req.user.update({ twoFactorSecret: secret.base32 });
    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

    res.json({
      secret: secret.base32,
      qrCode: qrCodeUrl,
    });
  } catch (error) {
    logger.error('2FA setup error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// 2FA Verification (remains unchanged)
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
      window: 2,
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


// TEMPORARY PASSWORD RESET ROUTE
router.post('/reset-password', async (req, res) => {
  const { identifier, newPassword } = req.body;

  if (!identifier || !newPassword) {
    return res.status(400).json({ message: 'Identifier and new password are required' });
  }

  try {
    const whereClause = {
      [Op.or]: [
        { email: identifier },
        { username: identifier },
      ],
    };

    // Check if it's a UUID (userId)
    if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(identifier)) {
      whereClause[Op.or].push({ userId: identifier });
    }

    const user = await User.findOne({ where: whereClause });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const bcrypt = require('bcryptjs');

   const hashedPassword = await bcrypt.hash(newPassword, 12);

     await user.update({ password: newPassword });

    // const hashedPassword = await bcrypt.hash(newPassword, 12);



    // await user.update({ password: hashedPassword });

    res.json({ message: '✅ Password updated successfully' });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ message: '❌ Server error during password reset' });
  }
});



module.exports = router;