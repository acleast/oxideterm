// Copyright (C) 2026 AnalyseDeCircuit
// SPDX-License-Identifier: GPL-3.0-only

import type { UnifiedFlatNode } from '@/types';

/**
 * Only runtime-created nodes can be promoted into saved connection presets.
 *
 * `sshConnectionId` is a live backend connection id, not a persisted preset id,
 * so the menu gate must use the tree origin semantics instead.
 */
export function canSaveNodeAsPreset(node: Pick<UnifiedFlatNode, 'originType'>): boolean {
  return node.originType === 'direct' || node.originType === 'drill_down';
}
