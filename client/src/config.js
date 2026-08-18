// Public identifiers safe to ship in client code — an OAuth client ID
// (unlike its secret) isn't sensitive; only the Authorized JavaScript
// origins configured for it in Google Cloud Console control who can use
// it. This app never uses a client secret at all: sign-in runs entirely in
// the browser via Google Identity Services' token flow (see
// model/googleAuth.js), so there's no backend to hold one.
export const GOOGLE_OAUTH_CLIENT_ID = '320206927376-laipohj3nd4lj7pjld8qlfn2anv1bm5o.apps.googleusercontent.com';

// documents: create/edit the target Doc. drive.file: only files this app
// itself creates (the temporary diagram image upload) — never the rest of
// the user's Drive.
export const GOOGLE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/drive.file',
].join(' ');

// A browser API key for the Google Picker widget (model/googlePicker.js) —
// distinct from the OAuth client above. Restrict it in Cloud Console to
// the Google Picker API only, and to this app's origins (HTTP referrers).
// Not sensitive the same way a client secret is, but keep it referrer-
// restricted rather than wide open.
export const GOOGLE_PICKER_API_KEY = '';
