const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const PatientAccess = sequelize.define('PatientAccess', {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
      allowNull: false
    },
    patientId: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      allowNull: false,
      references: { model: 'Patients', key: 'id' }
    },
    testResultId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'TestResults', key: 'id' }
    },
    accessCode: {
      type: DataTypes.STRING,
      allowNull: false
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
      validate: { isDate: true }
    }
  });

  PatientAccess.associate = (models) => {
    PatientAccess.belongsTo(models.Patient, { foreignKey: 'patientId' });
    PatientAccess.belongsTo(models.TestResult, { foreignKey: 'testResultId' });
  };

  return PatientAccess;
};