// routes/labTech.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { Op } = require('sequelize');
const { TestRequest, TestResult, Test, Patient, User, sequelize } = require('../models');
const {  requireRole } = require('../middleware/auth');
const logger = require('../utils/logger');
const { validateTestResult } = require('../middleware/validation');
const {authenticate} = require("../middleware/auth");

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../uploads/results');
    try {
      await fs.mkdir(uploadPath, { recursive: true });
      cb(null, uploadPath);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const sanitizedOriginalName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `result_${timestamp}_${sanitizedOriginalName}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /pdf|jpg|jpeg|png|doc|docx/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only PDF, DOC, DOCX, JPG, JPEG, PNG files are allowed'));
    }
  }
});

// Get lab technician's dashboard
router.get('/dashboard', authenticate, requireRole(['lab_technician']), async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Get assigned test requests
    const assignedTests = await TestRequest.findAll({
      where: {
        labTechnicianId: req.user.id,
        status: {
          [Op.in]: ['assigned_to_lab', 'in_progress']
        }
      },
      include: [
        {
          model: Patient,
          attributes: ['id', 'firstName', 'lastName', 'patientId', 'dateOfBirth']
        },
        {
          model: Test,
          attributes: ['id', 'name', 'code', 'category', 'normalRange', 'units', 'methodology']
        },
        {
          model: User,
          as: 'Doctor',
          attributes: ['firstName', 'lastName']
        }
      ],
      order: [
        ['priority', 'DESC'], // urgent first
        ['assignedAt', 'ASC']
      ]
    });

    // Get today's statistics
    const stats = await TestRequest.findAll({
      where: {
        labTechnicianId: req.user.id,
        assignedAt: {
          [Op.between]: [today, tomorrow]
        }
      },
      attributes: [
        'status',
        [sequelize.fn('COUNT', sequelize.col('status')), 'count']
      ],
      group: ['status'],
      raw: true
    });

    const statsMap = stats.reduce((acc, stat) => {
      acc[stat.status] = parseInt(stat.count);
      return acc;
    }, {});

    // Get pending results that need revision
    const revisionNeeded = await TestResult.findAll({
      where: {
        status: 'needs_revision'
      },
      include: [
        {
          model: TestRequest,
          where: { labTechnicianId: req.user.id },
          include: [
            { model: Patient, attributes: ['firstName', 'lastName', 'patientId'] },
            { model: Test, attributes: ['name', 'code'] }
          ]
        }
      ]
    });

    res.json({
      assignedTests,
      revisionNeeded,
      stats: {
        assigned: statsMap.assigned_to_lab || 0,
        inProgress: statsMap.in_progress || 0,
        completed: statsMap.completed || 0,
        total: assignedTests.length
      }
    });

  } catch (error) {
    logger.error('Error fetching lab tech dashboard:', error);
    res.status(500).json({ message: 'Error fetching dashboard data' });
  }
});

// Get all assigned test requests
router.get('/assigned-tests', authenticate, requireRole(['lab_technician']), async (req, res) => {
  try {
    const { page = 1, limit = 10, status, priority } = req.query;
    const offset = (page - 1) * limit;

    const whereClause = { labTechnicianId: req.user.id };
    if (status) whereClause.status = status;
    if (priority) whereClause.priority = priority;

    const { rows: testRequests, count } = await TestRequest.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: Patient,
          attributes: ['firstName', 'lastName', 'patientId', 'dateOfBirth', 'phone']
        },
        {
          model: Test,
          attributes: ['name', 'code', 'category', 'normalRange', 'units', 'methodology', 'sampleType']
        },
        {
          model: User,
          as: 'Doctor',
          attributes: ['firstName', 'lastName']
        },
        {
          model: TestResult,
          required: false
        }
      ],
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [
        ['priority', 'DESC'],
        ['assignedAt', 'ASC']
      ]
    });

    res.json({
      testRequests,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        pages: Math.ceil(count / limit)
      }
    });

  } catch (error) {
    logger.error('Error fetching assigned tests:', error);
    res.status(500).json({ message: 'Error fetching assigned tests' });
  }
});

// Start working on a test (change status to in_progress)
router.put('/start-test/:testRequestId', authenticate, requireRole(['lab_technician']), async (req, res) => {
  try {
    const testRequest = await TestRequest.findOne({
      where: {
        id: req.params.testRequestId,
        labTechnicianId: req.user.id,
        status: 'assigned_to_lab'
      }
    });

    if (!testRequest) {
      return res.status(404).json({ message: 'Test request not found or not assigned to you' });
    }

    await testRequest.update({
      status: 'in_progress',
      startedAt: new Date()
    });

    logger.info(`Test ${req.params.testRequestId} started by lab tech ${req.user.id}`);

    res.json({
      message: 'Test started successfully',
      testRequest
    });

  } catch (error) {
    logger.error('Error starting test:', error);
    res.status(500).json({ message: 'Error starting test' });
  }
});

// Submit test result (manual entry)
router.post('/submit-result/manual', authenticate, requireRole(['lab_technician']),  async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const {
      testRequestId,
      results, // Array of { parameter, value, unit, normalRange, status }
      interpretation,
      methodology,
      comments,
      qualityControl
    } = req.body;

    // Verify test request belongs to this lab tech
    const testRequest = await TestRequest.findOne({
      where: {
        id: testRequestId,
        labTechnicianId: req.user.id,
        status: 'in_progress'
      },
      include: [
        { model: Patient, attributes: ['firstName', 'lastName', 'email', 'patientId'] },
        { model: Test, attributes: ['name', 'code'] }
      ]
    });

    if (!testRequest) {
      await transaction.rollback();
      return res.status(404).json({ message: 'Test request not found or not in progress' });
    }

    // Create test result
    const testResult = await TestResult.create({
      testRequestId,
      results: JSON.stringify(results),
      interpretation,
      methodology,
      comments,
      time,
      date,
      signature,
      qualityControl,
      resultType: 'manual',
      status: 'pending_doctor_review',
      labTechnicianId: req.user.id,
      submittedAt: new Date(),
      labTechnicianName: `${req.user.firstName} ${req.user.lastName}`
    }, { transaction });

    // Update test request status
    await testRequest.update({
      status: 'pending_doctor_review',
      completedAt: new Date()
    }, { transaction });

    await transaction.commit();

    // Notify doctor
    req.io.to('doctor').emit('result_submitted', {
      testRequestId,
      resultId: testResult.id,
      patientName: `${testRequest.Patient.firstName} ${testRequest.Patient.lastName}`,
      testName: testRequest.Test.name,
      submittedBy: `${req.user.firstName} ${req.user.lastName}`
    });

    logger.info(`Manual result submitted for test ${testRequestId} by lab tech ${req.user.id}`);

    res.json({
      message: 'Test result submitted successfully',
      result: testResult
    });

  } catch (error) {
    await transaction.rollback();
    logger.error('Error submitting manual result:', error);
    res.status(500).json({ message: 'Error submitting test result' });
  }
});

// Submit test result (file upload)
router.post('/submit-result/upload', 
  authenticate, 
  requireRole(['lab_technician']), 
  upload.single('resultFile'), 
  async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const {
      testRequestId,
      interpretation,
      comments,
      qualityControl
    } = req.body;

    // Verify test request
    const testRequest = await TestRequest.findOne({
      where: {
        id: testRequestId,
        labTechnicianId: req.user.id,
        status: 'in_progress'
      },
      include: [
        { model: Patient, attributes: ['firstName', 'lastName', 'patientId'] },
        { model: Test, attributes: ['name', 'code'] }
      ]
    });

    if (!testRequest) {
      await transaction.rollback();
      // Clean up uploaded file
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(404).json({ message: 'Test request not found or not in progress' });
    }

    // Create test result
    const testResult = await TestResult.create({
      time,
      date,
      signature,
      testRequestId,
      resultFilePath: req.file.path,
      resultFileName: req.file.originalname,
      interpretation,
      comments,
      qualityControl,
      resultType: 'file',
      status: 'pending_doctor_review',
      labTechnicianId: req.user.id,
      submittedAt: new Date(),
      labTechnicianName: `${req.user.firstName} ${req.user.lastName}`
    }, { transaction });

    // Update test request
    await testRequest.update({
      status: 'pending_doctor_review',
      completedAt: new Date()
    }, { transaction });

    await transaction.commit();

    // Notify doctor
    req.io.to('doctor').emit('result_submitted', {
      testRequestId,
      resultId: testResult.id,
      patientName: `${testRequest.Patient.firstName} ${testRequest.Patient.lastName}`,
      testName: testRequest.Test.name,
      submittedBy: `${req.user.firstName} ${req.user.lastName}`,
      hasFile: true
    });

    logger.info(`File result submitted for test ${testRequestId} by lab tech ${req.user.id}`);

    res.json({
      message: 'Test result uploaded successfully',
      result: testResult,
      fileName: req.file.originalname
    });

  } catch (error) {
    await transaction.rollback();
    // Clean up uploaded file on error
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    logger.error('Error uploading result:', error);
    res.status(500).json({ message: 'Error uploading test result' });
  }
});

// Update existing result (for revisions)
router.put('/update-result/:resultId', authenticate, requireRole(['lab_technician']), async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const {
      results,
      interpretation,
      methodology,
      comments,
      qualityControl
    } = req.body;

    const testResult = await TestResult.findOne({
      where: {
        id: req.params.resultId,
        labTechnicianId: req.user.id,
        status: 'needs_revision'
      },
      include: [
        {
          model: TestRequest,
          include: [
            { model: Patient, attributes: ['firstName', 'lastName'] },
            { model: Test, attributes: ['name', 'code'] }
          ]
        }
      ]
    });

    if (!testResult) {
      await transaction.rollback();
      return res.status(404).json({ message: 'Test result not found or not available for revision' });
    }

    // Update result
    await testResult.update({
      results: results ? JSON.stringify(results) : testResult.results,
      interpretation,
      methodology,
      comments,
      qualityControl,
      status: 'pending_doctor_review',
      revisedAt: new Date()
    }, { transaction });

    // Update test request status
    await testResult.TestRequest.update({
      status: 'pending_doctor_review'
    }, { transaction });

    await transaction.commit();

    // Notify doctor of revision
    req.io.to('doctor').emit('result_revised', {
      resultId: testResult.id,
      testRequestId: testResult.testRequestId,
      patientName: `${testResult.TestRequest.Patient.firstName} ${testResult.TestRequest.Patient.lastName}`,
      testName: testResult.TestRequest.Test.name
    });

    logger.info(`Result ${req.params.resultId} revised by lab tech ${req.user.id}`);

    res.json({
      message: 'Result updated successfully',
      result: testResult
    });

  } catch (error) {
    await transaction.rollback();
    logger.error('Error updating result:', error);
    res.status(500).json({ message: 'Error updating result' });
  }
});

// Get test result history
router.get('/results', authenticate, requireRole(['lab_technician']), async (req, res) => {
  try {
    const { page = 1, limit = 10, status, dateFrom, dateTo } = req.query;
    const offset = (page - 1) * limit;

    let dateFilter = {};
    if (dateFrom || dateTo) {
      dateFilter.submittedAt = {};
      if (dateFrom) dateFilter.submittedAt[Op.gte] = new Date(dateFrom);
      if (dateTo) {
        const endDate = new Date(dateTo);
        endDate.setHours(23, 59, 59, 999);
        dateFilter.submittedAt[Op.lte] = endDate;
      }
    }

    const whereClause = {
      labTechnicianId: req.user.id,
      ...dateFilter
    };
    if (status) whereClause.status = status;

    const { rows: results, count } = await TestResult.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: TestRequest,
          include: [
            { model: Patient, attributes: ['firstName', 'lastName', 'patientId'] },
            { model: Test, attributes: ['name', 'code', 'category'] },
            { model: User, as: 'Doctor', attributes: ['firstName', 'lastName'] }
          ]
        }
      ],
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['submittedAt', 'DESC']]
    });

    res.json({
      results,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        pages: Math.ceil(count / limit)
      }
    });

  } catch (error) {
    logger.error('Error fetching lab tech results:', error);
    res.status(500).json({ message: 'Error fetching results' });
  }
});

// Get specific result details
router.get('/results/:resultId', authenticate, requireRole(['lab_technician']), async (req, res) => {
  try {
    const result = await TestResult.findOne({
      where: {
        id: req.params.resultId,
        labTechnicianId: req.user.id
      },
      include: [
        {
          model: TestRequest,
          include: [
            { model: Patient, attributes: ['firstName', 'lastName', 'patientId', 'dateOfBirth'] },
            { model: Test, attributes: ['name', 'code', 'category', 'normalRange', 'units', 'methodology'] },
            { model: User, as: 'Doctor', attributes: ['firstName', 'lastName'] }
          ]
        }
      ]
    });

    if (!result) {
      return res.status(404).json({ message: 'Result not found' });
    }

    res.json(result);

  } catch (error) {
    logger.error('Error fetching result details:', error);
    res.status(500).json({ message: 'Error fetching result details' });
  }
});

// Download result file
router.get('/download-result/:resultId', authenticate, requireRole(['lab_technician', 'doctor']), async (req, res) => {
  try {
    const result = await TestResult.findOne({
      where: { id: req.params.resultId },
      include: [
        {
          model: TestRequest,
          where: req.user.role === 'lab_technician' 
            ? { labTechnicianId: req.user.id }
            : { doctorId: req.user.id }
        }
      ]
    });

    if (!result || !result.resultFilePath) {
      return res.status(404).json({ message: 'File not found' });
    }

    // Check if file exists
    try {
      await fs.access(result.resultFilePath);
    } catch (error) {
      return res.status(404).json({ message: 'File not found on server' });
    }

    res.download(result.resultFilePath, result.resultFileName);

  } catch (error) {
    logger.error('Error downloading result file:', error);
    res.status(500).json({ message: 'Error downloading file' });
  }
});

// Get workload statistics
router.get('/statistics', authenticate, requireRole(['lab_technician']), async (req, res) => {
  try {
    const { period = '7' } = req.query; // days
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(period));

    const stats = await TestRequest.findAll({
      where: {
        labTechnicianId: req.user.id,
        assignedAt: {
          [Op.gte]: startDate
        }
      },
      attributes: [
        [sequelize.fn('DATE', sequelize.col('assignedAt')), 'date'],
        'status',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      group: [
        sequelize.fn('DATE', sequelize.col('assignedAt')),
        'status'
      ],
      order: [
        [sequelize.fn('DATE', sequelize.col('assignedAt')), 'ASC']
      ],
      raw: true
    });

    // Get average completion time
    const avgCompletionTime = await TestRequest.findAll({
      where: {
        labTechnicianId: req.user.id,
        status: 'completed',
        assignedAt: {
          [Op.gte]: startDate
        }
      },
      attributes: [
        [sequelize.fn('AVG', 
          sequelize.fn('EXTRACT', 
            sequelize.literal("EPOCH FROM (completed_at - assigned_at)")
          )
        ), 'avg_seconds']
      ],
      raw: true
    });

    res.json({
      dailyStats: stats,
      avgCompletionTimeHours: avgCompletionTime[0]?.avg_seconds 
        ? Math.round(avgCompletionTime[0].avg_seconds / 3600 * 100) / 100
        : 0
    });

  } catch (error) {
    logger.error('Error fetching lab tech statistics:', error);
    res.status(500).json({ message: 'Error fetching statistics' });
  }
});

module.exports = router;