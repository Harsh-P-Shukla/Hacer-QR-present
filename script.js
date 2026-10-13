"use strict";

// ========================================
// CONFIGURATION
// ========================================

const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbwZLcJC6MZPPZQJUHnvrq1Z3Fu0MXpzHIzJmRqJcnt0Uux3N-O_CrmJ2Ea6EQxgtgdaNyw/exec";

const VALID_SESSIONS = [
  "registration",
  "food day 1 breakfast",
  "food day 1 lunch",
  "food day 1 dinner",
  "food day 2 breakfast",
  "food day 2 lunch",
  "food day 2 dinner"
];

// ========================================
// STATE
// ========================================

let scanner = null;
let cameraRunning = false;
let isSubmitting = false;
let isStartingCamera = false;
let lastScannedId = "";
let lastScanTime = 0;

// ========================================
// ELEMENTS
// ========================================

const reader = document.getElementById("reader");
const cameraBtn = document.getElementById("camera-btn");
const statusBox = document.getElementById("status");
const statusTitle = document.getElementById("status-title");
const statusMessage = document.getElementById("status-message");
const restartBtn = document.getElementById("restart-btn");
const manualForm = document.getElementById("manual-form");
const manualId = document.getElementById("manual-id");
const sessionSelect = document.getElementById("attendance-session");

// ========================================
// STATUS HELPERS
// ========================================

function setStatus(type, title, message) {
  statusBox.className = "status status-" + type;
  statusTitle.textContent = title;
  statusMessage.textContent = message;
}

function normalizeId(value) {
  return String(value || "").trim().toUpperCase();
}

