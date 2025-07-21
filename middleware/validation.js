const { TestRequest, Test, User, Doctor, LabTechnician } = require('../models');
const logger = require('../utils/logger');

const validateTestAssignment = async (req, res, next) => {
  try {
    const { testRequestId, labTechnicianId, doctorId } = req.body;

    // Check for required fields
    if (!testRequestId) {
      return res.status(400).json({ message: 'Missing required field: testRequestId' });
    }

    // Validate test request exists and is in a valid state
    const testRequest = await TestRequest.findOne({
      where: { id: testRequestId },
      include: [
        { model: Test, attributes: ['id', 'name', 'code'] },
        { model: Patient, attributes: ['id', 'patientId'] },
        { model: Doctor, attributes: ['id', 'userId'] },
        { model: LabTechnician, attributes: ['id', 'userId'], required: false }
      ]
    });

    if (!testRequest) {
      return res.status(404).json({ message: 'Test request not found' });
    }

    if (!['pending', 'in_progress'].includes(testRequest.status)) {
      return res.status(400).json({ message: `Test request is in ${testRequest.status} state and cannot be assigned` });
    }

    // Validate user permissions (only admin or doctor can assign tests)
    if (!['admin', 'doctor'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Only admins or doctors can assign tests' });
    }

    // If doctor assigning, ensure they are the assigned doctor
    if (req.user.role === 'doctor') {
      const doctor = await Doctor.findOne({ where: { userId: req.user.id } });
      if (!doctor || doctor.id !== testRequest.doctorId) {
        return res.status(403).json({ message: 'You are not authorized to assign this test request' });
      }
    }

    // Validate labTechnicianId if provided
    if (labTechnicianId) {
      const labTechnician = await LabTechnician.findOne({
        where: { id: labTechnicianId },
        include: [{ model: User, where: { role: 'lab_technician' }, attributes: ['id', 'role'] }]
      });
      if (!labTechnician) {
        return res.status(404).json({ message: 'Lab technician not found or invalid role' });
      }
    }

    // Validate doctorId if provided
    if (doctorId) {
      const doctor = await Doctor.findOne({
        where: { id: doctorId },
        include: [{ model: User, where: { role: 'doctor' }, attributes: ['id', 'role'] }]
      });
      if (!doctor) {
        return res.status(404).json({ message: 'Doctor not found or invalid role' });
      }
    }

    // Attach validated test request to req for use in route
    req.testRequest = testRequest;

    next();
  } catch (error) {
    logger.error('Error validating test assignment:', error);
    res.status(500).json({ message: 'Error validating test assignment' });
  }
};

module.exports = { validateTestAssignment };