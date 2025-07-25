// bulkPatientMigration.js
require("dotenv").config();
const ExcelJS = require("exceljs");
const { v4: uuidv4 } = require("uuid");
const { sequelize, User, Patient } = require("../models");
const bcrypt = require("bcryptjs");

const FILE_PATH = __dirname + "/Cleaned_Patient_Records.xlsx";
const DEFAULT_PASSWORD = process.env.DEFAULT_PATIENT_PASSWORD || "ChangeMe123!";



function parseName(fullName) {
  if (!fullName) return { firstName: "", lastName: "" };
  const parts = fullName.trim().split(" ");
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" ") || parts[0],
  };
}

function parseRowName(nameCell) {
  if (!nameCell)
    return {
      pointOfEntry: "",
      companyName: "",
      firstName: "Unknown",
      lastName: "Unknown",
    };

  let pointOfEntry = "";
  let companyName = "";
  let firstName = "";
  let lastName = "";

  if (nameCell.includes(":")) {
    // Split by colon
    const [beforeColon, afterColon] = nameCell.split(":");
    const entry = beforeColon.trim();
    const namePart = afterColon.trim();

    // Point of entry logic
    if (/WALK-?IN/i.test(entry)) {
      pointOfEntry = "walk-in";
    } else if (/\(([^)]+)\)/.test(entry)) {
      // Has bracket
      const bracket = entry.match(/\(([^)]+)\)/)[1].trim();
      if (bracket === "HMO") {
        pointOfEntry = "hmo";
      } else {
        pointOfEntry = "corporate";
      }
      companyName = entry.replace(/\([^)]+\)/, "").trim();
    } else {
      pointOfEntry = "corporate";
      companyName = entry;
    }

    // Name logic: all words after colon
    const nameParts = namePart.split(" ").filter(Boolean);
    firstName = nameParts[0] || "Unknown";
    lastName =
      nameParts.length > 1
        ? nameParts[nameParts.length - 1]
        : nameParts[0] || "Unknown";
  } else {
    // No colon, treat as company name only
    companyName = nameCell.trim();
    if (/hospital/i.test(companyName) && !/hospital$/i.test(companyName)) {
      companyName += " hospital";
    }
    pointOfEntry = "hospital";
    firstName = companyName; // Use company name as firstName
    lastName = companyName; // Use company name as lastName
  }

  return { pointOfEntry, companyName, firstName, lastName };
}

async function run() {
  await sequelize.authenticate();
  await sequelize.sync();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(FILE_PATH);
  if (!workbook.worksheets.length) {
    console.error(
      "No worksheets found in the Excel file. Please check the file format."
    );
    process.exit(1);
  }
  const worksheet = workbook.worksheets[0];
  if (!worksheet || !worksheet.rowCount || worksheet.rowCount < 2) {
    console.error("Worksheet is empty or missing data rows.");
    process.exit(1);
  }

  let created = 0,
    skipped = 0;
  for (let i = 2; i <= worksheet.rowCount; i++) {
    const row = worksheet.getRow(i);
    const pointOfEntry = row.getCell(1).value?.toString().trim() || "Unknown";
    let firstName = row.getCell(2).value?.toString().trim() || "Unknown";
    let lastName = row.getCell(3).value?.toString().trim() || "Unknown";
    let phone = row.getCell(4).value?.toString().trim() || "Unknown";
    let email = row.getCell(5).value?.toString().trim();

    // Defensive fallback for firstName and lastName
    if (!firstName) firstName = "Unknown";
    if (!lastName) lastName = "Unknown";

    // Generate username
    let username = (firstName + lastName).replace(/\s+/g, "").toLowerCase();
    username = username + Math.floor(Math.random() * 10000);

    // If email is missing, generate a placeholder
    if (!email) {
      email = `${username}@noemail.local`;
    }

    // Generate userId
    const userId = uuidv4();
    const password = await bcrypt.hash(DEFAULT_PASSWORD, 12);

    try {
      const user = await User.create({
        email,
        username,
        userId,
        password,
        firstName,
        lastName,
        role: "patient",
        isActive: true,
      });
      await Patient.create({
        userId: user.id,
        phone,
        pointOfEntry,
      });
      created++;
      console.log(`Imported: ${firstName} ${lastName} (${email})`);
    } catch (err) {
      skipped++;
      console.error(
        `Skipped: ${firstName} ${lastName} (${email}) - ${err.message}`
      );
    }
  }
  console.log(`\nDone! Created: ${created}, Skipped: ${skipped}`);
  await sequelize.close();
}

run();
