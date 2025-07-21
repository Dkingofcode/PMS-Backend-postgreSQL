const express = require('express');
const multer = require('multer');
const csv = require('csv-parse');
const ExcelJS = require('exceljs');
const { sequelize, Patient, Test, TestRequest, AuditLog } = require('../models');
const { authenticateToken, requireRole } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Configure multer for file uploads
const upload = multer({ storage: multer.memoryStorage() });

// Import patient data (CSV/Excel)
router.post('/patients', authenticateToken, requireRole('admin'), upload.single('file'), async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    if (!req.file) {
      await transaction.rollback();
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const fileType = req.file.mimetype;
    const patients = [];

    if (fileType === 'text/csv') {
      // Parse CSV
      const parser = csv.parse({ columns: true, trim: true });
      const stream = require('stream');
      const bufferStream = new stream.PassThrough();
      bufferStream.end(req.file.buffer);

      bufferStream
        .pipe(parser)
        .on('data', (row) => {
          patients.push({
            firstName: row.firstName,
            lastName: row.lastName,
            patientId: row.patientId,
            dateOfBirth: row.dateOfBirth ? new Date(row.dateOfBirth) : null,
            email: row.email,
            phone: row.phone,
            category: row.category // e.g., Walk-in, Referred, Corporate
          });
        })
        .on('end', async () => {
          try {
            // Validate and insert patients
            const validCategories = ['Walk-in', 'Referred', 'Doctor referral', 'Corporate', 'Hospital', 'HMO'];
            const errors = [];
            for (const patient of patients) {
              if (!patient.firstName || !patient.lastName || !patient.patientId || !validCategories.includes(patient.category)) {
                errors.push(`Invalid data for patient ${patient.patientId}`);
                continue;
              }
              await Patient.create(patient, { transaction });
            }

            // Log import action
            await AuditLog.create({
              userId: req.user.id,
              action: 'IMPORT_PATIENTS',
              details: `Imported ${patients.length} patients, ${errors.length} errors`,
              entityType: 'Patient'
            }, { transaction });

            await transaction.commit();
            res.json({ message: `Imported ${patients.length} patients`, errors });
          } catch (error) {
            await transaction.rollback();
            logger.error('Error processing CSV patients:', error);
            res.status(500).json({ message: 'Error processing CSV' });
          }
        })
        .on('error', async (error) => {
          await transaction.rollback();
          logger.error('Error parsing CSV:', error);
          res.status(400).json({ message: 'Invalid CSV format' });
        });
    } else if (fileType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      // Parse Excel
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(req.file.buffer);
      const worksheet = workbook.worksheets[0];

      worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber === 1) return; // Skip header row
        patients.push({
          firstName: row.getCell(1).value,
          lastName: row.getCell(2).value,
          patientId: row.getCell(3).value?.toString(),
          dateOfBirth: row.getCell(4).value ? new Date(row.getCell(4).value) : null,
          email: row.getCell(5).value,
          phone: row.getCell(6).value?.toString(),
          category: row.getCell(7).value
        });
      });

      // Validate and insert patients
      const validCategories = ['Walk-in', 'Referred', 'Doctor referral', 'Corporate', 'Hospital', 'HMO'];
      const errors = [];
      for (const patient of patients) {
        if (!patient.firstName || !patient.lastName || !patient.patientId || !validCategories.includes(patient.category)) {
          errors.push(`Invalid data for patient ${patient.patientId}`);
          continue;
        }
        await Patient.create(patient, { transaction });
      }

      // Log import action
      await AuditLog.create({
        userId: req.user.id,
        action: 'IMPORT_PATIENTS',
        details: `Imported ${patients.length} patients, ${errors.length} errors`,
        entityType: 'Patient'
      }, { transaction });

      await transaction.commit();
      res.json({ message: `Imported ${patients.length} patients`, errors });
    } else {
      await transaction.rollback();
      res.status(400).json({ message: 'Unsupported file type' });
    }
  } catch (error) {
    await transaction.rollback();
    logger.error('Error importing patients:', error);
    res.status(500).json({ message: 'Error importing patients' });
  }
});

// Import test requests (CSV/Excel)
router.post('/test-requests', authenticateToken, requireRole('admin'), upload.single('file'), async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    if (!req.file) {
      await transaction.rollback();
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const fileType = req.file.mimetype;
    const testRequests = [];

    if (fileType === 'text/csv') {
      const parser = csv.parse({ columns: true, trim: true });
      const stream = require('stream');
      const bufferStream = new stream.PassThrough();
      bufferStream.end(req.file.buffer);

      bufferStream
        .pipe(parser)
        .on('data', (row) => {
          testRequests.push({
            patientId: row.patientId,
            testId: row.testId,
            doctorId: row.doctorId,
            scheduledDate: row.scheduledDate ? new Date(row.scheduledDate) : null
          });
        })
        .on('end', async () => {
          try {
            const errors = [];
            for (const request of testRequests) {
              const patient = await Patient.findByPk(request.patientId);
              const test = await Test.findByPk(request.testId);
              const doctor = await User.findByPk(request.doctorId);
              if (!patient || !test || !doctor || doctor.role !== 'doctor') {
                errors.push(`Invalid data for test request: patient ${request.patientId}, test ${request.testId}`);
                continue;
              }
              await TestRequest.create(request, { transaction });
            }

            // Log import action
            await AuditLog.create({
              userId: req.user.id,
              action: 'IMPORT_TEST_REQUESTS',
              details: `Imported ${testRequests.length} test requests, ${errors.length} errors`,
              entityType: 'TestRequest'
            }, { transaction });

            await transaction.commit();
            res.json({ message: `Imported ${testRequests.length} test requests`, errors });
          } catch (error) {
            await transaction.rollback();
            logger.error('Error processing CSV test requests:', error);
            res.status(500).json({ message: 'Error processing CSV' });
          }
        })
        .on('error', async (error) => {
          await transaction.rollback();
          logger.error('Error parsing CSV:', error);
          res.status(400).json({ message: 'Invalid CSV format' });
        });
    } else if (fileType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(req.file.buffer);
      const worksheet = workbook.worksheets[0];

      worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber === 1) return; // Skip header row
        testRequests.push({
          patientId: row.getCell(1).value?.toString(),
          testId: row.getCell(2).value?.toString(),
          doctorId: row.getCell(3).value?.toString(),
          scheduledDate: row.getCell(4).value ? new Date(row.getCell(4).value) : null
        });
      });

      const errors = [];
      for (const request of testRequests) {
        const patient = await Patient.findByPk(request.patientId);
        const test = await Test.findByPk(request.testId);
        const doctor = await User.findByPk(request.doctorId);
        if (!patient || !test || !doctor || doctor.role !== 'doctor') {
          errors.push(`Invalid data for test request: patient ${request.patientId}, test ${request.testId}`);
          continue;
        }
        await TestRequest.create(request, { transaction });
      }

      // Log import action
      await AuditLog.create({
        userId: req.user.id,
        action: 'IMPORT_TEST_REQUESTS',
        details: `Imported ${testRequests.length} test requests, ${errors.length} errors`,
        entityType: 'TestRequest'
      }, { transaction });

      await transaction.commit();
      res.json({ message: `Imported ${testRequests.length} test requests`, errors });
    } else {
      await transaction.rollback();
      res.status(400).json({ message: 'Unsupported file type' });
    }
  } catch (error) {
    await transaction.rollback();
    logger.error('Error importing test requests:', error);
    res.status(500).json({ message: 'Error importing test requests' });
  }
});

module.exports = router;