const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Test = sequelize.define('Test', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: { notEmpty: true }
    },
    code: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: { notEmpty: true }
    },
    category: {
      type: DataTypes.ENUM('Blood', 'Imaging', 'Urine', 'Genetic', 'Other'),
      allowNull: false
    },
    normalRange: {
      type: DataTypes.STRING,
      allowNull: true
    },
    units: {
      type: DataTypes.STRING,
      allowNull: true
    },
    methodology: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  });

  Test.associate = (models) => {
    Test.hasMany(models.TestRequest, { foreignKey: 'testId' });
  };

  return Test;
};