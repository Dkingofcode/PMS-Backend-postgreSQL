const express = require('express');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const PDFDocument = require('pdfkit');
const multer = require('multer');
const { Op } = require('sequelize');
const { TestResult, TestRequest, Test, Patient, User, PatientAccess, AuditLog, sequelize } = require('../models');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { sendSecureResultEmail } = require('../services/emailService');
//const { generateTwoFactorCode, verifyTwoFactorCode } = require('../utils/twoFactor');
const logger = require('../utils/logger');

const router = express.Router();

// Configure multer for file uploads
const upload = multer({ dest: path.join(__dirname, '../secure_storage/results') });

// Validation middleware for manual result submission
const validateTestResult = (req, res, next) => {
  const { testRequestId, results, labTechSignature, submittedAt } = req.body;
  if (!testRequestId || !labTechSignature || !submittedAt) {
    return res.status(400).json({ message: 'Missing required fields: testRequestId, labTechSignature, submittedAt' });
  }
  if (results && !Array.isArray(results)) {
    return res.status(400).json({ message: 'Results must be an array' });
  }
  next();
};

// Submit test result (manual entry)
router.post('/submit-result/manual', authenticateToken, requireRole(['lab_technician']), validateTestResult, async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { testRequestId, results, interpretation, methodology, comments, qualityControl, labTechSignature, submittedAt } = req.body;

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

    // Generate hash of results for tamper-evidence
    const resultData = JSON.stringify({ results, interpretation, methodology, comments, qualityControl });
    const resultHash = crypto.createHash('sha256').update(resultData).digest('hex');

    // Create test result
    const testResult = await TestResult.create({
      testRequestId,
      results,
      resultHash,
      interpretation,
      methodology,
      comments,
      qualityControl,
      labTechSignature, // Base64-encoded signature
      submittedAt: new Date(submittedAt),
      resultType: 'manual',
      status: 'submitted',
      labTechnicianId: req.user.id,
      labTechnicianName: `${req.user.firstName} ${req.user.lastName}`
    }, { transaction });

    // Update test request status
    await testRequest.update({
      status: 'pending_doctor_review',
      completedAt: new Date()
    }, { transaction });

    // Log action
    await AuditLog.create({
      userId: req.user.id,
      action: 'SUBMIT_TEST_RESULT',
      details: `Lab technician submitted manual result for test request ${testRequestId}`,
      entityId: testResult.id,
      entityType: 'TestResult'
    }, { transaction });

    await transaction.commit();

    // Notify doctor
    req.io.to('doctor').emit('result_submitted', {
      testRequestId,
      resultId: testResult.id,
      patientName: `${testRequest.Patient.firstName} ${testRequest.Patient.lastName}`,
      testName: testRequest.Test.name,
      submittedBy: testResult.labTechnicianName
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
router.post('/submit-result/upload', authenticateToken, requireRole(['lab_technician']), upload.single('resultFile'), async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    if (!req.file) {
      await transaction.rollback();
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const { testRequestId, interpretation, comments, qualityControl, labTechSignature, submittedAt } = req.body;

    if (!testRequestId || !labTechSignature || !submittedAt) {
      await fs.unlink(req.file.path).catch(() => {});
      await transaction.rollback();
      return res.status(400).json({ message: 'Missing required fields: testRequestId, labTechSignature, submittedAt' });
    }

    // Verify test request
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
      await fs.unlink(req.file.path).catch(() => {});
      await transaction.rollback();
      return res.status(404).json({ message: 'Test request not found or not in progress' });
    }

    // Generate hash of file for tamper-evidence
    const fileContent = await fs.readFile(req.file.path);
    const resultHash = crypto.createHash('sha256').update(fileContent).digest('hex');

    // Create test result
    const testResult = await TestResult.create({
      testRequestId,
      resultFilePath: req.file.path,
      resultHash,
      interpretation,
      comments,
      qualityControl,
      labTechSignature, // Base64-encoded signature
      submittedAt: new Date(submittedAt),
      resultType: 'file',
      status: 'submitted',
      labTechnicianId: req.user.id,
      labTechnicianName: `${req.user.firstName} ${req.user.lastName}`
    }, { transaction });

    // Update test request
    await testRequest.update({
      status: 'pending_doctor_review',
      completedAt: new Date()
   

}, { transaction });

    // Log action
    await AuditLog.create({
      userId: req.user.id,
      action: 'SUBMIT_TEST_RESULT',
      details: `Lab technician uploaded result file for test request ${testRequestId}`,
      entityId: testResult.id,
      entityType: 'TestResult'
    }, { transaction });

    await transaction.commit();

    // Notify doctor
    req.io.to('doctor').emit('result_submitted', {
      testRequestId,
      resultId: testResult.id,
      patientName: `${testRequest.Patient.firstName} ${testRequest.Patient.lastName}`,
      testName: testRequest.Test.name,
      submittedBy: testResult.labTechnicianName,
      hasFile: true
    });

    logger.info(`File result submitted for test ${testRequestId} by lab tech ${req.user.id}`);

    res.json({
      message: 'Test result uploaded successfully',
      result: testResult,
      fileName: req.file.originalname
    });
  } catch (error) {
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    await transaction.rollback();
    logger.error('Error uploading result:', error);
    res.status(500).json({ message: 'Error uploading test result' });
  }
});

// Review and approve test result
router.post('/approve-result', authenticateToken, requireRole(['doctor']), async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { resultId, status, remarks, doctorSignature } = req.body;

    if (!['approved', 'rejected', 'needs_revision'].includes(status)) {
      await transaction.rollback();
      return res.status(400).json({ message: 'Invalid status' });
    }

    if (status === 'approved' && !doctorSignature) {
      await transaction.rollback();
      return res.status(400).json({ message: 'Doctor signature required for approval' });
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
      return res.status(404).json({ message: 'Test result not found or access denied' });
    }

    if (testResult.status !== 'submitted') {
      await transaction.rollback();
      return res.status(400).json({ message: 'Result not in submitted state' });
    }

    let finalFilePath = null;
    if (status === 'approved') {
      // Generate final PDF with signatures and stamps
      const doc = new PDFDocument();
      const fileName = `approved_result_${crypto.randomUUID()}.pdf`;
      finalFilePath = path.join(__dirname, '../secure_storage/results', fileName);
      const writeStream = fs.createWriteStream(finalFilePath);

      doc.pipe(writeStream);
      doc.fontSize(12).text(`Test Result: ${testResult.TestRequest.Test.name}`, { align: 'center' });
      doc.text(`Patient: ${testResult.TestRequest.Patient.firstName} ${testResult.TestRequest.Patient.lastName}`);
      doc.text(`Patient ID: ${testResult.TestRequest.Patient.patientId}`);
      doc.text(`Test Code: ${testResult.TestRequest.Test.code}`);
      if (testResult.resultType === 'manual') {
        doc.text('Results:');
        testResult.results.forEach(result => {
          doc.text(`- ${result.parameter}: ${result.value} ${result.unit} (${result.normalRange})`);
        });
      } else {
        doc.text(`Result File: ${path.basename(testResult.resultFilePath)}`);
      }
      doc.text(`Interpretation: ${testResult.interpretation || 'None'}`);
      doc.text(`Comments: ${testResult.comments || 'None'}`);
      doc.text(`Quality Control: ${testResult.qualityControl || 'None'}`);
      doc.text(`Lab Technician: ${testResult.labTechnicianName}`);
      doc.text(`Submission Date: ${testResult.submittedAt.toISOString().split('T')[0]}`);
      doc.text(`Submission Time: ${testResult.submittedAt.toTimeString().split(' ')[0]}`);
      if (testResult.labTechSignature) {
        doc.text('Lab Technician Signature:');
        doc.image(Buffer.from(testResult.labTechSignature, 'base64'), { width: 100 });
      }
      doc.text(`Doctor: Dr. ${req.user.firstName} ${req.user.lastName}`);
      doc.text(`Approval Date: ${new Date().toISOString().split('T')[0]}`);
      doc.text(`Approval Time: ${new Date().toTimeString().split(' ')[0]}`);
      doc.text('Doctor Signature:');
      doc.image(Buffer.from(doctorSignature, 'base64'), { width: 100 });
      doc.text(`Result Hash: ${testResult.resultHash}`);
      doc.end();

      await new Promise((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });

      // Verify original hash
      if (testResult.resultType === 'file') {
        const fileContent = await fs.readFile(testResult.resultFilePath);
        const currentHash = crypto.createHash('sha256').update(fileContent).digest('hex');
        if (currentHash !== testResult.resultHash) {
          await fs.unlink(finalFilePath).catch(() => {});
          await transaction.rollback();
          return res.status(400).json({ message: 'Result file tampered' });
        }
      } else {
        const resultData = JSON.stringify({
          results: testResult.results,
          interpretation: testResult.interpretation,
          methodology: testResult.methodology,
          comments: testResult.comments,
          qualityControl: testResult.qualityControl
        });
        const currentHash = crypto.createHash('sha256').update(resultData).digest('hex');
        if (currentHash !== testResult.resultHash) {
          await fs.unlink(finalFilePath).catch(() => {});
          await transaction.rollback();
          return res.status(400).json({ message: 'Result data tampered' });
        }
      }
    }

    // Update result
    await testResult.update({
      status,
      doctorRemarks: remarks,
      doctorSignature: status === 'approved' ? doctorSignature : null,
      approvedBy: status === 'approved' ? req.user.id : null,
      approvedAt: status === 'approved' ? new Date() : null,
      doctorName: status === 'approved' ? `Dr. ${req.user.firstName} ${req.user.lastName}` : null,
      resultFilePath: status === 'approved' ? finalFilePath : testResult.resultFilePath
    }, { transaction });

    // Update test request status
    const newRequestStatus = status === 'approved' ? 'completed' : 
                           status === 'rejected' ? 'rejected' : 'needs_revision';
    await testResult.TestRequest.update({
      status: newRequestStatus,
      completedAt: status === 'approved' ? new Date() : null
    }, { transaction });

    // // Create 2FA access for patient if approved
     let patientAccess = null;
    if (status === 'approved') {
    //   const twoFactorCode = generateTwoFactorCode();
    //   patientAccess = await PatientAccess.create({
    //     patientId: testResult.TestRequest.patientId,
    //     testResultId: resultId,
    //     accessCode: twoFactorCode,
    //     expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
    //   }, { transaction });

      // Send secure email
      await sendSecureResultEmail({
        to: testResult.TestRequest.Patient.email,
        patientName: `${testResult.TestRequest.Patient.firstName} ${testResult.TestRequest.Patient.lastName}`,
        subject: 'Your Test Result is Ready',
        body: `Your test result for ${testResult.TestRequest.Test.name} is ready. Access it at: ${process.env.FRONTEND_URL}/results/${resultId}/access using code: ${twoFactorCode}`
      });
    }

    // Log action
    await AuditLog.create({
      userId: req.user.id,
      action: status === 'approved' ? 'APPROVE_TEST_RESULT' : `TEST_RESULT_${status.toUpperCase()}`,
      details: `Doctor ${status} result ${resultId}`,
      entityId: resultId,
      entityType: 'TestResult'
    }, { transaction });

    await transaction.commit();

    // Send notifications
    if (status === 'approved') {
      // Notify patient
      req.io.to('patient').emit('result_approved', {
        patientId: testResult.TestRequest.patientId,
        testName: testResult.TestRequest.Test.name,
        patientName: `${testResult.TestRequest.Patient.firstName} ${testResult.TestRequest.Patient.lastName}`,
        resultId
      });
    } else {
      // Notify lab technician
      req.io.to('lab_technician').emit('result_revision_needed', {
        resultId,
        status,
        remarks,
        testName: testResult.TestRequest.Test.name
      });
    }

    res.json({
      message: `Result ${status} successfully`,
      result: testResult,
      ...(status === 'approved' && { accessCode: patientAccess?.accessCode })
    });
  } catch (error) {
    if (finalFilePath) {
      await fs.unlink(finalFilePath).catch(() => {});
    }
    await transaction.rollback();
    logger.error('Error processing result approval:', error);
    res.status(500).json({ message: 'Error processing result approval' });
  }
});

