/**
 * Adapters - Backend adapters for chat
 */

export type { ChatAdapter, SendMessage, AdapterConfig } from './types';
export { createSanqianAdapter, type SanqianAdapterConfig } from './sanqian';
export { createElectronAdapter, type ElectronAdapterConfig } from './electron';
