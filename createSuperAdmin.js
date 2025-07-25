// createSuperAdmin.js
require("dotenv").config();
const { sequelize, User } = require("./models");

async function createSuperAdmin() {
  try {
    await sequelize.authenticate();
    await sequelize.sync(); // Ensure tables exist

    const email = process.env.SUPERADMIN_EMAIL || "admin@hospital.com";
    const username = process.env.SUPERADMIN_USERNAME || "superadmin";
    const password =
      process.env.SUPERADMIN_PASSWORD || "SuperSecurePassword123!";
    const firstName = "Super";
    const lastName = "Admin";
    const role = "admin";

    // Check if super admin already exists
    const existing = await User.findOne({ where: { email } });
    if (existing) {
      console.log("Super admin already exists:", existing.email);
      process.exit(0);
    }

    const user = await User.create({
      email,
      username,
      password,
      firstName,
      lastName,
      role,
      isActive: true,
      twoFactorEnabled: false,
    });
    console.log("Super admin created:", user.email);
  } catch (err) {
    console.error("Error creating super admin:", err);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

createSuperAdmin();
