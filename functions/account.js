// When an account is deleted (Delete account in the app, or from the console), what it kept in the
// cloud goes with it: its planner (users/{uid} and its months) and its Pro state (billing/{uid}). Sales records stay —
// tax law needs them — and keep only the uid. Firestore is handed in, so this is unit-tested.
export function createCleanup({ db }) {
  return async function cleanup(uid) {
    if (!uid) return [];
    // The planner is a root document with one document per month under it: all of it goes.
    await db.recursiveDelete(db.collection('users').doc(uid));
    await db.collection('billing').doc(uid).delete(); // deleting what is not there is not an error
    return [`users/${uid} (with its months)`, `billing/${uid}`];
  };
}
