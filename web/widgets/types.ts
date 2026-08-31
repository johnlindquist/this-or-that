import type { OwnerId, PaneId, PaneMove, PaneState } from '../../shared/contract';

export interface WidgetPort {
  paneId: PaneId;
  getState(): PaneState;
  isEditable(): boolean;
  move(move: Omit<PaneMove, 'type' | 'paneId'>): Promise<boolean>;
  announce(message: string): void;
  interaction(active: boolean): void;
  expandedOwners?: Set<OwnerId>;
}
export interface WidgetHandle { update(): void; reveal(ownerId: OwnerId): void; destroy(): void }
export type Reveal = (ownerId: OwnerId) => void;
