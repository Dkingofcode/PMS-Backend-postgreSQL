// routes/doctors.js
const express = require('express');
const { Op } = require('sequelize');
const { Patient, Test, TestRequest, User, TestResult, sequelize } = require('../models');
const { authenticateToken, requireRole } = require('../middleware/auth');
const logger = require('../utils/logger');
const { validateTestAssignment } = require('../middleware/validation');
//const { requireRole } = require("../middleware/validation");


const router = express.Router();

// Get doctor's dashboard data
router.get('/dashboard', authenticateToken, requireRole(['doctor']), async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Get today's assigned patients
    const assignedPatients = await TestRequest.findAll({
      where: {
        doctorId: req.user.id,
        status: {
          [Op.in]: ['pending', 'assigned_to_lab', 'in_progress']
        },
        createdAt: {
          [Op.between]: [today, tomorrow]
        }
      },
      include: [
        {
          model: Patient,
          attributes: ['id', 'firstName', 'lastName', 'patientId', 'category', 'phone', 'email']
        },
        {
          model: Test,
          attributes: ['id', 'name', 'code', 'category', 'normalRange', 'units']
        }
      ],
      order: [['createdAt', 'ASC']]
    });

    // Get pending results for review
    const pendingResults = await TestResult.findAll({
      include: [
        {
          model: TestRequest,
          where: { doctorId: req.user.id },
          include: [
            { model: Patient, attributes: ['firstName', 'lastName', 'patientId'] },
            { model: Test, attributes: ['name', 'code'] }
          ]
        }
      ],
      where: {
        status: 'pending_doctor_review'
      },
      order: [['createdAt', 'DESC']]
    });

    // Get statistics
    const stats = await TestRequest.findAll({
      where: {
        doctorId: req.user.id,
        createdAt: {
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

    res.json({
      assignedPatients,
      pendingResults,
      stats: {
        pending: statsMap.pending || 0,
        assignedToLab: statsMap.assigned_to_lab || 0,
        inProgress: statsMap.in_progress || 0,
        completed: statsMap.completed || 0
      }
    });

  } catch (error) {
    logger.error('Error fetching doctor dashboard:', error);
    res.status(500).json({ message: 'Error fetching dashboard data' });
  }
});

// Get all patients assigned to doctor
router.get('/patients', authenticateToken, requireRole(['doctor']), async (req, res) => {
  try {
    const { page = 1, limit = 10, status, search } = req.query;
    const offset = (page - 1) * limit;

    const whereClause = { doctorId: req.user.id };
    if (status) whereClause.status = status;

    let patientWhere = {};
    if (search) {
      patientWhere = {
        [Op.or]: [
          { firstName: { [Op.iLike]: `%${search}%` } },
          { lastName: { [Op.iLike]: `%${search}%` } },
          { patientId: { [Op.iLike]: `%${search}%` } }
        ]
      };
    }

    const { rows: testRequests, count } = await TestRequest.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: Patient,
          where: patientWhere,
          attributes: ['id', 'firstName', 'lastName', 'patientId', 'category', 'phone', 'email', 'dateOfBirth']
        },
        {
          model: Test,
          attributes: ['id', 'name', 'code', 'category']
        }
      ],
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['createdAt', 'DESC']]
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
    logger.error('Error fetching doctor patients:', error);
    res.status(500).json({ message: 'Error fetching patients' });
  }
});

// Get specific patient details with test history
router.get('/patients/:patientId', authenticateToken, requireRole(['doctor']), async (req, res) => {
  try {
    const patient = await Patient.findByPk(req.params.patientId, {
      include: [
        {
          model: TestRequest,
          where: { doctorId: req.user.id },
          include: [
            { model: Test, attributes: ['name', 'code', 'category'] },
            { model: TestResult, required: false }
          ],
          order: [['createdAt', 'DESC']]
        }
      ]
    });

    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }

    res.json(patient);

  } catch (error) {
    logger.error('Error fetching patient details:', error);
    res.status(500).json({ message: 'Error fetching patient details' });
  }
});

// Assign test to lab technician
router.post('/assign-test', authenticateToken, requireRole(['doctor']), validateTestAssignment, async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { testRequestId, labTechnicianId, remarks, priority = 'normal' } = req.body;

    // Verify the test request belongs to this doctor
    const testRequest = await TestRequest.findOne({
      where: {
        id: testRequestId,
        doctorId: req.user.id
      }
    });

    if (!testRequest) {
      await transaction.rollback();
      return res.status(404).json({ message: 'Test request not found' });
    }

    // Verify lab technician exists
    const labTech = await User.findOne({
      where: {
        id: labTechnicianId,
        role: 'lab_technician'
      }
    });

    if (!labTech) {
      await transaction.rollback();
      return res.status(404).json({ message: 'Lab technician not found' });
    }

    // Update test request
    await testRequest.update({
      labTechnicianId,
      status: 'assigned_to_lab',
      doctorRemarks: remarks,
      priority,
      assignedAt: new Date()
    }, { transaction });

    await transaction.commit();

    // Real-time notification to lab technician
    req.io.to('lab_technician').emit('test_assigned', {
      testRequestId,
      patientName: `${testRequest.Patient?.firstName} ${testRequest.Patient?.lastName}`,
      testName: testRequest.Test?.name,
      priority,
      assignedBy: `Dr. ${req.user.firstName} ${req.user.lastName}`
    });

    logger.info(`Test ${testRequestId} assigned to lab tech ${labTechnicianId} by doctor ${req.user.id}`);

    res.json({
      message: 'Test assigned successfully',
      testRequest: await TestRequest.findByPk(testRequestId, {
        include: [
          { model: Patient, attributes: ['firstName', 'lastName', 'patientId'] },
          { model: Test, attributes: ['name', 'code'] },
          { model: User, as: 'LabTechnician', attributes: ['firstName', 'lastName'] }
        ]
      })
    });

  } catch (error) {
    await transaction.rollback();
    logger.error('Error assigning test:', error);
    res.status(500).json({ message: 'Error assigning test' });
  }
});

