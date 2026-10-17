// When an account is deleted (Delete account in the app, or from the console), what it kept in the
// cloud goes with it: its planner (users/{uid}) and its Pro state (billing/{uid}). Sales records stay —
// tax law needs them — and keep only the uid. Firestore is handed in, so this is unit-tested.
export function createCleanup({ db }) {
  return async function cleanup(uid) {
    if (!uid) return [];
    const gone = [];
    for (const collection of ['users', 'billing']) {
      await db.collection(collection).doc(uid).delete(); // deleting what is not there is not an error
      gone.push(`${collection}/${uid}`);
    }
    return gone;
  };
}
