// routes/patients.js
const express = require('express');
const { Patient, TestRequest, Test, Doctor } = require('../models');
const { authenticate, authorize } = require('../middleware/auth');
const { validationResult, body } = require('express-validator');
const { Op } = require('sequelize');
const logger = require('../utils/logger');

const router = express.Router();

// Create new patient
router.post('/', authenticate, authorize('admin', 'front_desk'), [
body('firstName').notEmpty().trim(),
body('lastName').notEmpty().trim(),
body('phone').notEmpty().trim(),
body('dateOfBirth').isDate(),
body('gender').isIn(['male', 'female', 'other']),
body('category').isIn(['walk_in', 'referred', 'doctor_referral', 'corporate', 'hospital', 'hmo']),
], async (req, res) => {
try {
const errors = validationResult(req);
if (!errors.isEmpty()) {
return res.status(400).json({ errors: errors.array() });
}

// Generate unique patient ID
const lastPatient = await Patient.findOne({
order: [['createdAt', 'DESC']]
});

const nextNumber = lastPatient ?
parseInt(lastPatient.patientId.replace('PT', '')) + 1 : 1;
const patientId = `PT${nextNumber.toString().padStart(6, '0')}`;

const patient = await Patient.create({
...req.body,
patientId
});

logger.info(`New patient created: ${patientId} by user ${req.user.id}`);

// Send real-time notification
req.io.to('doctor').emit('new-patient', {
patientId: patient.id,
name: `${patient.firstName} ${patient.lastName}`,
category: patient.category
});

res.status(201).json(patient);
} catch (error) {
logger.error('Patient creation error:', error);
res.status(500).json({ message: 'Server error' });
}
});


// Get all patients with pagination and search
router.get('/', authenticate, async (req, res) => {
try {
const { page = 1, limit = 20, search, category, isActive = true } = req.query;
const offset = (page - 1) * limit;

const whereClause = { isActive };

if (search) {
whereClause[Op.or] = [
{ firstName: { [Op.iLike]: `%${search}%` } },
{ lastName: { [Op.iLike]: `%${search}%` } },
{ patientId: { [Op.iLike]: `%${search}%` } },
{ phone: { [Op.iLike]: `%${search}%` } }
];
}

if (category) {
whereClause.category = category;
}

const { count, rows: patients } = await Patient.findAndCountAll({
where: whereClause,
limit: parseInt(limit),
offset,
order: [['createdAt', 'DESC']],
include: [{
model: TestRequest,
include: [{ model: Test }]
}]
});

res.json({
patients,
pagination: {
currentPage: parseInt(page),
totalPages: Math.ceil(count / limit),
totalItems: count,
itemsPerPage: parseInt(limit)
}
});
} catch (error) {
logger.error('Get patients error:', error);
res.status(500).json({ message: 'Server error' });
}
});

// Get patient by ID
router.get('/:id', authenticate, async (req, res) => {
try {
const patient = await Patient.findByPk(req.params.id, {
include: [{
model: TestRequest,
include: [
{ model: Test },
{ model: Doctor, include: [{ model: User }] }
]
}]
});

if (!patient) {
return res.status(404).json({ message: 'Patient not found' });
}

res.json(patient);
} catch (error) {
logger.error('Get patient error:', error);
res.status(500).json({ message: 'Server error' });
}
});

// Create test request for patient
router.post('/:id/test-requests', authenticate, authorize('admin', 'front_desk', 'doctor'), [
body('testIds').isArray().notEmpty(),
body('priority').optional().isIn(['low', 'medium', 'high', 'urgent']),
], async (req, res) => {
try {
const errors = validationResult(req);
if (!errors.isEmpty()) {
return res.status(400).json({ errors: errors.array() });
}

const patient = await Patient.findByPk(req.params.id);
if (!patient) {
return res.status(404).json({ message: 'Patient not found' });
}

const { testIds, priority = 'medium', doctorRemarks, scheduledDate } = req.body;

const testRequests = [];

for (const testId of testIds) {
// Generate unique request number
const requestNumber = `TR${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

const testRequest = await TestRequest.create({
requestNumber,
patientId: patient.id,
testId,
priority,
doctorRemarks,
scheduledDate: scheduledDate ? new Date(scheduledDate) : null,
status: 'pending'
});

testRequests.push(testRequest);
}

logger.info(`Test requests created for patient ${patient.patientId}`);

// Notify doctors
req.io.to('doctor').emit('new-test-requests', {
patientId: patient.id,
patientName: `${patient.firstName} ${patient.lastName}`,
testCount: testIds.length
});

res.status(201).json(testRequests);
} catch (error) {
logger.error('Test request creation error:', error);
res.status(500).json({ message: 'Server error' });
}
});

module.exports = router;


