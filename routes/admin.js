const express = require('express');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { User, Patient, AuditLog, sequelize } = require('../models');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { sendSecureResultEmail } = require('../services/emailService');
const logger = require('../utils/logger');

const router = express.Router();

// Validation middleware for staff and patient registration
const validateStaff = (req, res, next) => {
  const { firstName, lastName, email, role, phone } = req.body;
  if (!firstName || !lastName || !email || !role || !phone) {
    return res.status(400).json({ message: 'Missing required fields: firstName, lastName, email, role, phone' });
  }
  if (!['doctor', 'lab_technician', 'admin'].includes(role)) {
    return res.status(400).json({ message: 'Invalid role. Must be doctor, lab_technician, or admin' });
  }
  next();
};

const validatePatient = (req, res, next) => {
  const { firstName, lastName, email, phone, category, dateOfBirth, createUserAccount } = req.body;
  if (!firstName || !lastName || !email || !phone || !category || !dateOfBirth) {
    return res.status(400).json({ message: 'Missing required fields: firstName, lastName, email, phone, category, dateOfBirth' });
  }
  if (!['Walk-in', 'Referred', 'Doctor referral', 'Corporate', 'Hospital', 'HMO'].includes(category)) {
    return res.status(400).json({ message: 'Invalid patient category' });
  }
  next();
};

// Get all users (Admin only)
router.get('/users', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { page = 1, limit = 10, role } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = {};
    if (role) whereClause.role = role;

    const { rows: users, count } = await User.findAndCountAll({
      where: whereClause,
      attributes: { exclude: ['password'] },
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['createdAt', 'DESC']]
    });

    res.json({
      users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        pages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    logger.error('Error fetching users:', error);
    res.status(500).json({ message: 'Error fetching users' });
  }
});

// Register new staff (Admin only)
router.post('/staff', authenticateToken, requireRole('admin'), validateStaff, async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { firstName, lastName, email, role, phone } = req.body;

    // Check if email is already used
    const existingUser = await User.findOne({ where: { email }, transaction });
    if (existingUser) {
      await transaction.rollback();
      return res.status(400).json({ message: 'Email already in use' });
    }

    // Generate temporary password
    const tempPassword = crypto.randomBytes(8).toString('hex');

    // Create staff user
    const user = await User.create({
      firstName,
      lastName,
      email,
      phone,
      role,
      password: tempPassword // Assume password hashing in model hook
    }, { transaction });

    // Log action
    await AuditLog.create({
      userId: req.user.id,
      action: 'REGISTER_STAFF',
      details: `Admin registered staff ${user.id} (${role})`,
      entityId: user.id,
      entityType: 'User'
    }, { transaction });

    // Send email with temporary credentials
    await sendSecureResultEmail({
      to: email,
      patientName: `${firstName} ${lastName}`,
      subject: 'Your Staff Account Credentials',
      body: `Your account has been created. Your userId is ${user.id}. Please log in with this temporary password: ${tempPassword} and change it upon first login. Access the portal at: ${process.env.FRONTEND_URL}/login`
    });

    await transaction.commit();
    res.status(201).json({ message: 'Staff registered successfully', userId: user.id });
  } catch (error) {
    await transaction.rollback();
    logger.error('Error registering staff:', error);
    res.status(500).json({ message: 'Error registering staff' });
  }
});

// Register new patient (Admin only)
router.post('/patients', authenticateToken, requireRole('admin'), validatePatient, async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { firstName, lastName, email, phone, category, dateOfBirth, createUserAccount } = req.body;

    // Check if email is already used
    const existingPatient = await Patient.findOne({ where: { email }, transaction });
    if (existingPatient) {
      await transaction.rollback();
      return res.status(400).json({ message: 'Email already in use' });
    }

    // Generate unique patientId
    const patientId = `PAT-${crypto.randomUUID().split('-')[0]}`;

    // Create patient
    const patient = await Patient.create({
      patientId,
      firstName,
      lastName,
      email,
      phone,
      category,
      dateOfBirth: new Date(dateOfBirth)
    }, { transaction });

    let user = null;
    if (createUserAccount) {
      // Generate temporary password
      const tempPassword = crypto.randomBytes(8).toString('hex');

      // Create user account for patient
      user = await User.create({
        firstName,
        lastName,
        email,
        phone,
        role: 'patient',
        password: tempPassword, // Assume password hashing in model hook
        patientId: patient.id
      }, { transaction });

      // Update patient with userId
      await patient.update({ userId: user.id }, { transaction });

      // Send email with temporary credentials
      await sendSecureResultEmail({
        to: email,
        patientName: `${firstName} ${lastName}`,
        subject: 'Your Patient Portal Account',
        body: `Your patient account has been created. Your userId is ${user.id} and patientId is ${patientId}. Please log in with this temporary password: ${tempPassword} and change it upon first login. Access the portal at: ${process.env.FRONTEND_URL}/login`
      });
    }

    // Log action
    await AuditLog.create({
      userId: req.user.id,
      action: 'REGISTER_PATIENT',
      details: `Admin registered patient ${patientId}${user ? ` with user account ${user.id}` : ''}`,
      entityId: patient.id,
      entityType: 'Patient'
    }, { transaction });

    await transaction.commit();
    res.status(201).json({
      message: 'Patient registered successfully',
      patientId: patient.id,
      ...(user && { userId: user.id })
    });
  } catch (error) {
    await transaction.rollback();
    logger.error('Error registering patient:', error);
    res.status(500).json({ message: 'Error registering patient' });
  }
});

