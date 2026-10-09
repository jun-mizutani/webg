// ---------------------------------------------
// PhysicsEvents.js  2026/08/28
//   Contact pair history and listener notification for PhysicsSpace
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// contact pairの順序に依存しないkeyを作る
// body IDの採番はPhysicsSpaceに残し、ここではevent用のkey形式だけをまとめます
export function getPhysicsContactPairKey(space, bodyA, bodyB) {
  const idA = space._getBodyId(bodyA);
  const idB = space._getBodyId(bodyB);
  return idA < idB ? `${idA}:${idB}` : `${idB}:${idA}`;
}

// manifold pairのkeyを作る
export function getPhysicsManifoldPairKey(space, bodyA, bodyB) {
  return getPhysicsContactPairKey(space, bodyA, bodyB);
}

// solver反復ぶん並ぶcontactから、pairごとの代表contactを1件にまとめる
export function buildPhysicsContactMap(space, contacts) {
  const contactMap = new Map();
  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    const key = getPhysicsContactPairKey(space, contact.bodyA, contact.bodyB);
    const previous = contactMap.get(key);
    if (!previous || contact.penetration > previous.penetration) {
      contactMap.set(key, space._cloneContact(contact));
    }
  }
  return contactMap;
}

// 直前stepと今回stepのcontact pair差分からbegin / stay / endを作る
export function buildPhysicsContactEvents(space, currentContactMap) {
  const events = {
    begin: [],
    stay: [],
    end: []
  };

  for (const [key, contact] of currentContactMap.entries()) {
    if (space.previousContactMap.has(key)) {
      events.stay.push(space._cloneContact(contact));
    } else {
      events.begin.push(space._cloneContact(contact));
    }
  }
  for (const [key, contact] of space.previousContactMap.entries()) {
    if (!currentContactMap.has(key)) {
      events.end.push(space._cloneContact(contact));
    }
  }
  return events;
}

// triggerを含むcontactかどうかを返す
export function isPhysicsTriggerContact(contact) {
  return contact.bodyA?.getTrigger?.() === true || contact.bodyB?.getTrigger?.() === true;
}

// listener引数を検証して返す
export function readPhysicsContactListener(listener, name) {
  if (typeof listener !== "function") {
    throw new Error(`${name} must be a function`);
  }
  return listener;
}

// listener配列へ重複なく登録する
export function addPhysicsContactListener(space, listeners, listener, name) {
  const validatedListener = readPhysicsContactListener(listener, name);
  if (!listeners.includes(validatedListener)) {
    listeners.push(validatedListener);
  }
  return space;
}

// listener配列から指定listenerを削除する
export function removePhysicsContactListener(space, listeners, listener, name) {
  const validatedListener = readPhysicsContactListener(listener, name);
  const index = listeners.indexOf(validatedListener);
  if (index >= 0) {
    listeners.splice(index, 1);
  }
  return space;
}

// 直近stepのcontact eventを各phaseのlistenerへ通知する
export function emitPhysicsContactEvents(space, events) {
  emitPhysicsContactList(space, events.begin, space.beginContactListeners, "begin");
  emitPhysicsContactList(space, events.stay, space.stayContactListeners, "stay");
  emitPhysicsContactList(space, events.end, space.endContactListeners, "end");
}

// event種別ごとのlistenerを順に呼ぶ
export function emitPhysicsContactList(space, contacts, listeners, phase) {
  for (let i = 0; i < contacts.length; i++) {
    const clonedContact = space._cloneContact(contacts[i]);
    for (let j = 0; j < listeners.length; j++) {
      listeners[j](clonedContact, phase, space);
    }
  }
}
