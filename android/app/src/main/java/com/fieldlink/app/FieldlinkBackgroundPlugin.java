package com.fieldlink.app;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.PixelCopy;
import android.view.View;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "FieldlinkBackground")
public class FieldlinkBackgroundPlugin extends Plugin {

    private boolean isServiceRunning = false;
    private final ExecutorService ioExecutor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void startService(PluginCall call) {
        String callsign = call.getString("callsign", "ALPHA-01");
        Intent intent = new Intent(getContext(), FieldlinkBackgroundService.class);
        intent.putExtra("callsign", callsign);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }

        isServiceRunning = true;
        JSObject ret = new JSObject();
        ret.put("running", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void stopService(PluginCall call) {
        Intent intent = new Intent(getContext(), FieldlinkBackgroundService.class);
        getContext().stopService(intent);
        isServiceRunning = false;

        JSObject ret = new JSObject();
        ret.put("running", false);
        call.resolve(ret);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("running", isServiceRunning);
        call.resolve(ret);
    }

    @PluginMethod
    public void captureScreenToGallery(PluginCall call) {
        String filename = call.getString("filename", "FIELDLINK-RECON-" + System.currentTimeMillis() + ".png");
        Activity activity = getActivity();
        if (activity == null || activity.getWindow() == null) {
            call.reject("Activity window unavailable for capture");
            return;
        }

        activity.runOnUiThread(() -> {
            try {
                View decorView = activity.getWindow().getDecorView();
                int width = decorView.getWidth();
                int height = decorView.getHeight();
                if (width <= 0 || height <= 0) {
                    call.reject("Invalid viewport dimensions for capture");
                    return;
                }

                Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    PixelCopy.request(
                        activity.getWindow(),
                        bitmap,
                        copyResult -> {
                            if (copyResult == PixelCopy.SUCCESS) {
                                encodeAndSaveBitmap(bitmap, filename, call);
                            } else {
                                // Fallback to DecorView software draw
                                try {
                                    Canvas canvas = new Canvas(bitmap);
                                    decorView.draw(canvas);
                                    encodeAndSaveBitmap(bitmap, filename, call);
                                } catch (Exception drawErr) {
                                    bitmap.recycle();
                                    call.reject("PixelCopy failed with code " + copyResult + ": " + drawErr.getMessage());
                                }
                            }
                        },
                        new Handler(Looper.getMainLooper())
                    );
                } else {
                    Canvas canvas = new Canvas(bitmap);
                    decorView.draw(canvas);
                    encodeAndSaveBitmap(bitmap, filename, call);
                }
            } catch (Exception e) {
                call.reject("Screen capture error: " + e.getMessage(), e);
            }
        });
    }

    private void encodeAndSaveBitmap(Bitmap bitmap, String filename, PluginCall call) {
        ioExecutor.execute(() -> {
            try {
                ByteArrayOutputStream baos = new ByteArrayOutputStream();
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, baos);
                byte[] imageBytes = baos.toByteArray();
                writeImageBytesToGallery(imageBytes, filename, call);
            } catch (Exception e) {
                call.reject("Error encoding recon screenshot: " + e.getMessage(), e);
            } finally {
                if (!bitmap.isRecycled()) {
                    bitmap.recycle();
                }
            }
        });
    }

    @PluginMethod
    public void saveImageToGallery(PluginCall call) {
        String base64Data = call.getString("base64Data");
        String filename = call.getString("filename", "FIELDLINK-RECON-" + System.currentTimeMillis() + ".png");

        if (base64Data == null || base64Data.isEmpty()) {
            call.reject("base64Data is missing or empty");
            return;
        }

        ioExecutor.execute(() -> {
            try {
                String cleanBase64 = base64Data.contains(",")
                    ? base64Data.substring(base64Data.indexOf(",") + 1)
                    : base64Data;
                byte[] imageBytes = Base64.decode(cleanBase64, Base64.DEFAULT);
                writeImageBytesToGallery(imageBytes, filename, call);
            } catch (Exception e) {
                call.reject("Error saving recon image: " + e.getMessage(), e);
            }
        });
    }

    private void writeImageBytesToGallery(byte[] imageBytes, String filename, PluginCall call) throws Exception {
        long nowMs = System.currentTimeMillis();
        long nowSec = nowMs / 1000L;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, filename);
            values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
            values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/FIELDLINK");
            values.put(MediaStore.Images.Media.DATE_TAKEN, nowMs);
            values.put(MediaStore.Images.Media.DATE_ADDED, nowSec);
            values.put(MediaStore.Images.Media.DATE_MODIFIED, nowSec);
            values.put(MediaStore.Images.Media.IS_PENDING, 1);

            Uri uri = getContext().getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            if (uri == null) {
                call.reject("Failed to create MediaStore entry");
                return;
            }

            try (OutputStream os = getContext().getContentResolver().openOutputStream(uri)) {
                if (os != null) {
                    os.write(imageBytes);
                    os.flush();
                }
            }

            values.clear();
            values.put(MediaStore.Images.Media.IS_PENDING, 0);
            getContext().getContentResolver().update(uri, values, null, null);

            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("uri", uri.toString());
            ret.put("filename", filename);
            ret.put("path", "Pictures/FIELDLINK/" + filename);
            call.resolve(ret);
        } else {
            File picturesDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES);
            File fieldlinkDir = new File(picturesDir, "FIELDLINK");
            if (!fieldlinkDir.exists()) {
                fieldlinkDir.mkdirs();
            }
            File targetFile = new File(fieldlinkDir, filename);
            try (FileOutputStream fos = new FileOutputStream(targetFile)) {
                fos.write(imageBytes);
                fos.flush();
            }

            MediaScannerConnection.scanFile(
                getContext(),
                new String[]{targetFile.getAbsolutePath()},
                new String[]{"image/png"},
                null
            );

            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("path", targetFile.getAbsolutePath());
            ret.put("filename", filename);
            call.resolve(ret);
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (isServiceRunning && getContext() != null) {
            try {
                getContext().stopService(new Intent(getContext(), FieldlinkBackgroundService.class));
            } catch (Exception ignored) {}
            isServiceRunning = false;
        }
        ioExecutor.shutdownNow();
        super.handleOnDestroy();
    }
}
