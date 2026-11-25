package com.fieldlink.app;

import android.content.Context;
import android.hardware.GeomagneticField;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.view.Display;
import android.view.Surface;
import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "FieldlinkCompass")
public class FieldlinkCompassPlugin extends Plugin implements SensorEventListener {

    private SensorManager sensorManager;
    private String activeSensorType = "NONE";

    // Sensors in descending priority
    private Sensor rotationSensor;             // 9-axis fusion (Gyro + Accel + Magnetometer)
    private Sensor geomagneticRotationSensor; // 6-axis hardware fusion (Accel + Magnetometer)
    private Sensor accelSensor;
    private Sensor magnetSensor;

    // Low-pass filter buffers for raw fallback
    private float[] gravity;
    private float[] geomagnetic;

    // Circular vector smoothing state
    private float smoothSin = 0f;
    private float smoothCos = 0f;
    private boolean hasSmoothed = false;

    // GPS Location for GeomagneticField Declination correction
    private double currentLat = 0.0;
    private double currentLon = 0.0;
    private double currentAlt = 0.0;
    private boolean hasLocation = false;
    private float magneticDeclination = 0f;

    // Settings
    private boolean useTrueNorth = true;
    private float manualOffset = 0f;

    private boolean isListening = false;
    private float lastHeading = 0.0f;
    private int lastAccuracy = SensorManager.SENSOR_STATUS_ACCURACY_HIGH;

    // Power & Bridge Throttle: Max 30 Hz (33ms gate)
    private long lastEmitTime = 0;
    private float lastHeadingEmitted = -999.0f;
    private int lastAccuracyEmitted = -1;

