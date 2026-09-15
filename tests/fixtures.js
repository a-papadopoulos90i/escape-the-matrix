import { test as base, expect } from 'playwright/test';

// The deployed site carries a real Firebase config. Tests run the app in free mode (no network, no
// real sign-in) by serving a null config; account specs inject their own fake Firebase session.
export const FREE_MODE_CONFIG ="export const firebaseConfig = null;\nexport const authProviders = ['google', 'email'];\n";

export const test = base.extend({
  context: async ({ context }, use) => {
    // The waiting list starts collapsed for visitors; specs start with it open (one spec checks the default).
    await context.addInitScript(() => {
      if (!sessionStorage.getItem('levelix:keepWaitingDefault')) localStorage.setItem('levelix:waitingOpen', '1');
    });
    await context.route('**/js/firebase-config.js*', (route) =>
      route.fulfill({ status: 200, contentType: 'text/javascript', body: FREE_MODE_CONFIG }),
    );
    await use(context);
  },
});

export { expect };
