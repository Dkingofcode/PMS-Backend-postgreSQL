const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const AuditLog = sequelize.define('AuditLog', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      allowNull: true,
      references: { model: 'Users', key: 'id' }
    },
    action: {
      type: DataTypes.ENUM(
        'REGISTER_STAFF',
        'REGISTER_PATIENT',
        'UPDATE_USER',
        'DELETE_USER',
        'BOOK_APPOINTMENT',
        'RESCHEDULE_APPOINTMENT',
        'SET_REMINDERS',
        'SUBMIT_TEST_RESULT',
        'APPROVE_TEST_RESULT',
        'REJECT_TEST_RESULT',
        'NEEDS_REVISION',
        'ACCESS_TEST_RESULT',
        'UPDATE_SETTINGS'
      ),
      allowNull: false
    },
    details: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    entityId: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      allowNull: true
    },
    entityType: {
      type: DataTypes.ENUM('User', 'Patient', 'Appointment', 'TestResult', 'TestRequest', 'System'),
      allowNull: true
    },
    createdAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  });

  AuditLog.associate = (models) => {
    AuditLog.belongsTo(models.User, { foreignKey: 'userId' });
  };

  return AuditLog;
};