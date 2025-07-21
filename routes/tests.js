// routes/tests.js
const express = require('express');
const { Op } = require('sequelize');
const { Test, TestRequest, Patient, User, sequelize } = require('../models');
const { authenticateToken, requireRole } = require('../middleware/auth');
const logger = require('../utils/logger');
const { validateTest, validateTestRequest } = require('../middleware/validation');

const router = express.Router();

// Get all available tests
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { category, search, page = 1, limit = 50, isActive = true } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = {};
    if (isActive !== undefined) whereClause.isActive = isActive === 'true';
    if (category) whereClause.category = category;
    if (search) {
      whereClause[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { code: { [Op.iLike]: `%${search}%` } },
        { description: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const { rows: tests, count } = await Test.findAndCountAll({
      where: whereClause,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['category', 'ASC'], ['name', 'ASC']]
    });

    res.json({
      tests,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        pages: Math.ceil(count / limit)
      }
    });

  } catch (error) {
    logger.error('Error fetching tests:', error);
    res.status(500).json({ message: 'Error fetching tests' });
  }
});

// Get test categories
router.get('/categories', authenticateToken, async (req, res) => {
  try {
    const categories = await Test.findAll({
      attributes: [
        'category',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      where: { isActive: true },
      group: ['category'],
      order: [['category', 'ASC']],
      raw: true
    });

    res.json(categories);

  } catch (error) {
    logger.error('Error fetching test categories:', error);
    res.status(500).json({ message: 'Error fetching categories' });
  }
});

// Get specific test details
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const test = await Test.findByPk(req.params.id);

    if (!test) {
      return res.status(404).json({ message: 'Test not found' });
    }

    res.json(test);

  } catch (error) {
    logger.error('Error fetching test details:', error);
    res.status(500).json({ message: 'Error fetching test details' });
  }
});

// Create new test (admin only)
router.post('/', authenticateToken, requireRole(['admin']),  async (req, res) => {
  try {
    const {
      name,
      code,
      category,
      description,
      normalRange,
      units,
      methodology,
      sampleType,
      turnaroundTime,
      price,
      prerequisites,
      isActive = true
    } = req.body;

    // Check if test code already exists
    const existingTest = await Test.findOne({ where: { code } });
    if (existingTest) {
      return res.status(400).json({ message: 'Test code already exists' });
    }

    const test = await Test.create({
      name,
      code: code.toUpperCase(),
      category,
      description,
      normalRange,
      units,
      methodology,
      sampleType,
      turnaroundTime,
      price,
      prerequisites,
      isActive,
      createdBy: req.user.id
    });

    logger.info(`Test ${test.code} created by admin ${req.user.id}`);

    res.status(201).json({
      message: 'Test created successfully',
      test
    });

  } catch (error) {
    logger.error('Error creating test:', error);
    res.status(500).json({ message: 'Error creating test' });
  }
});

// Update test (admin only)
router.put('/:id', authenticateToken, requireRole(['admin']),  async (req, res) => {
  try {
    const test = await Test.findByPk(req.params.id);

    if (!test) {
      return res.status(404).json({ message: 'Test not found' });
    }

    const {
      name,
      code,
      category,
      description,
      normalRange,
      units,
      methodology,
      sampleType,
      turnaroundTime,
      price,
      prerequisites,
      isActive
    } = req.body;

    // Check if new code conflicts with existing test
    if (code && code !== test.code) {
      const existingTest = await Test.findOne({ 
        where: { 
          code: code.toUpperCase(),
          id: { [Op.ne]: req.params.id }
        } 
      });
      if (existingTest) {
        return res.status(400).json({ message: 'Test code already exists' });
      }
    }

    await test.update({
      name: name || test.name,
      code: code ? code.toUpperCase() : test.code,
      category: category || test.category,
      description: description || test.description,
      normalRange: normalRange || test.normalRange,
      units: units || test.units,
      methodology: methodology || test.methodology,
      sampleType: sampleType || test.sampleType,
      turnaroundTime: turnaroundTime || test.turnaroundTime,
      price: price !== undefined ? price : test.price,
      prerequisites: prerequisites || test.prerequisites,
      isActive: isActive !== undefined ? isActive : test.isActive,
      updatedBy: req.user.id
    });

    logger.info(`Test ${test.code} updated by admin ${req.user.id}`);

    res.json({
      message: 'Test updated successfully',
      test
    });

  } catch (error) {
    logger.error('Error updating test:', error);
    res.status(500).json({ message: 'Error updating test' });
  }
});

