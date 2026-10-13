/**
 * Google Apps Script backend for QR Attendance.
 *
 * Expected sheet columns:
 * A: unique_id
 * B: name
 * C: email
 * D: phone
 * E: designation
 * F: department
 * G: attendance
 *
 * The script finds unique_id in column A and writes "Present" in column G.
 */

const SHEET_NAME = "Sheet1";
const UNIQUE_ID_COLUMN = 1; // A
const QR_LINK_COLUMN = 8;   // Column H
const ATTENDANCE_COLUMN = 7; // G
const QR_FOLDER_NAME = "HS Visitors QR Codes";

function doGet() {
  return jsonResponse_({
    success: true,
    message: "QR Attendance API is running."
  });
}

function doPost(e) {
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(10000);

    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const uniqueId = String(body.unique_id || "").trim().toUpperCase();

    if (!uniqueId) {
      return jsonResponse_({ success: false, message: "unique_id is required." });
    }

    // Use this if the script is BOUND to the attendance spreadsheet.
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

    // If you create a standalone Apps Script project instead, replace the line above with:
    // const spreadsheet = SpreadsheetApp.openById("YOUR_SPREADSHEET_ID");

    const sheet = spreadsheet.getSheetByName(SHEET_NAME);
    if (!sheet) {
      return jsonResponse_({ success: false, message: `Sheet '${SHEET_NAME}' was not found.` });
    }

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return jsonResponse_({ success: false, message: "The sheet has no employee records." });
    }

    const ids = sheet.getRange(2, UNIQUE_ID_COLUMN, lastRow - 1, 1).getDisplayValues();
    let matchedRow = -1;

    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]).trim().toUpperCase() === uniqueId) {
        matchedRow = i + 2;
        break;
      }
    }

    if (matchedRow === -1) {
      return jsonResponse_({ success: false, message: `No record found for ${uniqueId}.` });
    }

    const attendanceCell = sheet.getRange(matchedRow, ATTENDANCE_COLUMN);
    const currentStatus = String(attendanceCell.getDisplayValue()).trim().toLowerCase();

    if (currentStatus !== "present") {
      attendanceCell.setValue("Present");
    }

    // Return useful employee details to the scanner UI.
    const row = sheet.getRange(matchedRow, 1, 1, 6).getDisplayValues()[0];

    return jsonResponse_({
      success: true,
      alreadyPresent: currentStatus === "present",
      message: currentStatus === "present" ? "Attendance was already marked." : "Attendance marked successfully.",
      person: {
        unique_id: row[0],
        name: row[1],
        email: row[2],
        phone: row[3],
        designation: row[4],
        department: row[5]
      }
    });
  } catch (error) {
    return jsonResponse_({ success: false, message: error.message || String(error) });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function jsonResponse_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("QR Attendance")
    .addItem("Generate All QR Codes", "generateAllQRCodes")
    .addItem("Generate QR for Selected Row", "generateQRForSelectedRow")
    .addSeparator()
    .addItem("Open QR Folder", "showQRFolder")
    .addToUi();
}


// ==========================================
// GENERATE ALL QR CODES
// ==========================================

function generateAllQRCodes() {
  const sheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getActiveSheet();

  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert("No student data found.");
    return;
  }

  const folder = getOrCreateQRFolder();

  sheet.getRange(1, QR_LINK_COLUMN).setValue("QR Code");

  // Read ALL IDs in one operation
  const ids = sheet
    .getRange(2, UNIQUE_ID_COLUMN, lastRow - 1, 1)
    .getValues()
    .flat()
    .map(id => String(id).trim());

  // Build requests
  const requests = [];
  const validIds = [];

  ids.forEach(uniqueId => {
    if (!uniqueId) return;

    const qrUrl =
      "https://quickchart.io/qr" +
      "?text=" + encodeURIComponent(uniqueId) +
      "&size=500" +
      "&margin=2";

    requests.push({
      url: qrUrl,
      method: "get",
      muteHttpExceptions: true
    });

    validIds.push(uniqueId);
  });

  if (requests.length === 0) {
    SpreadsheetApp.getUi().alert("No valid unique IDs found.");
    return;
  }

  // 🚀 Fetch QR images in parallel
  const responses = UrlFetchApp.fetchAll(requests);

  const output = Array(lastRow - 1)
    .fill(null)
    .map(() => [""]);

  let generated = 0;
  let failed = 0;

  let responseIndex = 0;

  for (let i = 0; i < ids.length; i++) {

    const uniqueId = ids[i];

    if (!uniqueId) continue;

    const response = responses[responseIndex++];

    try {
      if (response.getResponseCode() !== 200) {
        throw new Error(
          "HTTP " + response.getResponseCode()
        );
      }

      const blob = response
        .getBlob()
        .setName(uniqueId + ".png");

      // Delete previous QR with same filename
      const existingFiles =
        folder.getFilesByName(uniqueId + ".png");

      while (existingFiles.hasNext()) {
        existingFiles.next().setTrashed(true);
      }

      const file = folder.createFile(blob);

      // HYPERLINK formula
      output[i][0] =
        '=HYPERLINK("' +
        file.getUrl() +
        '","View / Download QR")';

      generated++;

    } catch (error) {

      output[i][0] = "Generation Failed";
      failed++;

      console.error(
        uniqueId + ": " + error.message
      );
    }
  }

  // 🚀 Write ALL sheet results at once
  sheet
    .getRange(
      2,
      QR_LINK_COLUMN,
      output.length,
      1
    )
    .setFormulas(output);

  sheet.setColumnWidth(QR_LINK_COLUMN, 180);

  SpreadsheetApp.getUi().alert(
    "QR generation completed!\n\n" +
    "Generated: " + generated +
    "\nFailed: " + failed
  );
}

