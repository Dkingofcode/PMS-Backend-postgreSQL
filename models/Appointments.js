const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Appointment = sequelize.define('Appointment', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false
    },
    patientId: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      allowNull: false,
      references: { model: 'Patients', key: 'id' }
    },
    doctorId: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      allowNull: false,
      references: { model: 'Doctors', key: 'id' }
    },
    scheduledDate: {
      type: DataTypes.DATE,
      allowNull: false,
      validate: { isDate: true }
    },
    queueNumber: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: { min: 1 }
    },
    status: {
      type: DataTypes.ENUM('scheduled', 'rescheduled', 'cancelled'),
      allowNull: false,
      defaultValue: 'scheduled'
    }
  });

  Appointment.associate = (models) => {
    Appointment.belongsTo(models.Patient, { foreignKey: 'patientId' });
    Appointment.belongsTo(models.Doctor, { foreignKey: 'doctorId', as: 'Doctor' });
    Appointment.hasMany(models.Reminder, { foreignKey: 'appointmentId' });
  };

  return Appointment;
};