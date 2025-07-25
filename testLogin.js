// testLogin.js
require('dotenv').config();
const { User, sequelize } = require('./models'); // adjust path if needed
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');

const identifier = 'okosoks@gmail.com'; // Email, username, or userId
const passwordToTest = 'SuperSafe123!';  // The plain-text password you want to test

async function testUserLogin() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established');

    const whereClause = {
      [Op.or]: [
        { email: identifier },
        { username: identifier },
      ],
    };

    // Check if it's a valid UUID and add userId check
    if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(identifier)) {
      whereClause[Op.or].push({ userId: identifier });
    }

    const user = await User.findOne({ where: whereClause });

    if (!user) {
      console.log('❌ User not found for identifier:', identifier);
      return;
    }

    const isValid = await user.comparePassword(passwordToTest);

    if (isValid) {
      console.log('✅ Password is valid');
      console.log('User Info:', {
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      });
    } else {
      console.log('❌ Password is invalid');
    }

  } catch (error) {
    console.error('❌ Error during login test:', error);
  } finally {
    await sequelize.close();
  }
}

testUserLogin();
