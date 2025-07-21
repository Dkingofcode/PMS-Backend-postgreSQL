const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Reminder = sequelize.define('Reminder', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false
    },
    appointmentId: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      allowNull: false,
      references: { model: 'Appointments', key: 'id' }
    },
    patientId: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      allowNull: false,
      references: { model: 'Patients', key: 'id' }
    },
    remindAt: {
      type: DataTypes.DATE,
      allowNull: false,
      validate: { isDate: true }
    },
    status: {
      type: DataTypes.ENUM('pending', 'sent', 'cancelled'),
      allowNull: false,
      defaultValue: 'pending'
    }
  });

  Reminder.associate = (models) => {
    Reminder.belongsTo(models.Appointment, { foreignKey: 'appointmentId' });
    Reminder.belongsTo(models.Patient, { foreignKey: 'patientId' });
  };

  return Reminder;
};