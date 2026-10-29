import { EventEmitter } from 'events'

export interface SyncEventPayload {
  entity: 'products' | 'chairs' | 'clients' | 'testimonials' | 'settings' | 'orders' | 'leads' | 'all'
  action: 'create' | 'update' | 'delete' | 'toggle-stock' | 'toggle-featured' | 'toggle-production' | 'reset'
  id?: string
  data?: any
  timestamp?: string
}

class SyncEventEmitter extends EventEmitter {
  constructor() {
    super()
    this.setMaxListeners(200)
  }

  notify(entity: SyncEventPayload['entity'], action: SyncEventPayload['action'], id?: string, data?: any) {
    const payload: SyncEventPayload = {
      entity,
      action,
      id,
      data,
      timestamp: new Date().toISOString(),
    }
    this.emit('sync', payload)
  }
}

export const syncEvents = new SyncEventEmitter()