// Access result with 2FA (Patient)
router.post('/:id/access', authenticateToken, requireRole(['patient']), async (req, res) => {
  try {
    const { id } = req.params;
    const { accessCode } = req.body;

    const testResult = await TestResult.findByPk(id, {
      include: [{
        model: TestRequest,
        include: [{ model: Patient }]
      }]
    });

    if (!testResult || testResult.TestRequest.patientId !== req.user.patientId || testResult.status !== 'approved') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const patientAccess = await PatientAccess.findOne({
      where: {
        testResultId: id,
        patientId: req.user.patientId,
        expiresAt: { [Op.gt]: new Date() }
      }
    });

    if (!patientAccess || !verifyTwoFactorCode(accessCode, patientAccess.accessCode)) {
      return res.status(401).json({ message: 'Invalid or expired access code' });
    }

    // Verify hash
    if (testResult.resultType === 'file') {
 
        const fileContent = await fs.readFile(testResult.resultFilePath);
        const currentHash = crypto.createHash('sha256').update(fileContent).digest('hex');
        if (currentHash !== testResult.resultHash) {
          return res.status(400).json({ message: 'Result file tampered' });
        }
      } else {
        const resultData = JSON.stringify({
          results: testResult.results,
          interpretation: testResult.interpretation,
          methodology: testResult.methodology,
          comments:린다testResult.comments,
          qualityControl: testResult.qualityControl
        });
        const currentHash = crypto.createHash('sha256').update(resultData).digest('hex');
        if (currentHash !== testResult.resultHash) {
          return res.status(400).json({ message: 'Result data tampered' });
        }
      }

    // Serve approved result file
    const filePath = testResult.resultFilePath;
    if (!filePath || !await fs.access(filePath).then(() => true).catch(() => false)) {
      return res.status(404).json({ message: 'Result file not found' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=result_${id}.pdf`);
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

    // Log access
    await AuditLog.create({
      userId: req.user.id,
      action: 'ACCESS_TEST_RESULT',
      details: `Patient accessed result ${id}`,
      entityId: id,
      entityType: 'TestResult'
    });
  } catch (error) {
    logger.error('Error accessing result:', error);
    res.status(500).json({ message: 'Error accessing result' });
  }
});

// Get results (role-based access)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 10, status, patientId, dateFrom, dateTo } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = {};
    let includeClause = [
      {
        model: TestRequest,
        include: [
          { model: Patient, attributes: ['firstName', 'lastName', 'patientId'] },
          { model: Test, attributes: ['name', 'code', 'category'] }
        ]
      }
    ];

    // Role-based filtering
    if (req.user.role === 'doctor') {
      includeClause[0].where = { doctorId: req.user.id };
    } else if (req.user.role === 'lab_technician') {
      whereClause.labTechnicianId = req.user.id;
    } else if (req.user.role === 'patient') {
      includeClause[0].include[0].where = { id: req.user.patientId };
      whereClause.status = 'approved';
    }

    // Additional filters
    if (status) whereClause.status = status;
    if (patientId && ['admin', 'doctor'].includes(req.user.role)) {
      includeClause[0].where = { ...includeClause[0].where, patientId };
    }

    // Date range filter
    if (dateFrom || dateTo) {
      whereClause.submittedAt = {};
      if (dateFrom) whereClause.submittedAt[Op.gte] = new Date(dateFrom);
      if (dateTo) {
        const endDate = new Date(dateTo);
        endDate.setHours(23, 59, 59, 999);
        whereClause.submittedAt[Op.lte] = endDate;
      }
    }

    const { rows: results, count } = await TestResult.findAndCountAll({
      where: whereClause,
      include: includeClause,
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
    logger.error('Error fetching results:', error);
    res.status(500).json({ message: 'Error fetching results' });
  }
});

// Get specific result details
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    let whereClause = { id: req.params.id };
    let includeClause = [
      {
        model: TestRequest,
        include: [
          { 
            model: Patient, 
            attributes: ['firstName', 'lastName', 'patientId', 'dateOfBirth', 'phone', 'email'] 
          },
          { 
            model: Test, 
            attributes: ['name', 'code', 'category', 'normalRange', 'units', 'methodology'] 
          },
          { 
            model: User, 
            as: 'Doctor', 
            attributes: ['firstName', 'lastName'] 
          }
        ]
      }
    ];

    // Role-based access control
    if (req.user.role === 'doctor') {
      includeClause[0].where = { doctorId: req.user.id };
    } else if (req.user.role === 'lab_technician') {
      whereClause.labTechnicianId = req.user.id;
    } else if (req.user.role === 'patient') {
      includeClause[0].include[0].where = { id: req.user.patientId };
      whereClause.status = 'approved';
    }

    const result = await TestResult.findOne({
      where: whereClause,
      include: includeClause
    });

    if (!result) {
      return res.status(404).json({ message: 'Result not found or access denied' });
    }

    res.json(result);
  } catch (error) {
    logger.error('Error fetching result:', error);
    res.status(500).json({ message: 'Error fetching result' });
  }
});

module.exports = router;