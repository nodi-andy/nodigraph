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
