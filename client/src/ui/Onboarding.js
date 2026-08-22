import { showToast } from './Toast.js';

// Shown once per browser, gated on localStorage rather than anything about
// the diagram itself — it's teaching the app, not the current drawing, so
// it fires the same whether this tab just made a blank project or opened
// someone else's shared link.
const STORAGE_KEY = 'noditron-onboarded';

const STEPS = [
  "Welcome to noditron. Everything you draw here stays only in this browser — nothing is uploaded anywhere unless you explicitly create a Share link or download a file.",
  'Click the blue + button (bottom right) to add a block.',
  "Drag from a block's edge to add a port, then drag from one port's connector handle to another to wire them together.",
  'Select a block and use "Enter block →" in the Inspector to design what’s inside it — a diagram can nest as many levels deep as you like.',
  'When you’re ready to hand it off, use Share to get a link that opens this exact diagram — still nothing but a browser needed on either end.',
];

export function maybeShowOnboarding() {
  let alreadySeen;
  try {
    alreadySeen = localStorage.getItem(STORAGE_KEY);
  } catch {
    return; // Storage blocked (private mode, locked-down browser) — skip rather than nag every load.
  }
  if (alreadySeen) return;

  let index = 0;

  function finish() {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // Nothing to fall back to — worst case the tour repeats next visit.
    }
  }

  function showStep() {
    const isLast = index === STEPS.length - 1;
    const actions = [];
    if (!isLast) actions.push({ label: 'Skip', onClick: finish });
    actions.push({
      label: isLast ? 'Got it' : 'Next',
      onClick: isLast
        ? finish
        : () => {
            index += 1;
            showStep();
          },
    });
    showToast(STEPS[index], { actions, autoDismissMs: 0 });
  }

  showStep();
}