// Soft delete test (admin only)
router.delete('/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const test = await Test.findByPk(req.params.id);

    if (!test) {
      return res.status(404).json({ message: 'Test not found' });
    }

    // Check if test has pending requests
    const pendingRequests = await TestRequest.count({
      where: {
        testId: req.params.id,
        status: { [Op.in]: ['pending', 'assigned_to_lab', 'in_progress'] }
      }
    });

    if (pendingRequests > 0) {
      return res.status(400).json({ 
        message: 'Cannot delete test with pending requests' 
      });
    }

    await test.update({
      isActive: false,
      updatedBy: req.user.id
    });

    logger.info(`Test ${test.code} deactivated by admin ${req.user.id}`);

    res.json({ message: 'Test deactivated successfully' });

  } catch (error) {
    logger.error('Error deactivating test:', error);
    res.status(500).json({ message: 'Error deactivating test' });
  }
});

// Create test request (front desk)
router.post('/request', authenticateToken, requireRole(['front_desk', 'admin']),  async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { patientId, testIds, doctorId, priority = 'normal', remarks } = req.body;

    // Verify patient exists
    const patient = await Patient.findByPk(patientId);
    if (!patient) {
      await transaction.rollback();
      return res.status(404).json({ message: 'Patient not found' });
    }

    // Verify doctor exists
    const doctor = await User.findOne({
      where: { id: doctorId, role: 'doctor', isActive: true }
    });
    if (!doctor) {
      await transaction.rollback();
      return res.status(404).json({ message: 'Doctor not found' });
    }

    // Verify all tests exist and are active
    const tests = await Test.findAll({
      where: {
        id: { [Op.in]: testIds },
        isActive: true
      }
    });

    if (tests.length !== testIds.length) {
      await transaction.rollback();
      return res.status(400).json({ message: 'Some tests are invalid or inactive' });
    }

    // Create test requests
    const testRequests = await Promise.all(
      testIds.map(testId =>
        TestRequest.create({
          patientId,
          testId,
          doctorId,
          priority,
          remarks,
          status: 'pending',
          requestedBy: req.user.id
        }, { transaction })
      )
    );

    await transaction.commit();

    // Notify doctor of new test requests
    req.io.to('doctor').emit('new_test_requests', {
      patientName: `${patient.firstName} ${patient.lastName}`,
      patientId: patient.patientId,
      testCount: testIds.length,
      tests: tests.map(t => t.name),
      requestedBy: `${req.user.firstName} ${req.user.lastName}`
    });

    logger.info(`${testIds.length} test requests created for patient ${patientId} by ${req.user.id}`);

    res.status(201).json({
      message: 'Test requests created successfully',
      testRequests: await TestRequest.findAll({
        where: { id: { [Op.in]: testRequests.map(tr => tr.id) } },
        include: [
          { model: Test, attributes: ['name', 'code', 'category'] },
          { model: Patient, attributes: ['firstName', 'lastName', 'patientId'] }
        ]
      })
    });

  } catch (error) {
    await transaction.rollback();
    logger.error('Error creating test requests:', error);
    res.status(500).json({ message: 'Error creating test requests' });
  }
});

// Get test requests (with filtering)
router.get('/requests', authenticateToken, async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      status, 
      patientId, 
      doctorId, 
      dateFrom, 
      dateTo,
      priority 
    } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = {};
    
    // Role-based filtering
    if (req.user.role === 'doctor') {
      whereClause.doctorId = req.user.id;
    } else if (req.user.role === 'lab_technician') {
      whereClause.labTechnicianId = req.user.id;
    }

    // Additional filters
    if (status) whereClause.status = status;
    if (patientId) whereClause.patientId = patientId;
    if (doctorId) whereClause.doctorId = doctorId;
    if (priority) whereClause.priority = priority;

    // Date range filter
    if (dateFrom || dateTo) {
      whereClause.createdAt = {};
      if (dateFrom) whereClause.createdAt[Op.gte] = new Date(dateFrom);
      if (dateTo) {
        const endDate = new Date(dateTo);
        endDate.setHours(23, 59, 59, 999);
        whereClause.createdAt[Op.lte] = endDate;
      }
    }

    const { rows: requests, count } = await TestRequest.findAndCountAll({
      where: whereClause,
      include: [
        { 
          model: Patient, 
          attributes: ['firstName', 'lastName', 'patientId', 'category'] 
        },
        { 
          model: Test, 
          attributes: ['name', 'code', 'category', 'turnaroundTime'] 
        },
        { 
          model: User, 
          as: 'Doctor', 
          attributes: ['firstName', 'lastName'] 
        },
        { 
          model: User, 
          as: 'LabTechnician', 
          attributes: ['firstName', 'lastName'],
          required: false 
        }
      ],
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['createdAt', 'DESC']]
    });

    res.json({
      requests,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        pages: Math.ceil(count / limit)
      }
    });

  } catch (error) {
    logger.error('Error fetching test requests:', error);
    res.status(500).json({ message: 'Error fetching test requests' });
  }
});

