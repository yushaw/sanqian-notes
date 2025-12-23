/**
 * Adapters - Backend adapters for chat
 */

export type { ChatAdapter, SendMessage, AdapterConfig } from './types';
export { createElectronAdapter, type ElectronAdapterConfig } from './electron';