    @Override
    public void load() {
        sensorManager = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        if (sensorManager != null) {
            // Priority 1: Full 9-axis rotation vector (Gyro + Accel + Mag)
            rotationSensor = sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR);

            // Priority 2: Geomagnetic rotation vector (Hardware Kalman fused on sensor hub without Gyro)
            geomagneticRotationSensor = sensorManager.getDefaultSensor(Sensor.TYPE_GEOMAGNETIC_ROTATION_VECTOR);

            // Priority 3: Raw accelerometer & magnetometer fallback
            accelSensor = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
            magnetSensor = sensorManager.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD);
        }
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (sensorManager == null) {
            call.reject("Hardware sensor manager not available on this device.");
            return;
        }

        boolean registered = false;
        hasSmoothed = false;

        // Try registering in priority order
        if (rotationSensor != null) {
            registered = sensorManager.registerListener(this, rotationSensor, SensorManager.SENSOR_DELAY_GAME);
            activeSensorType = "ROTATION_VECTOR";
        } else if (geomagneticRotationSensor != null) {
            registered = sensorManager.registerListener(this, geomagneticRotationSensor, SensorManager.SENSOR_DELAY_GAME);
            activeSensorType = "GEOMAGNETIC_ROTATION_VECTOR";
        } else if (accelSensor != null && magnetSensor != null) {
            boolean r1 = sensorManager.registerListener(this, accelSensor, SensorManager.SENSOR_DELAY_GAME);
            boolean r2 = sensorManager.registerListener(this, magnetSensor, SensorManager.SENSOR_DELAY_GAME);
            registered = r1 && r2;
            activeSensorType = "ACCEL_MAGNETIC";
        }

        if (registered) {
            isListening = true;
            JSObject ret = new JSObject();
            ret.put("active", true);
            ret.put("sensorType", activeSensorType);
            ret.put("isTrueNorth", useTrueNorth);
            ret.put("declination", magneticDeclination);
            call.resolve(ret);
        } else {
            call.reject("Compass sensors could not be activated on this device.");
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (sensorManager != null && isListening) {
            sensorManager.unregisterListener(this);
            isListening = false;
        }
        JSObject ret = new JSObject();
        ret.put("active", false);
        call.resolve(ret);
    }

    @PluginMethod
    public void getHeading(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("heading", lastHeading);
        ret.put("active", isListening);
        ret.put("accuracy", lastAccuracy);
        ret.put("sensorType", activeSensorType);
        ret.put("isTrueNorth", useTrueNorth);
        ret.put("declination", magneticDeclination);
        call.resolve(ret);
    }

    @PluginMethod
    public void setLocation(PluginCall call) {
        Double lat = call.getDouble("latitude");
        Double lon = call.getDouble("longitude");
        Double alt = call.getDouble("altitude", 0.0);
        if (lat != null && lon != null) {
            currentLat = lat;
            currentLon = lon;
            currentAlt = alt != null ? alt : 0.0;
            hasLocation = true;
            updateDeclination();
        }
        JSObject ret = new JSObject();
        ret.put("declination", magneticDeclination);
        call.resolve(ret);
    }

    @PluginMethod
    public void setNorthMode(PluginCall call) {
        String mode = call.getString("mode", "TRUE");
        useTrueNorth = "TRUE".equalsIgnoreCase(mode);
        JSObject ret = new JSObject();
        ret.put("isTrueNorth", useTrueNorth);
        call.resolve(ret);
    }

    @PluginMethod
    public void setManualOffset(PluginCall call) {
        Double offset = call.getDouble("offset", 0.0);
        if (offset != null) {
            manualOffset = offset.floatValue();
        }
        JSObject ret = new JSObject();
        ret.put("offset", manualOffset);
        call.resolve(ret);
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        lastAccuracy = event.accuracy;

        if (event.sensor.getType() == Sensor.TYPE_ROTATION_VECTOR ||
            event.sensor.getType() == Sensor.TYPE_GEOMAGNETIC_ROTATION_VECTOR) {
            float[] rotationMatrix = new float[9];
            SensorManager.getRotationMatrixFromVector(rotationMatrix, event.values);
            processRotationMatrix(rotationMatrix, event.accuracy);
        } else {
            if (event.sensor.getType() == Sensor.TYPE_ACCELEROMETER) {
                gravity = lowPass(event.values, gravity, 0.15f);
            } else if (event.sensor.getType() == Sensor.TYPE_MAGNETIC_FIELD) {
                geomagnetic = lowPass(event.values, geomagnetic, 0.20f);
            }

            if (gravity != null && geomagnetic != null) {
                float[] R = new float[9];
                float[] I = new float[9];
                if (SensorManager.getRotationMatrix(R, I, gravity, geomagnetic)) {
                    processRotationMatrix(R, event.accuracy);
                }
            }
        }
    }

    private void processRotationMatrix(float[] rotationMatrix, int accuracy) {
        WindowManager wm = (WindowManager) getContext().getSystemService(Context.WINDOW_SERVICE);
        int rotation = Surface.ROTATION_0;
        if (wm != null && wm.getDefaultDisplay() != null) {
            rotation = wm.getDefaultDisplay().getRotation();
        }

        int axisX;
        int axisY;

        switch (rotation) {
            case Surface.ROTATION_90:
                axisX = SensorManager.AXIS_Y;
                axisY = SensorManager.AXIS_MINUS_X;
                break;
            case Surface.ROTATION_180:
                axisX = SensorManager.AXIS_MINUS_X;
                axisY = SensorManager.AXIS_MINUS_Y;
                break;
            case Surface.ROTATION_270:
                axisX = SensorManager.AXIS_MINUS_Y;
                axisY = SensorManager.AXIS_X;
                break;
            default:
                axisX = SensorManager.AXIS_X;
                axisY = SensorManager.AXIS_Y;
                break;
        }

        float[] remappedMatrix = new float[9];
        SensorManager.remapCoordinateSystem(rotationMatrix, axisX, axisY, remappedMatrix);

        float[] orientation = new float[3];
        SensorManager.getOrientation(remappedMatrix, orientation);

        float pitch = (float) Math.toDegrees(orientation[1]);
        float roll = (float) Math.toDegrees(orientation[2]);

        // Convert Android SensorManager azimuth into standard clockwise navigation heading (0° = N, 90° = E, 180° = S, 270° = W)
        float azimuthDeg = (float) Math.toDegrees(orientation[0]);
        float rawMagneticAzimuth = (azimuthDeg + 360.0f) % 360.0f;

        // Circular vector exponential moving average smoothing
        float smoothedMag = smoothAzimuth(rawMagneticAzimuth);

        // Update declination if GPS fix is active
        updateDeclination();

        // Calculate True Heading (Magnetic + Declination)
        float trueHeading = (smoothedMag + magneticDeclination + 360.0f) % 360.0f;

        // Apply manual calibration trim offset
        float finalMagnetic = (smoothedMag + manualOffset + 360.0f) % 360.0f;
        float finalTrue = (trueHeading + manualOffset + 360.0f) % 360.0f;

        float activeHeading = useTrueNorth ? finalTrue : finalMagnetic;
        lastHeading = activeHeading;

        emitHeading(activeHeading, finalTrue, finalMagnetic, magneticDeclination, accuracy, activeSensorType, pitch, roll);
    }

    private float smoothAzimuth(float newAngle) {
        float rad = (float) Math.toRadians(newAngle);
        float sin = (float) Math.sin(rad);
        float cos = (float) Math.cos(rad);

        if (!hasSmoothed) {
            smoothSin = sin;
            smoothCos = cos;
            hasSmoothed = true;
        } else {
            float alpha = 0.22f; // Low latency, smooth gliding military needle
            smoothSin = smoothSin + alpha * (sin - smoothSin);
            smoothCos = smoothCos + alpha * (cos - smoothCos);
        }

        float angle = (float) Math.toDegrees(Math.atan2(smoothSin, smoothCos));
        if (angle < 0) angle += 360.0f;
        return angle;
    }

    private float[] lowPass(float[] input, float[] output, float alpha) {
        if (output == null) return input.clone();
        for (int i = 0; i < input.length; i++) {
            output[i] = output[i] + alpha * (input[i] - output[i]);
        }
        return output;
    }

    private void updateDeclination() {
        if (hasLocation && (currentLat != 0.0 || currentLon != 0.0)) {
            try {
                GeomagneticField field = new GeomagneticField(
                    (float) currentLat,
                    (float) currentLon,
                    (float) currentAlt,
                    System.currentTimeMillis()
                );
                magneticDeclination = field.getDeclination();
            } catch (Exception ignored) {}
        }
    }

    private void emitHeading(float heading, float trueHeading, float magneticHeading, float declination, int accuracy, String sensorType, float pitch, float roll) {
        long now = System.currentTimeMillis();
        // Power Optimization: Throttle bridge emissions to max ~30Hz (33ms) unless heading shift is significant (> 1.2 deg)
        if (now - lastEmitTime < 33 && Math.abs(heading - lastHeadingEmitted) < 1.2f && accuracy == lastAccuracyEmitted) {
            return;
        }
        lastEmitTime = now;
        lastHeadingEmitted = heading;
        lastAccuracyEmitted = accuracy;

        JSObject obj = new JSObject();
        obj.put("heading", Math.round(heading * 10.0) / 10.0);
        obj.put("trueHeading", Math.round(trueHeading * 10.0) / 10.0);
        obj.put("magneticHeading", Math.round(magneticHeading * 10.0) / 10.0);
        obj.put("declination", Math.round(declination * 10.0) / 10.0);
        obj.put("mils", Math.round((heading / 360.0f) * 6400.0));
        obj.put("accuracy", accuracy);
        obj.put("sensorType", sensorType);
        obj.put("pitch", Math.round(pitch));
        obj.put("roll", Math.round(roll));
        obj.put("isTrueNorth", useTrueNorth);
        notifyListeners("headingUpdate", obj);
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {
        lastAccuracy = accuracy;
    }

    @Override
    protected void handleOnDestroy() {
        if (sensorManager != null && isListening) {
            sensorManager.unregisterListener(this);
        }
        super.handleOnDestroy();
    }
}