// Get specific test request
router.get('/requests/:id', authenticateToken, async (req, res) => {
  try {
    let whereClause = { id: req.params.id };
    
    // Role-based access control
    if (req.user.role === 'doctor') {
      whereClause.doctorId = req.user.id;
    } else if (req.user.role === 'lab_technician') {
      whereClause.labTechnicianId = req.user.id;
    }

    const request = await TestRequest.findOne({
      where: whereClause,
      include: [
        { 
          model: Patient, 
          attributes: ['firstName', 'lastName', 'patientId', 'dateOfBirth', 'phone', 'email', 'category'] 
        },
        { 
          model: Test, 
          attributes: ['name', 'code', 'category', 'normalRange', 'units', 'methodology', 'sampleType'] 
        },
        { 
          model: User, 
          as: 'Doctor', 
          attributes: ['firstName', 'lastName', 'email'] 
        },
        { 
          model: User, 
          as: 'LabTechnician', 
          attributes: ['firstName', 'lastName', 'email'],
          required: false 
        }
      ]
    });

    if (!request) {
      return res.status(404).json({ message: 'Test request not found' });
    }

    res.json(request);

  } catch (error) {
    logger.error('Error fetching test request:', error);
    res.status(500).json({ message: 'Error fetching test request' });
  }
});

// Update test request status (for workflow management)
router.put('/requests/:id/status', authenticateToken, async (req, res) => {
  try {
    const { status, remarks } = req.body;

    const validStatuses = ['pending', 'assigned_to_lab', 'in_progress', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    let whereClause = { id: req.params.id };
    
    // Role-based access control
    if (req.user.role === 'doctor') {
      whereClause.doctorId = req.user.id;
    } else if (req.user.role === 'lab_technician') {
      whereClause.labTechnicianId = req.user.id;
    }

    const request = await TestRequest.findOne({
      where: whereClause,
      include: [
        { model: Patient, attributes: ['firstName', 'lastName'] },
        { model: Test, attributes: ['name'] }
      ]
    });

    if (!request) {
      return res.status(404).json({ message: 'Test request not found' });
    }

    await request.update({
      status,
      remarks: remarks || request.remarks,
      updatedBy: req.user.id
    });

    // Send real-time notification based on status change
    const notificationData = {
      requestId: request.id,
      patientName: `${request.Patient.firstName} ${request.Patient.lastName}`,
      testName: request.Test.name,
      status,
      updatedBy: `${req.user.firstName} ${req.user.lastName}`
    };

    if (status === 'cancelled') {
      req.io.emit('test_cancelled', notificationData);
    }

    logger.info(`Test request ${req.params.id} status changed to ${status} by ${req.user.id}`);

    res.json({
      message: 'Status updated successfully',
      request
    });

  } catch (error) {
    logger.error('Error updating test request status:', error);
    res.status(500).json({ message: 'Error updating status' });
  }
});

// Get test request statistics
router.get('/requests/stats/summary', authenticateToken, requireRole(['admin', 'doctor']), async (req, res) => {
  try {
    const { period = 30 } = req.query; // days
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(period));

    let whereClause = {
      createdAt: { [Op.gte]: startDate }
    };

    // Role-based filtering
    if (req.user.role === 'doctor') {
      whereClause.doctorId = req.user.id;
    }

    // Status distribution
    const statusStats = await TestRequest.findAll({
      where: whereClause,
      attributes: [
        'status',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      group: ['status'],
      raw: true
    });

    // Test category distribution
    const categoryStats = await TestRequest.findAll({
      where: whereClause,
      include: [
        { model: Test, attributes: [] }
      ],
      attributes: [
        [sequelize.col('Test.category'), 'category'],
        [sequelize.fn('COUNT', sequelize.col('TestRequest.id')), 'count']
      ],
      group: [sequelize.col('Test.category')],
      raw: true
    });

    // Daily trend
    const dailyStats = await TestRequest.findAll({
      where: whereClause,
      attributes: [
        [sequelize.fn('DATE', sequelize.col('createdAt')), 'date'],
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      group: [sequelize.fn('DATE', sequelize.col('createdAt'))],
      order: [[sequelize.fn('DATE', sequelize.col('createdAt')), 'ASC']],
      raw: true
    });

    res.json({
      statusDistribution: statusStats,
      categoryDistribution: categoryStats,
      dailyTrend: dailyStats
    });

  } catch (error) {
    logger.error('Error fetching test statistics:', error);
    res.status(500).json({ message: 'Error fetching statistics' });
  }
});

module.exports = router;