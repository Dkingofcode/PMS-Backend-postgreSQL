// models/Patient.js
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
const Patient = sequelize.define('Patient', {
id: {
type: DataTypes.UUID,
defaultValue: DataTypes.UUIDV4,
primaryKey: true,
},
patientId: {
type: DataTypes.UUID,
defaultValue: DataTypes.UUIDV4,
unique: true,
allowNull: false,
},
firstName: {
type: DataTypes.STRING,
allowNull: false,
},
lastName: {
type: DataTypes.STRING,
allowNull: false,
},
email: {
type: DataTypes.STRING,
validate: {
isEmail: true,
},
},
phone: {
type: DataTypes.STRING,
allowNull: false,
},
dateOfBirth: {
type: DataTypes.DATEONLY,
allowNull: false,
},
gender: {
type: DataTypes.ENUM('male', 'female', 'other'),
allowNull: false,
},
address: {
type: DataTypes.TEXT,
},
category: {
type: DataTypes.ENUM('walk_in', 'referred', 'doctor_referral', 'corporate', 'hospital', 'hmo'),
allowNull: false,
},
referredBy: {
type: DataTypes.STRING,
allowNull: true,
},
emergencyContact: {
type: DataTypes.JSONB,
allowNull: true,
},
medicalHistory: {
type: DataTypes.TEXT,
allowNull: true,
},
isActive: {
type: DataTypes.BOOLEAN,
defaultValue: true,
},
});

return Patient;
};