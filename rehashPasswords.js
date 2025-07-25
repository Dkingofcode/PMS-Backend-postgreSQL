// rehashPasswords.js
require("dotenv").config();
const bcrypt = require("bcryptjs");
const { User, sequelize } = require("./models");

const DEFAULT_PASSWORD = process.env.DEFAULT_PATIENT_PASSWORD || "ChangeMe123!";

async function rehashPasswords() {
  try {
    await sequelize.authenticate();
    console.log("🔗 Connected to the database...");

    const users = await User.findAll();

    let updatedCount = 0;

    for (const user of users) {
      const existingHash = user.password;

      // Check if already a valid bcrypt hash
      const isValidBcrypt = /^\$2[aby]?\$\d{2}\$[./A-Za-z0-9]{53}$/.test(existingHash);
      if (!isValidBcrypt) {
        const newHash = await bcrypt.hash(DEFAULT_PASSWORD, 12);
        await user.update({ password: newHash });
        console.log(`🔁 Rehashed password for user: ${user.email}`);
        updatedCount++;
      }
    }

    console.log(`✅ Done! Rehashed ${updatedCount} users.`);
    await sequelize.close();
  } catch (error) {
    console.error("❌ Error during rehash:", error.message);
  }
}

rehashPasswords();
