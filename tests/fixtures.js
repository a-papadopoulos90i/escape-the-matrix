import { test as base, expect } from 'playwright/test';

// The deployed site carries a real Firebase config. Tests run the app in free mode (no network, no
// real sign-in) by serving a null config; account specs inject their own fake Firebase session.
export const FREE_MODE_CONFIG ="export const firebaseConfig = null;\nexport const authProviders = ['google', 'apple', 'email'];\n";

export const test = base.extend({
  context: async ({ context }, use) => {
    // The waiting list starts collapsed for visitors; specs start with it open (one spec checks the default).
    await context.addInitScript(() => {
      if (sessionStorage.getItem('levelix:keepWaitingDefault')) return;
      localStorage.setItem('levelix:waitingOpen', '1');
      localStorage.setItem('levelix:repeatOpen', '1');
    });
    await context.route('**/js/firebase-config.js*', (route) =>
      route.fulfill({ status: 200, contentType: 'text/javascript', body: FREE_MODE_CONFIG }),
    );
    await use(context);
  },
});

/**
 * Runs the page as a Pro account: the timer, moving tasks to another day, the statistics, the Time report
 * and the calendar's All Tasks view are open. (Without it a spec is a Free visitor, as on the live site.)
 */
export async function asPro(page) {
  await page.route('**/js/plan.js*', async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace("let current = 'free';", "let current = 'pro';");
    await route.fulfill({ response, body });
  });
}

export { expect };
