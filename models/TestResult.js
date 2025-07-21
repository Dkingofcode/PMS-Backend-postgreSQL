// models/TestResult.js
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
const TestResult = sequelize.define('TestResult', {
id: {
type: DataTypes.UUID,
defaultValue: DataTypes.UUIDV4,
primaryKey: true,
},
results: {
type: DataTypes.JSONB,
allowNull: false,
},
resultFile: {
type: DataTypes.STRING,
allowNull: true,
},
labTechRemarks: {
type: DataTypes.TEXT,
allowNull: true,
},
doctorRemarks: {
type: DataTypes.TEXT,
allowNull: true,
},
digitalSignature: {
type: DataTypes.TEXT,
allowNull: true,
},
approvedBy: {
  type: DataTypes.UUID, // ✅ Must match Doctors.id
  references: {
    model: 'Doctors',
    key: 'id'
  },
  onDelete: 'SET NULL',
  onUpdate: 'CASCADE'
},

ApprovedDate: {
type: DataTypes.DATE,
allowNull: true,
},

approvedAt: {
type: DataTypes.DATE,
allowNull: true,
},
status: {
type: DataTypes.ENUM('draft', 'submitted', 'approved', 'sent'),
defaultValue: 'draft',
},
});

return TestResult;
};