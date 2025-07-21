const express = require('express');
const { Op } = require('sequelize');
const schedule = require('node-schedule');
const { sequelize, Appointment, Patient, User, Reminder, AuditLog } = require('../models');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { sendSecureResultEmail } = require('../services/emailService');
const logger = require('../utils/logger');

const router = express.Router();

// Helper function to generate queue number for a doctor on a specific date
const generateQueueNumber = async (doctorId, date) => {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const appointmentCount = await Appointment.count({
    where: {
      doctorId,
      scheduledDate: { [Op.between]: [startOfDay, endOfDay] },
      status: { [Op.ne]: 'cancelled' }
    }
  });

  return appointmentCount + 1;
};

// Helper function to schedule reminders
const scheduleReminders = async (appointmentId, patientId, scheduledDate, patientEmail, patientName) => {
  const reminders = [
    { interval: '1 week', remindAt: new Date(scheduledDate.getTime() - 7 * 24 * 60 * 60 * 1000) },
    { interval: '1 day', remindAt: new Date(scheduledDate.getTime() - 24 * 60 * 60 * 1000) },
    { interval: 'same day', remindAt: new Date(scheduledDate.setHours(0, 0, 0, 0)) },
    { interval: '1 hour', remindAt: new Date(scheduledDate.getTime() - 60 * 60 * 1000) }
  ];

  for (const reminder of reminders) {
    if (reminder.remindAt > new Date()) {
      await Reminder.create({
        appointmentId,
        patientId,
        remindAt: reminder.remindAt,
        status: 'pending'
      });

      schedule.scheduleJob(reminder.remindAt, async () => {
        try {
          await sendSecureResultEmail({
            to: patientEmail,
            patientName,
            subject: `Appointment Reminder (${reminder.interval})`,
            body: `Your appointment is scheduled for ${scheduledDate.toISOString()}.`
          });

          await Reminder.update(
            { status: 'sent' },
            { where: { appointmentId, remindAt: reminder.remindAt } }
          );

          logger.info(`Reminder sent for appointment ${appointmentId} at ${reminder.interval}`);
        } catch (error) {
          logger.error(`Error sending reminder for appointment ${appointmentId}:`, error);
        }
      });
    }
  }
};

// Get doctor's calendar (Front Desk)
router.get('/doctors/:doctorId/calendar', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { doctorId } = req.params;
    const { date = new Date() } = req.query;

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const doctor = await User.findOne({ where: { id: doctorId, role: 'doctor' } });
    if (!doctor) {
      return res.status(404).json({ message: 'Doctor not found' });
    }

    const appointments = await Appointment.findAll({
      where: {
        doctorId,
        scheduledDate: { [Op.between]: [startOfDay, endOfDay] },
        status: { [Op.ne]: 'cancelled' }
      },
      include: [{ model: Patient, attributes: ['firstName', 'lastName', 'patientId'] }],
      order: [['scheduledDate', 'ASC'], ['queueNumber', 'ASC']]
    });

    // Assume doctor's availability is 9 AM to 5 PM, 30-minute slots
    const availableSlots = [];
    const startHour = 9;
    const endHour = 17;
    const slotDuration = 30; // minutes

    for (let hour = startHour; hour < endHour; hour++) {
      for (let minute = 0; minute < 60; minute += slotDuration) {
        const slotTime = new Date(startOfDay);
        slotTime.setHours(hour, minute, 0, 0);
        const isBooked = appointments.some(
          (appt) => Math.abs(new Date(appt.scheduledDate) - slotTime) < slotDuration * 60 * 1000
        );
        if (!isBooked && slotTime > new Date()) {
          availableSlots.push(slotTime);
        }
      }
    }

    res.json({ doctor: `${doctor.firstName} ${doctor.lastName}`, appointments, availableSlots });
  } catch (error) {
    logger.error('Error fetching doctor calendar:', error);
    res.status(500).json({ message: 'Error fetching calendar' });
  }
});

// Book appointment (Front Desk)
router.post('/', authenticateToken, requireRole('admin'), async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { patientId, doctorId, scheduledDate } = req.body;

    const patient = await Patient.findByPk(patientId);
    const doctor = await User.findOne({ where: { id: doctorId, role: 'doctor' } });
    if (!patient || !doctor) {
      await transaction.rollback();
      return res.status(404).json({ message: 'Patient or doctor not found' });
    }

    const parsedDate = new Date(scheduledDate);
    if (parsedDate <= new Date()) {
      await transaction.rollback();
      return res.status(400).json({ message: 'Cannot schedule appointment in the past' });
    }

    // Check for conflicts
    const startOfSlot = new Date(parsedDate);
    const endOfSlot = new Date(parsedDate.getTime() + 30 * 60 * 1000);
    const conflictingAppointment = await Appointment.findOne({
      where: {
        doctorId,
        scheduledDate: { [Op.between]: [startOfSlot, endOfSlot] },
        status: { [Op.ne]: 'cancelled' }
      }
    });

    if (conflictingAppointment) {
      await transaction.rollback();
      return res.status(400).json({ message: 'Time slot already booked' });
    }

    const queueNumber = await generateQueueNumber(doctorId, parsedDate);

    const appointment = await Appointment.create({
      patientId,
      doctorId,
      scheduledDate: parsedDate,
      queueNumber,
      status: 'scheduled'
    }, { transaction });

    // Schedule reminders
    await scheduleReminders(
      appointment.id,
      patientId,
      parsedDate,
      patient.email,
      `${patient.firstName} ${patient.lastName}`
    );

    // Log action
    await AuditLog.create({
      userId: req.user.id,
      action: 'BOOK_APPOINTMENT',
      details: `Appointment booked for patient ${patientId} with doctor ${doctorId}`,
      entityId: appointment.id,
      entityType: 'Appointment'
    }, { transaction });

    // Notify doctor
    req.io.to('doctor').emit('new-appointment', {
      appointmentId: appointment.id,
      patientId,
      scheduledDate
    });

    await transaction.commit();
    res.status(201).json({ message: 'Appointment booked', appointment });
  } catch (error) {
    await transaction.rollback();
    logger.error('Error booking appointment:', error);
    res.status(500).json({ message: 'Error booking appointment' });
  }
});

