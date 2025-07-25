const { required } = require('joi');
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Message = sequelize.define('Message', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false
    },
    firstName: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      allowNull: false,
      references: { model: 'Appointments', key: 'id' }
    },
    lastName: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      allowNull: false,
      references: { model: 'Patients', key: 'id' }
    },
    email: {
      type: DataTypes.DATE,
      allowNull: false,
      validate: { isDate: true }
    },
    phone: {
      type: DataTypes.ENUM('pending', 'sent', 'cancelled'),
      allowNull: false,
      defaultValue: 'pending'
    },
    message: {
      type: DataTypes.STRING,
      required: true,
      validate: {
        len: [1, 255],
        message: ["Message Must contain 11 Digits"]
        // Add more validation rules as needed
    }, 
  }

});

  Message.associate = (models) => {
    Message.belongsTo(models.Patient, { foreignKey: 'appointmentId' });
    Message.belongsTo(models.User, { foreignKey: 'User' });
  };

  return Reminder;
};