// models/User.js
const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');

module.exports = (sequelize) => {
const User = sequelize.define('User', {
id: {
type: DataTypes.UUID,
defaultValue: DataTypes.UUIDV4,
primaryKey: true,
},
email: {
type: DataTypes.STRING,
allowNull: false,
unique: true,
validate: {
isEmail: true,
},
},
password: {
type: DataTypes.STRING,
allowNull: false,
},
firstName: {
type: DataTypes.STRING,
allowNull: false,
},
lastName: {
type: DataTypes.STRING,
allowNull: false,
},
role: {
type: DataTypes.ENUM('admin', 'front_desk', 'doctor', 'lab_tech'),
allowNull: false,
},
isActive: {
type: DataTypes.BOOLEAN,
defaultValue: true,
},
twoFactorSecret: {
type: DataTypes.STRING,
allowNull: true,
},
twoFactorEnabled: {
type: DataTypes.BOOLEAN,
defaultValue: false,
},
lastLogin: {
type: DataTypes.DATE,
allowNull: true,
},
});

User.beforeCreate(async (user) => {
user.password = await bcrypt.hash(user.password, 12);
});

User.beforeUpdate(async (user) => {
if (user.changed('password')) {
user.password = await bcrypt.hash(user.password, 12);
}
});

User.prototype.comparePassword = async function(password) {
return bcrypt.compare(password, this.password);
};

return User;
};