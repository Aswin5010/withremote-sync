/**
 * One-time script to obtain a Google Calendar OAuth2 refresh token.
 * Run: node scripts/gcal_auth.js
 * Then copy the printed GCAL_REFRESH_TOKEN into your .env file.
 */
require('dotenv').config();
const { google } = require('googleapis');
const http       = require('http');
const url        = require('url');

const REDIRECT_URI = 'http://localhost:3001/callback';
const SCOPES       = ['https://www.googleapis.com/auth/calendar'];

const oauth2Client = new google.auth.OAuth2(
  process.env.GCAL_CLIENT_ID,
  process.env.GCAL_CLIENT_SECRET,
  REDIRECT_URI,
);

async function main() {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope:       SCOPES,
    prompt:      'consent', // force refresh_token to be returned every time
  });

  console.log('\nOpen this URL in your browser:\n');
  console.log(authUrl);
  console.log('\nWaiting for callback on http://localhost:3001/callback ...\n');

  await new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const { query } = url.parse(req.url, true);
      if (!query.code) {
        res.end('No code received.');
        return;
      }

      try {
        const { tokens } = await oauth2Client.getToken(query.code);

        console.log('\nSuccess! Add this to your .env:\n');
        console.log(`GCAL_REFRESH_TOKEN=${tokens.refresh_token}`);

        res.end('Authentication complete — you can close this tab.');
        server.close(resolve);
      } catch (err) {
        res.end('Error: ' + err.message);
        server.close(() => reject(err));
      }
    });

    server.listen(3001, () => {
      console.log('Listening on http://localhost:3001 ...');
    });
  });
}

main().catch((err) => { console.error(err); process.exit(1); });
