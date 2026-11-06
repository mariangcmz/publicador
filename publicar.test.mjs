import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pendientes } from './publicar.mjs';

test('solo pendientes con hora cumplida', () => {
  const ahora = new Date('2026-11-06T18:00:00-06:00');
  const cola = [
    { id: 'a', estado: 'pendiente', fecha: '2026-11-06T17:59:00-06:00' },
    { id: 'b', estado: 'pendiente', fecha: '2026-11-06T18:01:00-06:00' },
    { id: 'c', estado: 'publicado', fecha: '2026-11-01T10:00:00-06:00' },
    { id: 'd', estado: 'plantilla', fecha: '2020-01-01T00:00:00Z' },
  ];
  assert.deepEqual(pendientes(cola, ahora).map(p => p.id), ['a']);
});