function getSession() {
  return String(sessionSelect.value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function formatSession(session) {
  return session.replace(/\b[a-z]/g, function (letter) {
    return letter.toUpperCase();
  });
}

// ========================================
// CAMERA PERMISSION AND STARTUP
// ========================================

async function startCamera() {
  if (cameraRunning || isStartingCamera) return;

  if (!window.isSecureContext) {
    setStatus(
      "error",
      "Secure connection required",
      "Open this website using its HTTPS Vercel URL."
    );
    return;
  }

  if (!navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia) {
    setStatus(
      "error",
      "Camera unavailable",
      "Your browser does not support camera access. Open this website in Chrome."
    );
    return;
  }

  if (typeof Html5Qrcode === "undefined") {
    setStatus(
      "error",
      "Scanner library unavailable",
      "Check your internet connection and reload the page."
    );
    return;
  }

  isStartingCamera = true;
  cameraBtn.disabled = true;
  cameraBtn.textContent = "Requesting Camera Permission...";

  setStatus(
    "loading",
    "Requesting camera permission",
    "Allow camera access in the browser popup."
  );

  try {
    if (!scanner) {
      scanner = new Html5Qrcode("reader");
    }

    // This triggers the browser's camera permission flow.
    await scanner.start(
      { facingMode: "environment" },
      {
        fps: 10,
        qrbox: { width: 240, height: 240 },
        aspectRatio: 1
      },
      onScanSuccess,
      function () {
        // Normal while the camera searches for a QR code.
      }
    );

    cameraRunning = true;
    cameraBtn.textContent = "Camera Enabled";
    cameraBtn.disabled = true;

    setStatus(
      "success",
      "Camera Ready",
      "Select an attendance session and scan a participant QR code."
    );

  } catch (error) {
    console.error("Camera startup error:", error);

    const errorName = error && error.name;
    let message =
      error.message || "Unable to start the camera.";

    if (
      errorName === "NotAllowedError" ||
      errorName === "PermissionDeniedError"
    ) {
      message =
        "Camera permission was denied. Open Chrome site settings, allow Camera, and try again.";
    } else if (errorName === "NotFoundError") {
      message = "No available camera was found on this device.";
    } else if (errorName === "NotReadableError") {
      message =
        "The camera is being used by another app. Close that app and try again.";
    }

    setStatus("error", "Camera Could Not Start", message);

    cameraBtn.disabled = false;
    cameraBtn.textContent = "Try Camera Permission Again";

    // Retry with the default camera if the rear camera is unavailable.
    if (errorName === "OverconstrainedError") {
      setStatus(
        "error",
        "Rear camera unavailable",
        "Tap the button to retry camera access."
      );
    }

  } finally {
    isStartingCamera = false;
  }
}

cameraBtn.addEventListener("click", startCamera);

// ========================================
// QR SCANNING
// ========================================

async function onScanSuccess(decodedText) {
  if (!cameraRunning || isSubmitting) return;

  const userId = normalizeId(decodedText);
  if (!userId) return;

  const now = Date.now();

  if (
    userId === lastScannedId &&
    now - lastScanTime < 3000
  ) {
    return;
  }

  lastScannedId = userId;
  lastScanTime = now;

  try {
    await scanner.pause(true);
  } catch (error) {
    console.warn("Scanner pause warning:", error);
  }

  await submitAttendance(userId);

  if (cameraRunning && scanner && !isSubmitting) {
    try {
      scanner.resume();
    } catch (error) {
      console.warn("Scanner resume warning:", error);
    }
  }
}

// ========================================
// SUBMIT ATTENDANCE
// ========================================

async function submitAttendance(rawId) {
  const userId = normalizeId(rawId);
  const session = getSession();

  if (!userId || isSubmitting) return;

  if (!VALID_SESSIONS.includes(session)) {
    setStatus(
      "error",
      "Select a session",
      "Choose an attendance session before scanning."
    );
    return;
  }

  isSubmitting = true;
  restartBtn.hidden = true;

  setStatus(
    "loading",
    "Checking participant...",
    "Verifying " + userId + " for " + formatSession(session) + "."
  );

  try {
    const response = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify({
        user_id: userId,
        session: session
      })
    });

    if (!response.ok) {
      throw new Error("Server returned HTTP " + response.status);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(
        result.message || "Attendance could not be marked."
      );
    }

    const person = result.person || {};

    const details = [
      "ID: " + (person.user_id || userId),
      person.name ? "Name: " + person.name : "",
      person.paper_id ? "Paper ID: " + person.paper_id : "",
      person.paper_title ? "Paper: " + person.paper_title : "",
      person.contact_number
        ? "Contact: " + person.contact_number : "",
      person.email ? "Email: " + person.email : "",
      "Session: " + formatSession(result.session || session)
    ].filter(Boolean);

    setStatus(
      result.alreadyPresent ? "neutral" : "success",
      result.alreadyPresent
        ? "Already Marked Present"
        : "Attendance Marked Successfully",
      details.join(" | ")
    );

  } catch (error) {
    console.error("Attendance error:", error);

    setStatus(
      "error",
      "Attendance Not Marked",
      error.message || "Check your connection and try again."
    );

  } finally {
    isSubmitting = false;
    restartBtn.hidden = false;
  }
}

// ========================================
// RESTART SCANNING
// ========================================

restartBtn.addEventListener("click", async function () {
  if (isSubmitting) return;

  lastScannedId = "";
  lastScanTime = 0;

  if (!cameraRunning || !scanner) {
    restartBtn.hidden = true;
    await startCamera();
    return;
  }

  try {
    scanner.resume();
    restartBtn.hidden = true;

    setStatus(
      "success",
      "Ready to scan",
      "Point the camera at the next participant's QR code."
    );
  } catch (error) {
    console.error("Scanner resume error:", error);

    cameraRunning = false;
    cameraBtn.disabled = false;
    cameraBtn.textContent = "Enable Camera & Start Scanning";

    setStatus(
      "error",
      "Restart Required",
      "Tap the camera button to restart scanning."
    );
  }
});

// ========================================
// MANUAL ID ENTRY
// ========================================

manualForm.addEventListener("submit", async function (event) {
  event.preventDefault();

  const userId = manualId.value.trim();
  if (!userId || isSubmitting) return;

  await submitAttendance(userId);
  manualId.value = "";
});

// ========================================
// SESSION CHANGE
// ========================================

sessionSelect.addEventListener("change", function () {
  const session = getSession();

  if (!VALID_SESSIONS.includes(session)) return;

  setStatus(
    cameraRunning ? "success" : "neutral",
    cameraRunning ? "Camera Ready" : "Session Selected",
    formatSession(session) +
      (cameraRunning
        ? ". Ready to scan."
        : ". Tap Enable Camera to begin.")
  );
});