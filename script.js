```javascript
"use strict";

// ========================================
// CONFIGURATION
// ========================================

const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbwZLcJC6MZPPZQJUHnvrq1Z3Fu0MXpzHIzJmRqJcnt0Uux3N-O_CrmJ2Ea6EQxgtgdaNyw/exec";

const SCANNER_ID = "reader";

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
let isSubmitting = false;
let lastScannedId = "";
let lastScanTime = 0;

// ========================================
// ELEMENTS
// ========================================

const statusBox = document.getElementById("status");
const statusTitle = document.getElementById("status-title");
const statusMessage = document.getElementById("status-message");
const restartBtn = document.getElementById("restart-btn");
const manualForm = document.getElementById("manual-form");
const manualId = document.getElementById("manual-id");
const sessionSelect = document.getElementById("attendance-session");

// ========================================
// STATUS
// ========================================

function setStatus(type, title, message) {
  if (statusBox) {
    statusBox.className = "status status-" + type;
  }

  if (statusTitle) {
    statusTitle.textContent = title;
  }

  if (statusMessage) {
    statusMessage.textContent = message;
  }
}

function normalizeId(value) {
  return String(value || "").trim().toUpperCase();
}

function getSelectedSession() {
  return String(sessionSelect?.value || "")
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
// SUBMIT ATTENDANCE
// ========================================

async function submitAttendance(rawId) {
  const userId = normalizeId(rawId);

  if (!userId || isSubmitting) {
    return;
  }

  const session = getSelectedSession();

  if (!VALID_SESSIONS.includes(session)) {
    setStatus(
      "error",
      "Select a session",
      "Choose an attendance session before scanning."
    );
    return;
  }

  isSubmitting = true;

  if (restartBtn) {
    restartBtn.hidden = true;
  }

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
      }),
      redirect: "follow"
    });

    if (!response.ok) {
      throw new Error("HTTP error: " + response.status);
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
        ? "Contact: " + person.contact_number
        : "",
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
    console.error("Attendance submission failed:", error);

    setStatus(
      "error",
      "Attendance Not Marked",
      error.message ||
        "Request failed. Check your connection and Apps Script deployment."
    );

  } finally {
    isSubmitting = false;

    if (restartBtn) {
      restartBtn.hidden = false;
    }
  }
}

// ========================================
// QR SCAN CALLBACK
// ========================================

function onScanSuccess(decodedText) {
  const userId = normalizeId(decodedText);

  if (!userId || isSubmitting) {
    return;
  }

  const now = Date.now();

  if (
    userId === lastScannedId &&
    now - lastScanTime < 3000
  ) {
    return;
  }

  lastScannedId = userId;
  lastScanTime = now;

  submitAttendance(userId);
}

function onScanFailure() {
  // No action needed while the camera searches for a QR code.
}

// ========================================
// START SCANNER
// ========================================

function startScanner() {
  const reader = document.getElementById(SCANNER_ID);

  if (!reader) {
    setStatus(
      "error",
      "Scanner element missing",
      'Add <div id="reader"></div> to index.html.'
    );
    return;
  }

  if (typeof Html5QrcodeScanner === "undefined") {
    setStatus(
      "error",
      "Scanner library unavailable",
      "Refresh the page and check your internet connection."
    );
    return;
  }

  if (scanner) {
    return;
  }

  setStatus(
    "neutral",
    "Ready to scan",
    "Select a session and point your camera at a participant QR code."
  );

  scanner = new Html5QrcodeScanner(
    SCANNER_ID,
    {
      fps: 10,
      qrbox: {
        width: 240,
        height: 240
      },
      rememberLastUsedCamera: true,
      supportedScanTypes: [
        Html5QrcodeScanType.SCAN_TYPE_CAMERA
      ]
    },
    false
  );

  scanner.render(onScanSuccess, onScanFailure);
}

// ========================================
// RESTART BUTTON
// ========================================

if (restartBtn) {
  restartBtn.addEventListener("click", function () {
    lastScannedId = "";
    lastScanTime = 0;

    if (scanner) {
      scanner.clear()
        .then(function () {
          scanner = null;
          startScanner();
        })
        .catch(function (error) {
          console.error("Scanner restart failed:", error);

          scanner = null;

          setStatus(
            "error",
            "Restart scanner",
            "Refresh the page if the camera cannot restart."
          );
        });
    } else {
      startScanner();
    }
  });
}

// ========================================
// MANUAL ID ENTRY
// ========================================

if (manualForm && manualId) {
  manualForm.addEventListener("submit", async function (event) {
    event.preventDefault();

    const userId = manualId.value.trim();

    if (!userId) {
      setStatus(
        "error",
        "ID required",
        "Enter a participant ID first."
      );
      return;
    }

    await submitAttendance(userId);

    manualId.value = "";
  });
}

// ========================================
// SESSION CHANGE
// ========================================

if (sessionSelect) {
  sessionSelect.addEventListener("change", function () {
    const session = getSelectedSession();

    if (!VALID_SESSIONS.includes(session)) {
      return;
    }

    setStatus(
      "neutral",
      "Session Selected",
      formatSession(session) + ". Ready to scan."
    );
  });
}

// ========================================
// INITIALIZE
// ========================================

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startScanner);
} else {
  startScanner();
}
```