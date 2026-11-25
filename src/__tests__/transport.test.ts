import { describe, it, expect } from 'vitest';
import { TransportManager } from '../services/transport/TransportManager';

describe('Automatic Multi-Transport Manager', () => {
  it('initializes with NEARBY_CONNECTIONS as primary transport', () => {
    const state = TransportManager.getState();
    expect(state.activeTransport).toBe('NEARBY_CONNECTIONS');
    expect(state.availableTransports).toContain('NEARBY_CONNECTIONS');
    expect(state.availableTransports).toContain('WIFI_DIRECT');
    expect(state.availableTransports).toContain('LOCAL_HOTSPOT');
  });

  it('records peer heartbeats and tracks connected node count', () => {
    TransportManager.recordPeerHeartbeat('peer-node-alpha');
    TransportManager.recordPeerHeartbeat('peer-node-bravo');

    const state = TransportManager.getState();
    expect(state.connectedPeerCount).toBe(2);
  });

  it('provides active transport subscription updates', () => {
    let capturedTransport = '';
    const unsub = TransportManager.subscribe((st) => {
      capturedTransport = st.activeTransport;
    });

    expect(capturedTransport).toBe('NEARBY_CONNECTIONS');
    unsub();
  });
});
