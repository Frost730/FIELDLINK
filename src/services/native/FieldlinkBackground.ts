import { registerPlugin, Capacitor } from '@capacitor/core';

export interface FieldlinkBackgroundPluginInterface {
  startService(options: { callsign: string }): Promise<{ running: boolean }>;
  stopService(): Promise<{ running: boolean }>;
  getStatus(): Promise<{ running: boolean }>;
  captureScreenToGallery(options?: { filename?: string }): Promise<{
    success: boolean;
    uri?: string;
    path?: string;
    filename?: string;
  }>;
  saveImageToGallery(options: { base64Data: string; filename?: string }): Promise<{
    success: boolean;
    uri?: string;
    path?: string;
    filename?: string;
  }>;
}

const NativeBackground = registerPlugin<FieldlinkBackgroundPluginInterface>('FieldlinkBackground');

export class FieldlinkBackgroundService {
  private static isNative = Capacitor.isNativePlatform();

  static async captureFullScreenRecon(
    getFallbackDataUrl?: () => string | null,
    filename?: string
  ): Promise<{
    success: boolean;
    path?: string;
    filename?: string;
  }> {
    const safeFilename = filename || `FIELDLINK-RECON-${Date.now()}.png`;

    if (this.isNative) {
      try {
        const result = await NativeBackground.captureScreenToGallery({ filename: safeFilename });
        if (result && result.success) {
          return result;
        }
      } catch (e) {
        console.warn('Native captureScreenToGallery failed, trying canvas fallback:', e);
      }
    }

    const fallbackDataUrl = getFallbackDataUrl ? getFallbackDataUrl() : null;
    if (fallbackDataUrl) {
      return this.saveReconScreenshot(fallbackDataUrl, safeFilename);
    }
    return { success: false };
  }

  static async saveReconScreenshot(base64Data: string, filename?: string): Promise<{
    success: boolean;
    path?: string;
    filename?: string;
  }> {
    if (this.isNative) {
      try {
        const result = await NativeBackground.saveImageToGallery({ base64Data, filename });
        return result;
      } catch (e) {
        console.error('Native saveImageToGallery failed:', e);
      }
    }

    // Web Fallback (desktop browser testing)
    try {
      const link = document.createElement('a');
      const safeFilename = filename || `FIELDLINK-RECON-${Date.now()}.png`;
      link.download = safeFilename;
      link.href = base64Data;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return { success: true, path: safeFilename, filename: safeFilename };
    } catch (e) {
      console.error('Fallback screenshot download failed:', e);
      return { success: false };
    }
  }

  static async startService(callsign: string): Promise<boolean> {
    if (this.isNative) {
      try {
        const res = await NativeBackground.startService({ callsign });
        return res.running;
      } catch (e) {
        console.warn('Background service start failed:', e);
      }
    }
    return false;
  }

  static async stopService(): Promise<boolean> {
    if (this.isNative) {
      try {
        const res = await NativeBackground.stopService();
        return res.running;
      } catch (e) {
        console.warn('Background service stop failed:', e);
      }
    }
    return false;
  }
}
