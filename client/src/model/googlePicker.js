// Lets a user pick an existing Google Doc visually instead of pasting a
// URL/ID by hand. Google Picker is a separate library from Google Identity
// Services (googleAuth.js only handles sign-in, not file browsing) —
// loaded lazily since it's only needed when actually connecting a doc, not
// on every page load.
import { GOOGLE_PICKER_API_KEY } from '../config.js';

let pickerReady = null;

function loadPickerApi() {
  if (window.google?.picker) return Promise.resolve();
  if (pickerReady) return pickerReady;
  pickerReady = new Promise((resolve, reject) => {
    function loadPickerModule() {
      window.gapi.load('picker', {
        callback: resolve,
        onerror: () => {
          pickerReady = null; // let the next call retry
          reject(new Error('Failed to load Google Picker'));
        },
      });
    }
    if (window.gapi?.load) {
      loadPickerModule();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.async = true;
    script.onload = loadPickerModule;
    script.onerror = () => {
      pickerReady = null;
      reject(new Error('Failed to load Google API loader'));
    };
    document.head.appendChild(script);
  });
  return pickerReady;
}

// Resolves with the picked doc's file ID, or null if the user cancelled.
// `accessToken` needs at least the `drive.file` scope this app already
// requests — Picker is specifically designed to grant per-file access to
// whatever gets picked, without the app needing broader Drive access.
export async function pickGoogleDoc(accessToken) {
  if (!GOOGLE_PICKER_API_KEY) {
    throw new Error('Google Picker is not configured (GOOGLE_PICKER_API_KEY is empty in config.js)');
  }
  await loadPickerApi();

  return new Promise((resolve) => {
    const view = new window.google.picker.DocsView(window.google.picker.ViewId.DOCUMENTS).setMimeTypes(
      'application/vnd.google-apps.document',
    );
    const picker = new window.google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(accessToken)
      .setDeveloperKey(GOOGLE_PICKER_API_KEY)
      .setCallback((data) => {
        if (data.action === window.google.picker.Action.PICKED) {
          resolve(data.docs[0].id);
        } else if (data.action === window.google.picker.Action.CANCEL) {
          resolve(null);
        }
      })
      .build();
    picker.setVisible(true);
  });
}