// ==========================================
// GENERATE QR FOR SELECTED ROW
// ==========================================

function generateQRForSelectedRow() {

  const sheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getActiveSheet();

  const row = sheet
    .getActiveCell()
    .getRow();

  if (row === 1) {

    SpreadsheetApp.getUi().alert(
      "Please select a student row first."
    );

    return;
  }

  const uniqueId = String(
    sheet
      .getRange(row, UNIQUE_ID_COLUMN)
      .getValue()
  ).trim();

  if (!uniqueId) {

    SpreadsheetApp.getUi().alert(
      "This row does not contain a unique_id."
    );

    return;
  }

  try {

    const folder = getOrCreateQRFolder();

    const file = createQRCode(
      uniqueId,
      folder
    );

    const fileUrl = file.getUrl();

    const richText = SpreadsheetApp
      .newRichTextValue()
      .setText("View / Download QR")
      .setLinkUrl(fileUrl)
      .build();

    sheet
      .getRange(row, QR_LINK_COLUMN)
      .setRichTextValue(richText);

    SpreadsheetApp.getUi().alert(
      "QR generated successfully for " +
      uniqueId
    );

  } catch (error) {

    SpreadsheetApp.getUi().alert(
      "QR generation failed:\n" +
      error.message
    );
  }
}


// ==========================================
// CREATE QR IMAGE
// ==========================================

function createQRCode(uniqueId, folder) {

  /*
   * IMPORTANT:
   *
   * QR contains ONLY:
   *
   * EMP001
   *
   * This is exactly what our attendance
   * scanner expects.
   */

  const qrAPI =
    "https://quickchart.io/qr" +
    "?text=" +
    encodeURIComponent(uniqueId) +
    "&size=500" +
    "&margin=2";

  const response = UrlFetchApp.fetch(
    qrAPI,
    {
      muteHttpExceptions: true
    }
  );

  if (response.getResponseCode() !== 200) {

    throw new Error(
      "QR API returned HTTP " +
      response.getResponseCode()
    );
  }

  const blob = response
    .getBlob()
    .setName(uniqueId + ".png");

  // --------------------------------------
  // Remove old QR if one already exists
  // --------------------------------------

  const existingFiles =
    folder.getFilesByName(
      uniqueId + ".png"
    );

  while (existingFiles.hasNext()) {

    const oldFile =
      existingFiles.next();

    oldFile.setTrashed(true);
  }

  // --------------------------------------
  // Create new QR
  // --------------------------------------

  const file =
    folder.createFile(blob);

  return file;
}


// ==========================================
// GET / CREATE GOOGLE DRIVE FOLDER
// ==========================================

function getOrCreateQRFolder() {

  const folders =
    DriveApp.getFoldersByName(
      QR_FOLDER_NAME
    );

  if (folders.hasNext()) {
    return folders.next();
  }

  return DriveApp.createFolder(
    QR_FOLDER_NAME
  );
}


// ==========================================
// SHOW QR FOLDER LINK
// ==========================================

function showQRFolder() {

  const folder =
    getOrCreateQRFolder();

  const html = HtmlService
    .createHtmlOutput(
      '<div style="font-family:Arial;padding:20px">' +

      '<h3>Persevex Student QR Codes</h3>' +

      '<p>Your QR codes are stored in Google Drive.</p>' +

      '<a href="' +
      folder.getUrl() +
      '" target="_blank">' +

      'Open QR Folder' +

      '</a>' +

      '</div>'
    )
    .setWidth(400)
    .setHeight(180);

  SpreadsheetApp
    .getUi()
    .showModalDialog(
      html,
      "QR Code Folder"
    );
}