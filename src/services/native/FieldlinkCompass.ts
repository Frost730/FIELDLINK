import { registerPlugin, Capacitor } from '@capacitor/core';

export interface HeadingData {
  heading: number;         // 0 - 360 deg (active mode: True or Magnetic)
  trueHeading?: number;    // True North (WGS84 geoid aligned)
  magneticHeading?: number;// Magnetic North (unadjusted sensor)
  declination?: number;    // Local magnetic declination in degrees
  mils: number;            // 0 - 6400 mils
  accuracy: number;        // 0: Unreliable, 1: Low, 2: Medium, 3: High
  sensorType?: string;     // 'ROTATION_VECTOR' | 'GEOMAGNETIC_ROTATION_VECTOR' | 'ACCEL_MAGNETIC'
  pitch?: number;          // Device tilt pitch
  roll?: number;           // Device roll
  isTrueNorth?: boolean;
}

export interface FieldlinkCompassPluginInterface {
  start(): Promise<{ active: boolean; sensorType: string; isTrueNorth: boolean; declination: number }>;
  stop(): Promise<{ active: boolean }>;
  getHeading(): Promise<{ heading: number; active: boolean; accuracy: number; sensorType: string; isTrueNorth: boolean; declination: number }>;
  setLocation(options: { latitude: number; longitude: number; altitude?: number }): Promise<{ declination: number }>;
  setNorthMode(options: { mode: 'TRUE' | 'MAGNETIC' }): Promise<{ isTrueNorth: boolean }>;
  setManualOffset(options: { offset: number }): Promise<{ offset: number }>;
  addListener(eventName: 'headingUpdate', listenerFunc: (data: HeadingData) => void): Promise<{ remove: () => void }>;
}

const NativeCompass = registerPlugin<FieldlinkCompassPluginInterface>('FieldlinkCompass');

export class FieldlinkCompassService {
  private static isNative = Capacitor.isNativePlatform();

  static async start(onHeading: (data: HeadingData) => void): Promise<() => void> {
    if (this.isNative) {
      try {
        const handle = await NativeCompass.addListener('headingUpdate', onHeading);
        await NativeCompass.start();
        return () => {
          handle.remove();
          NativeCompass.stop().catch(() => {});
        };
      } catch (e) {
        console.warn('Native compass initialization error:', e);
      }
    }

    // Web fallback using absolute device orientation
    const handler = (e: any) => {
      let heading = 0;
      if (typeof e.webkitCompassHeading !== 'undefined') {
        heading = e.webkitCompassHeading;
      } else if (e.alpha !== null && e.alpha !== undefined) {
        heading = (360 - e.alpha) % 360;
      }
      const rounded = Math.round(heading * 10) / 10;
      onHeading({
        heading: rounded,
        trueHeading: rounded,
        magneticHeading: rounded,
        declination: 0,
        mils: Math.round((rounded / 360) * 6400),
        accuracy: 3,
        sensorType: 'WEB_DEVICE_ORIENTATION',
        isTrueNorth: true,
      });
    };

    const win = window as any;
    if (typeof win.ondeviceorientationabsolute !== 'undefined') {
      win.addEventListener('deviceorientationabsolute', handler);
      return () => win.removeEventListener('deviceorientationabsolute', handler);
    } else {
      window.addEventListener('deviceorientation', handler);
      return () => window.removeEventListener('deviceorientation', handler);
    }
  }

  static async setLocation(latitude: number, longitude: number, altitude?: number): Promise<void> {
    if (this.isNative) {
      try {
        await NativeCompass.setLocation({ latitude, longitude, altitude });
      } catch (e) {
        console.warn('Compass setLocation error:', e);
      }
    }
  }

  static async setNorthMode(mode: 'TRUE' | 'MAGNETIC'): Promise<void> {
    if (this.isNative) {
      try {
        await NativeCompass.setNorthMode({ mode });
      } catch (e) {
        console.warn('Compass setNorthMode error:', e);
      }
    }
  }

  static async setManualOffset(offset: number): Promise<void> {
    if (this.isNative) {
      try {
        await NativeCompass.setManualOffset({ offset });
      } catch (e) {
        console.warn('Compass setManualOffset error:', e);
      }
    }
  }
}
