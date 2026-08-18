// Browser-only OAuth via Google Identity Services — no backend, no client
// secret, no stored refresh token. A consent popup shows the first time
// (or after access lapses/gets revoked); once granted, later calls in the
// same tab resolve without one. That fits how this is used: an occasional,
// deliberate "Update Doc" click, not a continuous background sync.
import { GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_SCOPES } from '../config.js';

let tokenClient = null;
let accessToken = null;
let tokenExpiresAt = 0;

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-gis]');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load Google Identity Services')));
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.dataset.gis = 'true';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(script);
  });
}

async function ensureTokenClient() {
  await loadGis();
  if (!tokenClient) {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_OAUTH_CLIENT_ID,
      scope: GOOGLE_OAUTH_SCOPES,
      callback: () => {}, // replaced per-request below
    });
  }
  return tokenClient;
}

export async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiresAt - 30_000) return accessToken;

  const client = await ensureTokenClient();
  return new Promise((resolve, reject) => {
    client.callback = (response) => {
      if (response.error) {
        reject(new Error(response.error_description || response.error));
        return;
      }
      accessToken = response.access_token;
      tokenExpiresAt = Date.now() + response.expires_in * 1000;
      resolve(accessToken);
    };
    client.error_callback = (err) => reject(new Error(err?.message || 'Google sign-in was cancelled'));
    client.requestAccessToken();
  });
}
