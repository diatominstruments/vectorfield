import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOTIFICATIONS, KINDS, messageParts, messageText, icon, showsCard } from '../shared/notifications.js';

const ada = { id: '1', username: 'ada', avatarUrl: null };
const song = { id: '0f1e2d3c-0000-4000-8000-000000000000', title: 'Night Drive', owner: { id: '2' } };

test('every kind has an icon and a message', () => {
  for (const kind of KINDS) {
    const t = NOTIFICATIONS[kind];
    assert.ok(t.icon, `${kind} has an icon`);
    assert.equal(typeof t.message, 'function', `${kind} has a message`);
    assert.ok(messageText({ kind, actor: ada, song }).length > 0, `${kind} says something`);
  }
});

test('the actor and song become links to their pages', () => {
  const parts = messageParts({ kind: 'song_liked', actor: ada, song });
  assert.deepEqual(parts, [
    { text: 'ada', href: '/u/ada' },
    { text: ' liked your song ' },
    { text: 'Night Drive', href: `/s/${song.id}` },
  ]);
  assert.equal(messageText({ kind: 'song_liked', actor: ada, song }), 'ada liked your song Night Drive');
  assert.equal(messageText({ kind: 'new_follower', actor: ada, song: null }), 'ada started following you');
});

test('the welcome links to the studio', () => {
  const parts = messageParts({ kind: 'welcome', actor: null, song: null });
  assert.ok(parts.some((p) => p.href === '/studio' && p.text === 'studio'));
});

test('only kinds about a song show it as a card', () => {
  assert.equal(showsCard({ kind: 'new_song', song }), true);
  assert.equal(showsCard({ kind: 'song_liked', song }), true);
  assert.equal(showsCard({ kind: 'new_follower', song: null }), false);
  assert.equal(showsCard({ kind: 'welcome', song: null }), false);
});

test('a kind since removed still renders, as something rather than nothing', () => {
  assert.equal(messageText({ kind: 'gone', actor: null, song: null }), 'Something happened');
  assert.equal(icon('gone'), '•');
});