// Update user (Admin only)
router.put('/users/:id', authenticateToken, requireRole('admin'), async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { firstName, lastName, email, phone, role } = req.body;

    const user = await User.findByPk(id);
    if (!user) {
      await transaction.rollback();
      return res.status(404).json({ message: 'User not found' });
    }

    if (role && !['doctor', 'lab_technician', 'admin', 'patient'].includes(role)) {
      await transaction.rollback();
      return res.status(400).json({ message: 'Invalid role' });
    }

    // Check if email is already used by another user
    if (email && email !== user.email) {
      const existingUser = await User.findOne({ where: { email }, transaction });
      if (existingUser && existingUser.id !== user.id) {
        await transaction.rollback();
        return res.status(400).json({ message: 'Email already in use' });
      }
    }

    await user.update({ firstName, lastName, email, phone, role }, { transaction });

    // Log action
    await AuditLog.create({
      userId: req.user.id,
      action: 'UPDATE_USER',
      details: `Admin updated user ${id}`,
      entityId: id,
      entityType: 'User'
    }, { transaction });

    await transaction.commit();
    res.json({ message: 'User updated' });
  } catch (error) {
    await transaction.rollback();
    logger.error('Error updating user:', error);
    res.status(500).json({ message: 'Error updating user' });
  }
});

// Delete user (Admin only)
router.delete('/users/:id', authenticateToken, requireRole('admin'), async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { id } = req.params;
    const user = await User.findByPk(id);

    if (!user) {
      await transaction.rollback();
      return res.status(404).json({ message: 'User not found' });
    }

    // If user is a patient, update associated patient record
    if (user.role === 'patient') {
      const patient = await Patient.findOne({ where: { userId: id }, transaction });
      if (patient) {
        await patient.update({ userId: null }, { transaction });
      }
    }

    await user.destroy({ transaction });

    // Log action
    await AuditLog.create({
      userId: req.user.id,
      action: 'DELETE_USER',
      details: `Admin deleted user ${id}`,
      entityId: id,
      entityType: 'User'
    }, { transaction });

    await transaction.commit();
    res.json({ message: 'User deleted' });
  } catch (error) {
    await transaction.rollback();
    logger.error('Error deleting user:', error);
    res.status(500).json({ message: 'Error deleting user' });
  }
});

// Get audit logs (Admin only)
router.get('/audit-logs', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { page = 1, limit = 10, userId, action, dateFrom, dateTo } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = {};
    if (userId) whereClause.userId = userId;
    if (action) whereClause.action = action;
    if (dateFrom || dateTo) {
      whereClause.createdAt = {};
      if (dateFrom) whereClause.createdAt[Op.gte] = new Date(dateFrom);
      if (dateTo) {
        const endDate = new Date(dateTo);
        endDate.setHours(23, 59, 59, 999);
        whereClause.createdAt[Op.lte] = endDate;
      }
    }

    const { rows: logs, count } = await AuditLog.findAndCountAll({
      where: whereClause,
      include: [{ model: User, attributes: ['firstName', 'lastName', 'role'] }],
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['createdAt', 'DESC']]
    });

    res.json({
      logs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        pages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    logger.error('Error fetching audit logs:', error);
    res.status(500).json({ message: 'Error fetching audit logs' });
  }
});

// Update system settings (e.g., patient categories)
router.put('/settings', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { patientCategories } = req.body;

    if (!Array.isArray(patientCategories) || patientCategories.length === 0) {
      return res.status(400).json({ message: 'Invalid patient categories' });
    }

    // TODO: Implement storage of settings (e.g., in a Settings model or config file)
    await AuditLog.create({
      userId: req.user.id,
      action: 'UPDATE_SETTINGS',
      details: `Admin updated system settings: ${JSON.stringify({ patientCategories })}`,
      entityType: 'System'
    });

    res.json({ message: 'Settings updated' });
  } catch (error) {
    logger.error('Error updating settings:', error);
    res.status(500).json({ message: 'Error updating settings' });
  }
});

module.exports = router;