const bcrypt = require('bcryptjs');

const testPasswordAgainstHash = async (hashedPassword, possiblePasswords) => {
  for (const password of possiblePasswords) {
    const match = await bcrypt.compare(password, hashedPassword);
    if (match) {
      console.log(`✅ Match found: "${password}"`);
      return password;
    }
  }
  console.log("❌ No match found.");
  return null;
};

// Example usage:
const hashedPassword = "$2a$12$XwT.f1/.1kQveGvbGeMfh.LA9W2L3bQsQCxzaGLuX1mCol428y6Iu"; // Your hash
const commonPasswords = ["password", "undefined", 'undefined', undefined, "123456", "ChangeMe123!", 'ChangeMe123!', "admin123"];

testPasswordAgainstHash(hashedPassword, commonPasswords);
console.log( process.env.DEFAULT_PATIENT_PASSWORD);