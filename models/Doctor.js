const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Doctor = sequelize.define('Doctor', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
      references: { model: 'Users', key: 'id' }
    },
    specialization: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: { notEmpty: true }
    },
    licenseNumber: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: { notEmpty: true }
    }
  });

  Doctor.associate = (models) => {
    Doctor.belongsTo(models.User, { foreignKey: 'userId' });
    Doctor.hasMany(models.TestRequest, { foreignKey: 'doctorId' });
    Doctor.hasMany(models.Appointment, { foreignKey: 'doctorId' });
  };

  return Doctor;
};