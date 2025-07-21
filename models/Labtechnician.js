const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const LabTechnician = sequelize.define('LabTechnician', {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
      allowNull: false
    },
    userId: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      allowNull: false,
      unique: true,
      references: { model: 'Users', key: 'id' }
    },
    certification: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: { notEmpty: true }
    },
    certificationNumber: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: { notEmpty: true }
    }
  });

  LabTechnician.associate = (models) => {
    LabTechnician.belongsTo(models.User, { foreignKey: 'userId' });
    LabTechnician.hasMany(models.TestRequest, { foreignKey: 'labTechnicianId' });
    LabTechnician.hasMany(models.TestResult, { foreignKey: 'labTechnicianId' });
  };

  return LabTechnician;
};