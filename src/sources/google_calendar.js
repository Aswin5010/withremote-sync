const { google } = require('googleapis');
const https = require('https');

/**
 * Refresh the OAuth2 access token using Node's native https module with
 * keepAlive disabled. Gaxios (used by google-auth-library) fails on Render's
 * free tier with "Premature close" — a direct HTTPS call avoids that transport.
 */
function refreshTokenDirect() {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      client_id:     process.env.GCAL_CLIENT_ID,
      client_secret: process.env.GCAL_CLIENT_SECRET,
      refresh_token: process.env.GCAL_REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }).toString();

    const req = https.request(
      {
        hostname: 'oauth2.googleapis.com',
        path:     '/token',
        method:   'POST',
        headers: {
          'Content-Type':   'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
        agent: new https.Agent({ keepAlive: false }),
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error) return reject(new Error(`OAuth error: ${json.error} — ${json.error_description}`));
            resolve(json.access_token);
          } catch (e) {
            reject(new Error(`Failed to parse token response: ${data}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function getClient() {
  const accessToken = await refreshTokenDirect();

  const auth = new google.auth.OAuth2(
    process.env.GCAL_CLIENT_ID,
    process.env.GCAL_CLIENT_SECRET,
  );
  auth.setCredentials({ access_token: accessToken });

  return google.calendar({ version: 'v3', auth });
}

const CALENDAR_ID = () => process.env.GCAL_CALENDAR_ID || 'primary';

/**
 * Full fetch: get events within a 1-week window (past 3 days + next 4 days).
 * Scoping to a week avoids pulling years of calendar history on first sync.
 * Returns nextCursor = Google's nextSyncToken (used for incremental sync).
 */
async function fetchFull() {
  const calendar = await getClient();
  const records = [];
  let pageToken;
  let nextSyncToken;

  const timeMin = new Date();
  timeMin.setDate(timeMin.getDate() - 3);

  const timeMax = new Date();
  timeMax.setDate(timeMax.getDate() + 4);

  do {
    const res = await calendar.events.list({
      calendarId: CALENDAR_ID(),
      maxResults: 250,
      singleEvents: true,
      orderBy: 'startTime',
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      pageToken,
    });
    records.push(...(res.data.items || []));
    pageToken = res.data.nextPageToken;
    nextSyncToken = res.data.nextSyncToken;
  } while (pageToken);

  return { records, nextCursor: nextSyncToken };
}

/**
 * Incremental fetch: use Google's syncToken to get only changed events.
 * Google returns HTTP 410 when the syncToken is expired — caller handles fallback.
 */
async function fetchIncremental(syncToken) {
  const calendar = await getClient();
  const records = [];
  let pageToken;
  let nextSyncToken;

  do {
    const res = await calendar.events.list({
      calendarId: CALENDAR_ID(),
      maxResults: 250,
      // syncToken goes on the first page only; subsequent pages use pageToken
      ...(pageToken ? { pageToken } : { syncToken }),
    });
    records.push(...(res.data.items || []));
    pageToken = res.data.nextPageToken;
    nextSyncToken = res.data.nextSyncToken;
  } while (pageToken);

  return { records, nextCursor: nextSyncToken };
}

module.exports = { fetchFull, fetchIncremental };
