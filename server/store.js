// The single place that touches storage.
// Backed by Firestore (the (default) database) via Application Default
// Credentials, using the @google-cloud/firestore library.
//
// get and save are async and talk to Firestore directly. There is no in-memory
// mirror and no background writing: a save is durably written before its promise
// resolves, and a get reads current data from Firestore every time. This is what
// makes storage safe on Cloud Run, where several instances share one database.

import { Firestore } from '@google-cloud/firestore';

// One document per key (tasks, profile, signals). Firestore documents must be
// maps, so each value is wrapped as { value } and unwrapped on read.
const COLLECTION = 'stride';

const db = new Firestore(); // Application Default Credentials + (default) database
const collection = db.collection(COLLECTION);

// get(key) -> the stored value, or null if the key has never been saved.
export async function get(key) {
  const snapshot = await collection.doc(key).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data();
  return data ? data.value ?? null : null;
}

// save(key, value) -> write the value and wait for Firestore to confirm the
// write before resolving, then return the value.
export async function save(key, value) {
  await collection.doc(key).set({ value });
  return value;
}
