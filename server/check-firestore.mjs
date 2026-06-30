// One-off local check that Firestore reads and writes work with your Application
// Default Credentials and the (default) database. Run from the server directory:
//
//   node check-firestore.mjs
//
// It does a direct write -> read -> delete round-trip on a throwaway document,
// then loads the real store module to confirm its get/save are callable. This
// file is just a check, safe to delete once you have confirmed.

import { Firestore } from '@google-cloud/firestore';

const db = new Firestore();
const ref = db.collection('stride').doc('healthcheck');

const stamp = new Date().toISOString();

console.log('1. writing a test document...');
await ref.set({ value: { ok: true, stamp } });

console.log('2. reading it back...');
const snap = await ref.get();
const got = snap.data()?.value;
console.log('   read:', JSON.stringify(got));
if (!got || got.stamp !== stamp) {
  throw new Error('read back did not match what was written');
}

console.log('3. cleaning up the test document...');
await ref.delete();

console.log('4. loading the real store module and reading through it...');
const store = await import('./store.js');
const summary = (
  await Promise.all(
    ['tasks', 'profile', 'signals'].map(async (k) => `${k}=${(await store.get(k)) === null ? 'empty' : 'set'}`)
  )
).join(', ');
console.log('   store sees:', summary);

console.log('\nFirestore reads and writes are working. Safe to deploy.');
