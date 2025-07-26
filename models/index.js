const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    dialect: 'postgres',
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    pool: {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
    dialectOptions: {
      ssl: {
        require: true,             // Render requires ssl connection
        rejectUnauthorized: false,
      },
    }
  }
);

// Model definitions
const User = require('./User')(sequelize);
const Patient = require('./Patient')(sequelize);
const Doctor = require('./Doctor')(sequelize);
const LabTechnician = require('./Labtechnician')(sequelize);
const Test = require('./Test')(sequelize);
const TestRequest = require('./TestRequest')(sequelize);
const TestResult = require('./TestResult')(sequelize);
const AuditLog = require('./AuditLog')(sequelize);
const Appointment = require('./Appointments')(sequelize);
const Reminder = require('./Reminder')(sequelize);
const PatientAccess = require('./PatientAccess')(sequelize);

// Associations
User.hasOne(Patient, { foreignKey: 'userId' });
Patient.belongsTo(User, { foreignKey: 'userId' });

User.hasOne(Doctor, { foreignKey: 'userId' });
Doctor.belongsTo(User, { foreignKey: 'userId' });

User.hasOne(LabTechnician, { foreignKey: 'userId' });
LabTechnician.belongsTo(User, { foreignKey: 'userId' });

Patient.hasMany(TestRequest, { foreignKey: 'patientId' });
TestRequest.belongsTo(Patient, { foreignKey: 'patientId' });

Test.hasMany(TestRequest, { foreignKey: 'testId' });
TestRequest.belongsTo(Test, { foreignKey: 'testId' });

Doctor.hasMany(TestRequest, { foreignKey: 'doctorId' });
TestRequest.belongsTo(Doctor, { foreignKey: 'doctorId' });

LabTechnician.hasMany(TestRequest, { foreignKey: 'labTechnicianId' });
TestRequest.belongsTo(LabTechnician, { foreignKey: 'labTechnicianId' });

TestRequest.hasMany(TestResult, { foreignKey: 'testRequestId' });
TestResult.belongsTo(TestRequest, { foreignKey: 'testRequestId' });

TestResult.belongsTo(LabTechnician, { foreignKey: 'labTechnicianId' });
TestResult.belongsTo(Doctor, { foreignKey: 'approvedBy', as: 'Doctor' });

Patient.hasMany(Appointment, { foreignKey: 'patientId' });
Appointment.belongsTo(Patient, { foreignKey: 'patientId' });

Doctor.hasMany(Appointment, { foreignKey: 'doctorId' });
Appointment.belongsTo(Doctor, { foreignKey: 'doctorId', as: 'Doctor' });

Appointment.hasMany(Reminder, { foreignKey: 'appointmentId' });
Reminder.belongsTo(Appointment, { foreignKey: 'appointmentId' });

Patient.hasMany(Reminder, { foreignKey: 'patientId' });
Reminder.belongsTo(Patient, { foreignKey: 'patientId' });

Patient.hasMany(PatientAccess, { foreignKey: 'patientId' });
PatientAccess.belongsTo(Patient, { foreignKey: 'patientId' });

TestResult.hasMany(PatientAccess, { foreignKey: 'testResultId' });
PatientAccess.belongsTo(TestResult, { foreignKey: 'testResultId' });

AuditLog.belongsTo(User, { foreignKey: 'userId' });

module.exports = {
  sequelize,
  User,
  Patient,
  Doctor,
  LabTechnician,
  Test,
  TestRequest,
  TestResult,
  AuditLog,
  Appointment,
  Reminder,
  PatientAccess
};