// Get available lab technicians
router.get('/lab-technicians', authenticateToken, requireRole(['doctor']), async (req, res) => {
  try {
    const labTechs = await User.findAll({
      where: {
        role: 'lab_technician',
        isActive: true
      },
      attributes: ['id', 'firstName', 'lastName', 'email', 'specialization'],
      order: [['firstName', 'ASC']]
    });

    res.json(labTechs);

  } catch (error) {
    logger.error('Error fetching lab technicians:', error);
    res.status(500).json({ message: 'Error fetching lab technicians' });
  }
});

// Review and approve test result
router.post('/approve-result', authenticateToken, requireRole(['doctor']), async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { resultId, status, remarks, digitalSignature } = req.body;

    if (!['approved', 'rejected', 'needs_revision'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const testResult = await TestResult.findOne({
      where: { id: resultId },
      include: [
        {
          model: TestRequest,
          where: { doctorId: req.user.id },
          include: [
            { model: Patient, attributes: ['firstName', 'lastName', 'email', 'patientId'] },
            { model: Test, attributes: ['name', 'code'] }
          ]
        }
      ]
    });

    if (!testResult) {
      await transaction.rollback();
      return res.status(404).json({ message: 'Test result not found' });
    }

    // Update result
    await testResult.update({
      status: status === 'approved' ? 'approved' : status,
      doctorRemarks: remarks,
      approvedBy: status === 'approved' ? req.user.id : null,
      approvedAt: status === 'approved' ? new Date() : null,
      digitalSignature: status === 'approved' ? digitalSignature : null,
      doctorName: status === 'approved' ? `Dr. ${req.user.firstName} ${req.user.lastName}` : null
    }, { transaction });

    // Update test request status
    const newRequestStatus = status === 'approved' ? 'completed' : 
                           status === 'rejected' ? 'rejected' : 'needs_revision';
    
    await testResult.TestRequest.update({
      status: newRequestStatus,
      completedAt: status === 'approved' ? new Date() : null
    }, { transaction });

    await transaction.commit();

    // Send notifications
    if (status === 'approved') {
      // Notify patient
      req.io.emit('result_approved', {
        patientId: testResult.TestRequest.Patient.id,
        testName: testResult.TestRequest.Test.name,
        patientName: `${testResult.TestRequest.Patient.firstName} ${testResult.TestRequest.Patient.lastName}`
      });

      // TODO: Send email to patient with secure link
      logger.info(`Result approved for patient ${testResult.TestRequest.Patient.patientId}`);
    } else {
      // Notify lab technician for revision/rejection
      req.io.to('lab_technician').emit('result_revision_needed', {
        resultId,
        status,
        remarks,
        testName: testResult.TestRequest.Test.name
      });
    }

    res.json({
      message: `Result ${status} successfully`,
      result: testResult
    });

  } catch (error) {
    await transaction.rollback();
    logger.error('Error approving result:', error);
    res.status(500).json({ message: 'Error processing result approval' });
  }
});

// Get pending results for review
router.get('/pending-results', authenticateToken, requireRole(['doctor']), async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    const { rows: results, count } = await TestResult.findAndCountAll({
      where: {
        status: 'pending_doctor_review'
      },
      include: [
        {
          model: TestRequest,
          where: { doctorId: req.user.id },
          include: [
            { model: Patient, attributes: ['firstName', 'lastName', 'patientId'] },
            { model: Test, attributes: ['name', 'code', 'normalRange', 'units'] },
            { model: User, as: 'LabTechnician', attributes: ['firstName', 'lastName'] }
          ]
        }
      ],
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['createdAt', 'ASC']]
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
    logger.error('Error fetching pending results:', error);
    res.status(500).json({ message: 'Error fetching pending results' });
  }
});

// Add remarks to test request
router.put('/test-request/:id/remarks', authenticateToken, requireRole(['doctor']), async (req, res) => {
  try {
    const { remarks } = req.body;

    const testRequest = await TestRequest.findOne({
      where: {
        id: req.params.id,
        doctorId: req.user.id
      }
    });

    if (!testRequest) {
      return res.status(404).json({ message: 'Test request not found' });
    }

    await testRequest.update({ doctorRemarks: remarks });

    res.json({
      message: 'Remarks updated successfully',
      testRequest
    });

  } catch (error) {
    logger.error('Error updating remarks:', error);
    res.status(500).json({ message: 'Error updating remarks' });
  }
});

module.exports = router;