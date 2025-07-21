const nodemailer = require('nodemailer');
const { User, Patient, TestResult, PatientAccess, AuditLog } = require('../models');
const logger = require('../utils/logger');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT || 587,
  secure: process.env.EMAIL_SECURE === 'true', // true for 465, false for 587
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Verify transporter configuration
transporter.verify((error, success) => {
  if (error) {
    logger.error('Email transporter verification failed:', error);
  } else {
    logger.info('Email transporter is ready');
  }
});

const sendSecureResultEmail = async (patientAccessId, userId) => {
  try {
    // Fetch PatientAccess record
    const patientAccess = await PatientAccess.findByPk(patientAccessId, {
      include: [
        { model: TestResult, include: [{ model: TestRequest, include: [{ model: Test }] }] },
        { model: Patient, include: [{ model: User, attributes: ['id', 'email', 'firstName', 'lastName'] }] }
      ]
    });

    if (!patientAccess) {
      logger.warn(`PatientAccess record not found: ${patientAccessId}`);
      throw new Error('Patient access record not found');
    }

    const { Patient, TestResult } = patientAccess;
    const { User: patientUser, patientId } = Patient;
    const { TestRequest } = TestResult;
    const { Test } = TestRequest;

    // Generate secure access URL
    const accessUrl = `${process.env.APP_BASE_URL}/results/access/${patientAccess.accessCode}`;

    // Email content
    const mailOptions = {
      from: `"Healthcare Platform" <${process.env.EMAIL_USER}>`,
      to: patientUser.email,
      subject: `Your Test Result for ${Test.name} is Available`,
      html: `
        <h2>Test Result Notification</h2>
        <p>Dear ${patientUser.firstName} ${patientUser.lastName},</p>
        <p>Your test result for <strong>${Test.name}</strong> (Test ID: ${TestRequest.id}) is now available.</p>
        <p><strong>Result:</strong> ${TestResult.result}</p>
        <p><strong>Status:</strong> ${TestResult.status}</p>
        <p>Please access your result securely using the following link:</p>
        <p><a href="${accessUrl}">View Test Result</a></p>
        <p>This link will expire on ${new Date(patientAccess.expiresAt).toLocaleString()}.</p>
        <p>If you have any questions, please contact our support team.</p>
        <p>Best regards,<br>Healthcare Platform Team</p>
      `
    };

    // Send email
    await transporter.sendMail(mailOptions);

    // Log email action
    await AuditLog.create({
      userId,
      action: 'SEND_TEST_RESULT_EMAIL',
      details: `Email sent to ${patientUser.email} for test result ${TestResult.id} (Patient ID: ${patientId})`,
      entityId: TestResult.id,
      entityType: 'TestResult'
    });

    logger.info(`Secure result email sent to ${patientUser.email} for test result ${TestResult.id}`);

    return { success: true, message: 'Email sent successfully' };
  } catch (error) {
    logger.error(`Error sending secure result email for PatientAccess ${patientAccessId}:`, error);
    throw new Error('Failed to send secure result email');
  }
};

module.exports = { sendSecureResultEmail };