# QR Attendance Scanner

Static HTML/CSS/JS frontend for GitHub Pages plus a Google Apps Script backend.

## Google Sheet structure

Create these headers in row 1:

| A | B | C | D | E | F | G |
|---|---|---|---|---|---|---|
| unique_id | name | email | phone | designation | department | attendance |

Each QR code should contain only the employee ID, for example `EMP023`.

## Apps Script setup

1. Open the Google Sheet.
2. Go to **Extensions > Apps Script**.
3. Replace the default code with the contents of `Code.gs`.
4. Change `SHEET_NAME` if your tab is not named `Sheet1`.
5. Click **Deploy > New deployment**.
6. Select **Web app**.
7. Set **Execute as** to **Me**.
8. Set access so the scanner users can invoke the web app (for a public scanner, typically **Anyone**).
9. Deploy and authorize the script.
10. Copy the deployed URL ending in `/exec`.

## Frontend setup

1. Open `script.js`.
2. Replace `PASTE_YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE` with your `/exec` URL.
3. Commit `index.html`, `style.css`, and `script.js` to your GitHub repository.
4. Enable GitHub Pages for the repository.
5. Open the HTTPS GitHub Pages URL and allow camera permission.

## Flow

QR (`EMP023`) -> browser scanner -> Apps Script -> find `EMP023` in column A -> write `Present` in column G -> return employee details -> show success in browser.

The frontend intentionally does not contain the employee database. The QR contains only the unique ID; employee details remain in Google Sheets and are returned by Apps Script after a valid scan.
