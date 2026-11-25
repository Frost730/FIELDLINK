import { registerPlugin, Capacitor } from '@capacitor/core';

export interface WifiDirectDevice {
  deviceName: string;
  deviceAddress: string;
  status: number;
}

export interface FieldlinkWifiDirectPluginInterface {
  checkStatus(): Promise<{ supported: boolean; initialized: boolean; activeConnections?: number }>;
  discoverPeers(): Promise<{ status: string }>;
  getPeerList(): Promise<{ peers: WifiDirectDevice[] }>;
  connectToDevice(options: { deviceAddress: string }): Promise<{ status: string; deviceAddress: string }>;
  sendPayload(options: { data: string }): Promise<{ sentCount: number }>;
  stopPeerDiscovery(): Promise<{ status: string }>;
  addListener(
    eventName: 'wifiDirectConnected',
    listenerFunc: (data: { groupFormed: boolean; isGroupOwner: boolean; host: string }) => void
  ): Promise<{ remove: () => void }>;
  addListener(
    eventName: 'wifiDirectPayloadReceived',
    listenerFunc: (data: { data: string }) => void
  ): Promise<{ remove: () => void }>;
  addListener(eventName: 'wifiDirectDisconnected', listenerFunc: () => void): Promise<{ remove: () => void }>;
}

export const NativeWifiDirect = registerPlugin<FieldlinkWifiDirectPluginInterface>('FieldlinkWifiDirect');

export class FieldlinkWifiDirectService {
  private static isNative = Capacitor.isNativePlatform();

  static async send(data: string): Promise<number> {
    if (!this.isNative) return 0;
    try {
      const res = await NativeWifiDirect.sendPayload({ data });
      return res.sentCount || 0;
    } catch {
      return 0;
    }
  }
}
