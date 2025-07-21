// models/TestRequest.js
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
const TestRequest = sequelize.define('TestRequest', {
id: {
type: DataTypes.UUID,
defaultValue: DataTypes.UUIDV4,
primaryKey: true,
},
requestNumber: {
type: DataTypes.STRING,
unique: true,
allowNull: false,
},
status: {
type: DataTypes.ENUM('pending', 'assigned', 'in_progress', 'completed', 'approved', 'cancelled'),
defaultValue: 'pending',
},
priority: {
type: DataTypes.ENUM('low', 'medium', 'high', 'urgent'),
defaultValue: 'medium',
},
doctorRemarks: {
type: DataTypes.TEXT,
allowNull: true,
},
scheduledDate: {
type: DataTypes.DATE,
allowNull: true,
},
completedDate: {
type: DataTypes.DATE,
allowNull: true,
},
approvedDate: {
type: DataTypes.DATE,
allowNull: true,
},
});

return TestRequest;
};