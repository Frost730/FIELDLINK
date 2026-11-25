import { registerPlugin, Capacitor } from '@capacitor/core';

export interface LocationPosition {
  latitude: number;
  longitude: number;
  altitude: number | null;
  accuracy: number | null;
  speed: number | null;
  bearing: number | null;
  timestamp: number;
  satellites?: number;
  provider?: string;
}

export interface FieldlinkLocationPluginInterface {
  checkGpsStatus(): Promise<{ gpsEnabled: boolean; networkEnabled?: boolean; locationEnabled?: boolean; hasPermission: boolean }>;
  getCurrentPosition(): Promise<LocationPosition>;
  startTracking(options?: { interval?: number; priority?: number }): Promise<{ tracking: boolean; interval: number }>;
  setTrackingRate(options: { intervalMs: number }): Promise<{ intervalMs: number }>;
  stopTracking(): Promise<{ tracking: boolean }>;
  openLocationSettings(): Promise<void>;
  addListener(eventName: 'locationUpdate', listenerFunc: (pos: LocationPosition) => void): Promise<{ remove: () => void }>;
}

const NativeLocation = registerPlugin<FieldlinkLocationPluginInterface>('FieldlinkLocation');

export class FieldlinkLocationService {
  private static isNative = Capacitor.isNativePlatform();

  static async openSettings(): Promise<void> {
    if (this.isNative) {
      try {
        await NativeLocation.openLocationSettings();
      } catch (e) {
        console.warn('Could not open location settings:', e);
      }
    }
  }

  static async checkStatus() {
    if (this.isNative) {
      try {
        return await NativeLocation.checkGpsStatus();
      } catch {
        return { gpsEnabled: false, hasPermission: false };
      }
    }
    return { gpsEnabled: 'geolocation' in navigator, hasPermission: true };
  }

  static async getCurrentPosition(): Promise<LocationPosition> {
    if (this.isNative) {
      return await NativeLocation.getCurrentPosition();
    }
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) {
        reject(new Error('Geolocation not available in browser'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            altitude: pos.coords.altitude,
            accuracy: pos.coords.accuracy,
            speed: pos.coords.speed,
            bearing: pos.coords.heading,
            timestamp: pos.timestamp,
          });
        },
        (err) => reject(err),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    });
  }

  static async setTrackingRate(intervalMs: number): Promise<void> {
    if (this.isNative) {
      try {
        await NativeLocation.setTrackingRate({ intervalMs });
      } catch (e) {
        console.warn('Could not set tracking rate:', e);
      }
    }
  }

  static async startTracking(onUpdate: (pos: LocationPosition) => void, interval = 1000): Promise<() => void> {
    if (this.isNative) {
      const handle = await NativeLocation.addListener('locationUpdate', onUpdate);
      await NativeLocation.startTracking({ interval });
      return () => {
        handle.remove();
        NativeLocation.stopTracking().catch(() => {});
      };
    }

    if (!('geolocation' in navigator)) {
      return () => {};
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        onUpdate({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          altitude: pos.coords.altitude,
          accuracy: pos.coords.accuracy,
          speed: pos.coords.speed,
          bearing: pos.coords.heading,
          timestamp: pos.timestamp,
        });
      },
      (err) => console.warn('Browser GPS watch warning:', err),
      { enableHighAccuracy: true, maximumAge: 1000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }
}
