// const express = require('express');
// const crypto = require('crypto');
// const fs = require('fs').promises;
// const path = require('path');
// const PDFDocument = require('pdfkit');
// const { Op } = require('sequelize');
// const { TestResult, TestRequest, Test, Patient, User, PatientAccess, AuditLog, sequelize } = require('../models');
// const { authenticateToken, requireRole } = require('../middleware/auth');
// const { sendSecureResultEmail } = require('../services/emailService');
// const { generateTwoFactorCode, verifyTwoFactorCode } = require('../utils/twoFactor');
// const logger = require('../utils/logger');

// const router = express.Router();

// // Get results (role-based access)
// router.get('/', authenticateToken, async (req, res) => {
//   try {
//     const { page = 1, limit = 10, status, patientId, dateFrom, dateTo } = req.query;
//     const offset = (page - 1) * limit;

//     let whereClause = {};
//     let includeClause = [
//       {
//         model: TestRequest,
//         include: [
//           { model: Patient, attributes: ['firstName', 'lastName', 'patientId'] },
//           { model: Test, attributes: ['name', 'code', 'category'] }
//         ]
//       }
//     ];

//     // Role-based filtering
//     if (req.user.role === 'doctor') {
//       includeClause[0].where = { doctorId: req.user.id };
//     } else if (req.user.role === 'lab_technician') {
//       whereClause.labTechnicianId = req.user.id;
//     } else if (req.user.role === 'patient') {
//       includeClause[0].include[0].where = { id: req.user.patientId };
//       whereClause.status = 'approved'; // Patients only see approved results
//     }

//     // Additional filters
//     if (status) whereClause.status = status;
//     if (patientId && ['admin', 'doctor'].includes(req.user.role)) {
//       includeClause[0].where = { ...includeClause[0].where, patientId };
//     }

//     // Date range filter
//     if (dateFrom || dateTo) {
//       whereClause.submittedAt = {};
//       if (dateFrom) whereClause.submittedAt[Op.gte] = new Date(dateFrom);
//       if (dateTo) {
//         const endDate = new Date(dateTo);
//         endDate.setHours(23, 59, 59, 999);
//         whereClause.submittedAt[Op.lte] = endDate;
//       }
//     }

//     const { rows: results, count } = await TestResult.findAndCountAll({
//       where: whereClause,
//       include: includeClause,
//       limit: parseInt(limit),
//       offset: parseInt(offset),
//       order: [['submittedAt', 'DESC']]
//     });

//     res.json({
//       results,
//       pagination: {
//         page: parseInt(page),
//         limit: parseInt(limit),
//         total: count,
//         pages: Math.ceil(count / limit)
//       }
//     });
//   } catch (error) {
//     logger.error('Error fetching results:', error);
//     res.status(500).json({ message: 'Error fetching results' });
//   }
// });

// // Get specific result details
// router.get('/:id', authenticateToken, async (req, res) => {
//   try {
//     let whereClause = { id: req.params.id };
//     let includeClause = [
//       {
//         model: TestRequest,
//         include: [
//           { 
//             model: Patient, 
//             attributes: ['firstName', 'lastName', 'patientId', 'dateOfBirth', 'phone', 'email'] 
//           },
//           { 
//             model: Test, 
//             attributes: ['name', 'code', 'category', 'normalRange', 'units', 'methodology'] 
//           },
//           { 
//             model: User, 
//             as: 'Doctor', 
//             attributes: ['firstName', 'lastName'] 
//           }
//         ]
//       }
//     ];

//     // Role-based access control
//     if (req.user.role === 'doctor') {
//       includeClause[0].where = { doctorId: req.user.id };
//     } else if (req.user.role === 'lab_technician') {
//       whereClause.labTechnicianId = req.user.id;
//     } else if (req.user.role === 'patient') {
//       includeClause[0].include[0].where = { id: req.user.patientId };
//       whereClause.status = 'approved'; // Patients only see approved results
//     }

//     const result = await TestResult.findOne({
//       where: whereClause,
//       include: includeClause
//     });

