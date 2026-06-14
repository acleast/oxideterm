import { describe, expect, it } from 'vitest';
import { canSaveNodeAsPreset } from '@/components/sessions/nodeActions';
import type { TreeNodeOriginType } from '@/types';

describe('session node actions', () => {
  it.each([
    ['direct', true],
    ['drill_down', true],
    ['manual_preset', false],
    ['auto_route', false],
    ['restored', false],
  ] satisfies Array<[TreeNodeOriginType, boolean]>)(
    'maps %s origin to save-as-preset visibility',
    (originType, expected) => {
      expect(canSaveNodeAsPreset({ originType })).toBe(expected);
    },
  );
});