// Reschedule appointment (Doctor)
router.put('/:id', authenticateToken, requireRole('doctor'), async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { scheduledDate } = req.body;

    const appointment = await Appointment.findByPk(id, {
      include: [{ model: Patient }]
    });

    if (!appointment || appointment.doctorId !== req.user.id) {
      await transaction.rollback();
      return res.status(404).json({ message: 'Appointment not found or access denied' });
    }

    const parsedDate = new Date(scheduledDate);
    if (parsedDate <= new Date()) {
      await transaction.rollback();
      return res.status(400).json({ message: 'Cannot reschedule to past date' });
    }

    // Check for conflicts
    const startOfSlot = new Date(parsedDate);
    const endOfSlot = new Date(parsedDate.getTime() + 30 * 60 * 1000);
    const conflictingAppointment = await Appointment.findOne({
      where: {
        doctorId: appointment.doctorId,
        scheduledDate: { [Op.between]: [startOfSlot, endOfSlot] },
        id: { [Op.ne]: id },
        status: { [Op.ne]: 'cancelled' }
      }
    });

    if (conflictingAppointment) {
      await transaction.rollback();
      return res.status(400).json({ message: 'Time slot already booked' });
    }

    const oldDate = appointment.scheduledDate;
    const queueNumber = await generateQueueNumber(appointment.doctorId, parsedDate);

    await appointment.update({
      scheduledDate: parsedDate,
      queueNumber,
      status: 'rescheduled'
    }, { transaction });

    // Cancel existing reminders
    await Reminder.update(
      { status: 'cancelled' },
      { where: { appointmentId: id, status: 'pending' }, transaction }
    );

    // Schedule new reminders
    await scheduleReminders(
      appointment.id,
      appointment.patientId,
      parsedDate,
      appointment.Patient.email,
      `${appointment.Patient.firstName} ${appointment.Patient.lastName}`
    );

    // Log action
    await AuditLog.create({
      userId: req.user.id,
      action: 'RESCHEDULE_APPOINTMENT',
      details: `Appointment ${id} rescheduled from ${oldDate} to ${scheduledDate}`,
      entityId: id,
      entityType: 'Appointment'
    }, { transaction });

    // Notify patient
    req.io.to('patient').emit('appointment-updated', {
      appointmentId: id,
      scheduledDate
    });

    await transaction.commit();
    res.json({ message: 'Appointment rescheduled', appointment });
  } catch (error) {
    await transaction.rollback();
    logger.error('Error rescheduling appointment:', error);
    res.status(500).json({ message: 'Error rescheduling appointment' });
  }
});

// Get appointments (Doctor or Front Desk)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 10, doctorId, patientId, date } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = { status: { [Op.ne]: 'cancelled' } };
    if (req.user.role === 'doctor') {
      whereClause.doctorId = req.user.id;
    }
    if (doctorId && req.user.role === 'admin') {
      whereClause.doctorId = doctorId;
    }
    if (patientId && req.user.role === 'admin') {
      whereClause.patientId = patientId;
    }
    if (date) {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);
      whereClause.scheduledDate = { [Op.between]: [startOfDay, endOfDay] };
    }

    const { rows: appointments, count } = await Appointment.findAndCountAll({
      where: whereClause,
      include: [
        { model: Patient, attributes: ['firstName', 'lastName', 'patientId'] },
        { model: User, as: 'Doctor', attributes: ['firstName', 'lastName'] }
      ],
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['scheduledDate', 'ASC'], ['queueNumber', 'ASC']]
    });

    res.json({
      appointments,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        pages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    logger.error('Error fetching appointments:', error);
    res.status(500).json({ message: 'Error fetching appointments' });
  }
});

// Set reminders for unavailable doctor (Front Desk)
router.post('/:id/reminders', authenticateToken, requireRole('admin'), async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { scheduledDate } = req.body;

    const appointment = await Appointment.findByPk(id, {
      include: [{ model: Patient }]
    });

    if (!appointment) {
      await transaction.rollback();
      return res.status(404).json({ message: 'Appointment not found' });
    }

    const parsedDate = new Date(scheduledDate);
    if (parsedDate <= new Date()) {
      await transaction.rollback();
      return res.status(400).json({ message: 'Cannot set reminders for past date' });
    }

    // Cancel existing reminders
    await Reminder.update(
      { status: 'cancelled' },
      { where: { appointmentId: id, status: 'pending' }, transaction }
    );

    // Schedule new reminders
    await scheduleReminders(
      appointment.id,
      appointment.patientId,
      parsedDate,
      appointment.Patient.email,
      `${appointment.Patient.firstName} ${appointment.Patient.lastName}`
    );

    // Log action
    await AuditLog.create({
      userId: req.user.id,
      action: 'SET_REMINDERS',
      details: `Reminders set for appointment ${id} on ${scheduledDate}`,
      entityId: id,
      entityType: 'Appointment'
    }, { transaction });

    await transaction.commit();
    res.json({ message: 'Reminders set for appointment' });
  } catch (error) {
    await transaction.rollback();
    logger.error('Error setting reminders:', error);
    res.status(500).json({ message: 'Error setting reminders' });
  }
});

module.exports = router;