//     if (!result) {
//       return res.status(404).json({ message: 'Result not found or access denied' });
//     }

//     res.json(result);
//   } catch (error) {
//     logger.error('Error fetching result:', error);
//     res.status(500).json({ message: 'Error fetching result' });
//   }
// });

// // Lab Technician: Upload test result
// router.post('/:testRequestId/upload', authenticateToken, requireRole('lab_technician'), async (req, res) => {
//   const transaction = await sequelize.transaction();
//   try {
//     const { testRequestId } = req.params;
//     const { resultData, resultFile } = req.body; // resultFile is base64-encoded PDF, if provided

//     const testRequest = await TestRequest.findByPk(testRequestId, {
//       include: [{ model: Patient }, { model: Test }]
//     });

//     if (!testRequest) {
//       await transaction.rollback();
//       return res.status(404).json({ message: 'Test request not found' });
//     }

//     let resultPath = null;
//     if (resultFile) {
//       // Save PDF to secure storage
//       const fileName = `result_${crypto.randomUUID()}.pdf`;
//       const filePath = path.join(__dirname, '../secure_storage/results', fileName);
//       const buffer = Buffer.from(resultFile, 'base64');
//       await fs.writeFile(filePath, buffer);
//       resultPath = filePath;
//     }

//     const testResult = await TestResult.create({
//       testRequestId,
//       labTechnicianId: req.user.id,
//       resultData: resultData || null,
//       resultFilePath: resultPath,
//       status: 'pending',
//       submittedAt: new Date()
//     }, { transaction });

//     // Log action
//     await AuditLog.create({
//       userId: req.user.id,
//       action: 'UPLOAD_TEST_RESULT',
//       details: `Lab technician uploaded result for test request ${testRequestId}`,
//       entityId: testResult.id,
//       entityType: 'TestResult'
//     }, { transaction });

//     // Notify doctor
//     req.io.to('doctor').emit('new-result', {
//       testRequestId,
//       patientId: testRequest.patientId,
//       testId: testRequest.testId
//     });

//     await transaction.commit();
//     res.status(201).json({ message: 'Result uploaded successfully', testResult });
//   } catch (error) {
//     await transaction.rollback();
//     logger.error('Error uploading result:', error);
//     res.status(500).json({ message: 'Error uploading result' });
//   }
// });

// // Doctor: Review and approve result
// router.put('/:id/approve', authenticateToken, requireRole('doctor'), async (req, res) => {
//   const transaction = await sequelize.transaction();
//   try {
//     const { id } = req.params;
//     const { remarks, signature, dateStamp, timeStamp, nameStamp,  } = req.body; // signature is base64-encoded image

//     const testResult = await TestResult.findByPk(id, {
//       include: [{
//         model: TestRequest,
//         include: [{ model: Patient }, { model: Test }, { model: User, as: 'Doctor' }]
//       }]
//     });

//     if (!testResult || testResult.TestRequest.doctorId !== req.user.id) {
//       await transaction.rollback();
//       return res.status(404).json({ message: 'Result not found or access denied' });
//     }

//     if (testResult.status !== 'pending') {
//       await transaction.rollback();
//       return res.status(400).json({ message: 'Result already processed' });
//     }

//     // Generate PDF with signature
//     const doc = new PDFDocument();
//     const fileName = `approved_result_${crypto.randomUUID()}.pdf`;
//     const filePath = path.join(__dirname, '../secure_storage/results', fileName);
//     const writeStream = fs.createWriteStream(filePath);

//     doc.pipe(writeStream);
//     doc.text(`Patient: ${testResult.TestRequest.Patient.firstName} ${testResult.TestRequest.Patient.lastName}`);
//     doc.text(`Test: ${testResult.TestRequest.Test.name}`);
//     doc.text(`Result: ${testResult.resultData || 'See attached file'}`);
//     doc.text(`Doctor Remarks: ${remarks || 'None'}`);
//     doc.text(`Doctor: ${req.user.firstName} ${req.user.lastName}`);
//     doc.text(`Date: ${new Date().toISOString()}`);
//     doc.text(`Time: ${new Date().toISOString()}`); 
//     if (signature) {
//       doc.image(Buffer.from(signature, 'base64'), { width: 100 });
//     }
//      if (dateStamp) {
//       doc.image(Buffer.from(signature, 'base64'), { width: 100 });
//     }
//      if (timeStamp) {
//       doc.image(Buffer.from(signature, 'base64'), { width: 100 });
//     }
//      if (nameStamp) {
//       doc.image(Buffer.from(signature, 'base64'), { width: 100 });
//     }
//     doc.end();

//     await new Promise((resolve, reject) => {
//       writeStream.on('finish', resolve);
//       writeStream.on('error', reject);
//     });

//     // Update result
//     await testResult.update({
//       status: 'approved',
//       remarks,
//       approvedAt: new Date(),
//       approvedBy: req.user.id,
//       approvedResultFilePath: filePath
//     }, { transaction });

//     // Log action
//     await AuditLog.create({
//       userId: req.user.id,
//       action: 'APPROVE_TEST_RESULT',
//       details: `Doctor approved result ${id}`,
//       entityId: id,
//       entityType: 'TestResult'
//     }, { transaction });

//     // Generate 2FA code for patient
//     const twoFactorCode = generateTwoFactorCode();
//     await PatientAccess.create({
//       patientId: testResult.TestRequest.patientId,
//       testResultId: id,
//       accessCode: twoFactorCode,
//       expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
//     }, { transaction });

//     // Send secure email
//     await sendSecureResultEmail({
//       to: testResult.TestRequest.Patient.email,
//       patientName: `${testResult.TestRequest.Patient.firstName} ${testResult.TestRequest.Patient.lastName}`,
//       testName: testResult.TestRequest.Test.name,
//       accessCode: twoFactorCode,
//       resultUrl: `${process.env.FRONTEND_URL}/results/${id}/access`
//     });

//     // Notify patient
//     req.io.to('patient').emit('new-result', { resultId: id });

//     await transaction.commit();
//     res.json({ message: 'Result approved and sent to patient' });
//   } catch (error) {
//     await transaction.rollback();
//     logger.error('Error approving result:', error);
//     res.status(500).json({ message: 'Error approving result' });
//   }
// });

// // Patient: Access result with 2FA
// router.post('/:id/access', authenticateToken, requireRole('patient'), async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { accessCode } = req.body;

//     const testResult = await TestResult.findByPk(id, {
//       include: [{
//         model: TestRequest,
//         include: [{ model: Patient }]
//       }]
//     });

//     if (!testResult || testResult.TestRequest.patientId !== req.user.patientId || testResult.status !== 'approved') {
//       return res.status(403).json({ message: 'Access denied' });
//     }

//     const patientAccess = await PatientAccess.findOne({
//       where: {
//         testResultId: id,
//         patientId: req.user.patientId,
//         expiresAt: { [Op.gt]: new Date() }
//       }
//     });

//     if (!patientAccess || !verifyTwoFactorCode(accessCode, patientAccess.accessCode)) {
//       return res.status(401).json({ message: 'Invalid or expired access code' });
//     }

//     // Serve approved result file
//     const filePath = testResult.approvedResultFilePath;
//     if (!filePath || !await fs.access(filePath).then(() => true).catch(() => false)) {
//       return res.status(404).json({ message: 'Result file not found' });
//     }

//     res.setHeader('Content-Type', 'application/pdf');
//     res.setHeader('Content-Disposition', `attachment; filename=result_${id}.pdf`);
//     const fileStream = fs.createReadStream(filePath);
//     fileStream.pipe(res);

//     // Log access
//     await AuditLog.create({
//       userId: req.user.id,
//       action: 'ACCESS_TEST_RESULT',
//       details: `Patient accessed result ${id}`,
//       entityId: id,
//       entityType: 'TestResult'
//     });
//   } catch (error) {
//     logger.error('Error accessing result:', error);
//     res.status(500).json({ message: 'Error accessing result' });
//   }
// });

// module.exports = router;