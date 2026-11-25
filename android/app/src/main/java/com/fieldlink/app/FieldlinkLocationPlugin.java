package com.fieldlink.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.location.GnssStatus;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;

import androidx.annotation.NonNull;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import com.google.android.gms.tasks.CancellationTokenSource;

import java.util.List;

@CapacitorPlugin(
    name = "FieldlinkLocation",
    permissions = {
        @Permission(
            alias = "location",
            strings = {
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            }
        )
    }
)
public class FieldlinkLocationPlugin extends Plugin implements SensorEventListener {

    private static final String TAG = "FieldlinkLocation";
    private static final String PREFS_NAME = "fieldlink_loc_cache";
    private static final long MAX_CACHED_FIX_AGE_MS = 15 * 60 * 1000L;
    private static final long MAX_INDOOR_ANCHOR_AGE_MS = 60 * 60 * 1000L;
    private static final long STATIONARY_WINDOW_MS = 4000L;

    private FusedLocationProviderClient fusedClient;
    private LocationCallback fusedLocationCallback;
    private LocationListener gpsLocationListener;
    private GnssStatus.Callback gnssStatusCallback;
    private SensorManager sensorManager;
    private boolean usingRawAccelerometer = false;
    private final float[] gravityEstimate = new float[] { 0f, 0f, 9.81f };

    private boolean isTracking = false;
    private float bestKnownAccuracy = Float.MAX_VALUE;
    private volatile int satellitesInFix = 0;
    private volatile int satellitesTotal = 0;
    private volatile long lastMotionTimestampMs = 0L;
    private volatile boolean hasMotionSensor = false;

    private Location lastAcceptedLocation = null;
    private Location lastKnownGoodGnssLocation = null;
    private long lastGoodGnssTimestamp = 0L;
    private Location lastKnownDisplayLocation = null;
    private Location pendingJumpLocation = null;
    private long pendingJumpTimestampMs = 0L;
    private int pendingJumpHits = 0;
    private long trackingIntervalMs = 1000L;
    private long lastPersistTimeMs = 0L;

    @Override
    public void load() {
        fusedClient = LocationServices.getFusedLocationProviderClient(getActivity());
        sensorManager = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        loadCachedLocations();
    }

    private void loadCachedLocations() {
        try {
            SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            long now = System.currentTimeMillis();

            if (prefs.contains("gnss_lat") && prefs.contains("gnss_lon")) {
                long savedAt = prefs.getLong("gnss_saved_at", 0L);
                if (savedAt > 0L && (now - savedAt) < MAX_INDOOR_ANCHOR_AGE_MS) {
                    Location anchor = new Location(prefs.getString("gnss_provider", "gps"));
                    anchor.setLatitude(Double.longBitsToDouble(prefs.getLong("gnss_lat", 0L)));
                    anchor.setLongitude(Double.longBitsToDouble(prefs.getLong("gnss_lon", 0L)));
                    if (prefs.getBoolean("gnss_has_alt", false)) {
                        anchor.setAltitude(Double.longBitsToDouble(prefs.getLong("gnss_alt", 0L)));
                    }
                    anchor.setAccuracy(prefs.getFloat("gnss_acc", 15.0f));
                    anchor.setTime(prefs.getLong("gnss_time", savedAt));
                    if (anchor.getLatitude() != 0.0 || anchor.getLongitude() != 0.0) {
                        lastKnownGoodGnssLocation = anchor;
                        lastGoodGnssTimestamp = savedAt;
                    }
                }
            }

            if (prefs.contains("disp_lat") && prefs.contains("disp_lon")) {
                long savedAt = prefs.getLong("disp_saved_at", 0L);
                if (savedAt > 0L && (now - savedAt) < MAX_INDOOR_ANCHOR_AGE_MS) {
                    Location cached = new Location(prefs.getString("disp_provider", "fused"));
                    cached.setLatitude(Double.longBitsToDouble(prefs.getLong("disp_lat", 0L)));
                    cached.setLongitude(Double.longBitsToDouble(prefs.getLong("disp_lon", 0L)));
                    if (prefs.getBoolean("disp_has_alt", false)) {
                        cached.setAltitude(Double.longBitsToDouble(prefs.getLong("disp_alt", 0L)));
                    }
                    cached.setAccuracy(prefs.getFloat("disp_acc", 50.0f));
                    cached.setTime(prefs.getLong("disp_time", savedAt));
                    if (cached.getLatitude() != 0.0 || cached.getLongitude() != 0.0) {
                        lastKnownDisplayLocation = cached;
                    }
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to load cached locations: " + e.getMessage());
        }
    }

    private void persistLocationCache(Location loc, boolean isGnssAnchor) {
        try {
            long now = System.currentTimeMillis();
            if (!isGnssAnchor && (now - lastPersistTimeMs) < 5000L) {
                return;
            }
            lastPersistTimeMs = now;

            SharedPreferences.Editor editor = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit();
            if (isGnssAnchor) {
                editor.putLong("gnss_lat", Double.doubleToRawLongBits(loc.getLatitude()));
                editor.putLong("gnss_lon", Double.doubleToRawLongBits(loc.getLongitude()));
                editor.putBoolean("gnss_has_alt", loc.hasAltitude());
                if (loc.hasAltitude()) {
                    editor.putLong("gnss_alt", Double.doubleToRawLongBits(loc.getAltitude()));
                }
                editor.putFloat("gnss_acc", loc.hasAccuracy() ? loc.getAccuracy() : 15.0f);
                editor.putString("gnss_provider", loc.getProvider() != null ? loc.getProvider() : "gps");
                editor.putLong("gnss_time", loc.getTime() > 0 ? loc.getTime() : now);
                editor.putLong("gnss_saved_at", now);
            }

            editor.putLong("disp_lat", Double.doubleToRawLongBits(loc.getLatitude()));
            editor.putLong("disp_lon", Double.doubleToRawLongBits(loc.getLongitude()));
            editor.putBoolean("disp_has_alt", loc.hasAltitude());
            if (loc.hasAltitude()) {
                editor.putLong("disp_alt", Double.doubleToRawLongBits(loc.getAltitude()));
            }
            editor.putFloat("disp_acc", loc.hasAccuracy() ? loc.getAccuracy() : 50.0f);
            editor.putString("disp_provider", loc.getProvider() != null ? loc.getProvider() : "fused");
            editor.putLong("disp_time", loc.getTime() > 0 ? loc.getTime() : now);
            editor.putLong("disp_saved_at", now);
            editor.apply();
        } catch (Exception ignored) {}
    }

    private void startMotionSensor() {
        if (sensorManager == null) return;
        try {
            sensorManager.unregisterListener(this);
            Sensor linearAccel = sensorManager.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION);
            if (linearAccel != null) {
                usingRawAccelerometer = false;
                hasMotionSensor = sensorManager.registerListener(this, linearAccel, SensorManager.SENSOR_DELAY_NORMAL);
            } else {
                Sensor accel = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
                if (accel != null) {
                    usingRawAccelerometer = true;
                    hasMotionSensor = sensorManager.registerListener(this, accel, SensorManager.SENSOR_DELAY_NORMAL);
                }
            }
            lastMotionTimestampMs = System.currentTimeMillis();
        } catch (Exception e) {
            hasMotionSensor = false;
        }
    }

    private void stopMotionSensor() {
        if (sensorManager != null) {
            try {
                sensorManager.unregisterListener(this);
            } catch (Exception ignored) {}
        }
        hasMotionSensor = false;
    }

    private boolean isPhysicallyStationary() {
        if (!hasMotionSensor) return false;
        return (System.currentTimeMillis() - lastMotionTimestampMs) > STATIONARY_WINDOW_MS;
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        if (event == null || event.values == null || event.values.length < 3) return;
        float ax;
        float ay;
        float az;
        if (usingRawAccelerometer) {
            final float alpha = 0.8f;
            gravityEstimate[0] = alpha * gravityEstimate[0] + (1f - alpha) * event.values[0];
            gravityEstimate[1] = alpha * gravityEstimate[1] + (1f - alpha) * event.values[1];
            gravityEstimate[2] = alpha * gravityEstimate[2] + (1f - alpha) * event.values[2];
            ax = event.values[0] - gravityEstimate[0];
            ay = event.values[1] - gravityEstimate[1];
            az = event.values[2] - gravityEstimate[2];
        } else {
            ax = event.values[0];
            ay = event.values[1];
            az = event.values[2];
        }
        double linearMag = Math.sqrt(ax * ax + ay * ay + az * az);
        if (linearMag > 1.15) {
            lastMotionTimestampMs = System.currentTimeMillis();
        }
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {}

    @PluginMethod
    public void checkGpsStatus(PluginCall call) {
        LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        boolean gpsEnabled = false;
        boolean networkEnabled = false;
        boolean locationModeOn = false;

        try {
            if (lm != null) {
                gpsEnabled = lm.isProviderEnabled(LocationManager.GPS_PROVIDER);
                networkEnabled = lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
                locationModeOn = gpsEnabled || networkEnabled;
            }
        } catch (Exception ignored) {}

        JSObject ret = new JSObject();
        ret.put("gpsEnabled", gpsEnabled);
        ret.put("networkEnabled", networkEnabled);
        ret.put("locationEnabled", locationModeOn);
        ret.put("hasPermission", getPermissionState("location").equals(com.getcapacitor.PermissionState.GRANTED));
        call.resolve(ret);
    }

    @PluginMethod
    public void openLocationSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open location settings: " + e.getMessage());
        }
    }

    @PluginMethod
    public void getCurrentPosition(PluginCall call) {
        if (!getPermissionState("location").equals(com.getcapacitor.PermissionState.GRANTED)) {
            requestPermissionForAlias("location", call, "locationPermCallback");
            return;
        }

        fetchCurrentPosition(call);
    }

    @PermissionCallback
    private void locationPermCallback(PluginCall call) {
        if (getPermissionState("location").equals(com.getcapacitor.PermissionState.GRANTED)) {
            if ("startTracking".equals(call.getMethodName())) {
                startLocationUpdates(call);
            } else {
                fetchCurrentPosition(call);
            }
        } else {
            call.reject("Location permission was denied by user.");
        }
    }

    private double scoreCandidate(Location loc, long now) {
        if (loc == null || (loc.getLatitude() == 0.0 && loc.getLongitude() == 0.0)) {
            return -1.0;
        }
        long ageMs = Math.max(0L, now - loc.getTime());
        if (ageMs > MAX_INDOOR_ANCHOR_AGE_MS) {
            return -1.0;
        }
        float acc = loc.hasAccuracy() ? loc.getAccuracy() : 200.0f;
        double accScore = 1000.0 / Math.max(acc, 5.0f);
        double freshnessScore = 500.0 / (1.0 + (ageMs / 60000.0));
        double gpsBonus = LocationManager.GPS_PROVIDER.equalsIgnoreCase(loc.getProvider()) && acc <= 25.0f ? 250.0 : 0.0;
        return accScore + freshnessScore + gpsBonus;
    }

    @SuppressLint("MissingPermission")
    private Location getBestLastKnownLocation() {
        LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        long now = System.currentTimeMillis();

        Location bestResult = null;
        double bestScore = -1.0;

        if (lm != null) {
            // 1. Check hardware GPS provider first and seed indoor anchor if recent fine fix exists
            try {
                Location gpsLoc = lm.getLastKnownLocation(LocationManager.GPS_PROVIDER);
                if (gpsLoc != null && gpsLoc.hasAccuracy()) {
                    long age = now - gpsLoc.getTime();
                    if (age >= -5000L && age < MAX_CACHED_FIX_AGE_MS && gpsLoc.getAccuracy() <= 25.0f) {
                        if (lastKnownGoodGnssLocation == null || gpsLoc.getTime() > lastGoodGnssTimestamp) {
                            lastKnownGoodGnssLocation = new Location(gpsLoc);
                            lastGoodGnssTimestamp = gpsLoc.getTime();
                        }
                    }
                    double s = scoreCandidate(gpsLoc, now);
                    if (s > bestScore) {
                        bestScore = s;
                        bestResult = gpsLoc;
                    }
                }
            } catch (SecurityException ignored) {}

            // 2. Check other system providers (fused / network / passive) with strict staleness limits
            try {
                List<String> matchingProviders = lm.getAllProviders();
                for (String provider : matchingProviders) {
                    if (LocationManager.GPS_PROVIDER.equals(provider)) continue;
                    try {
                        Location loc = lm.getLastKnownLocation(provider);
                        if (loc != null && (now - loc.getTime()) < MAX_CACHED_FIX_AGE_MS) {
                            double s = scoreCandidate(loc, now);
                            if (s > bestScore) {
                                bestScore = s;
                                bestResult = loc;
                            }
                        }
                    } catch (SecurityException ignored) {}
                }
            } catch (Exception ignored) {}
        }

        // 3. Fall back to persisted local GNSS anchor or cached display location
        double anchorScore = scoreCandidate(lastKnownGoodGnssLocation, now);
        if (anchorScore > bestScore) {
            bestScore = anchorScore;
            bestResult = lastKnownGoodGnssLocation;
        }
        double cachedDispScore = scoreCandidate(lastKnownDisplayLocation, now);
        if (cachedDispScore > bestScore) {
            bestResult = lastKnownDisplayLocation;
        }

        return bestResult;
    }

    private void triggerWifiScan() {
        try {
            Context ctx = getContext().getApplicationContext();
            WifiManager wm = (WifiManager) ctx.getSystemService(Context.WIFI_SERVICE);
            if (wm != null && wm.isWifiEnabled()) {
                wm.startScan();
                Log.d(TAG, "Triggered active Wi-Fi AP scan for Google NLP precision");
            }
        } catch (Exception e) {
            Log.d(TAG, "Wi-Fi scan trigger: " + e.getMessage());
        }
    }

    @SuppressLint("MissingPermission")
    private void fetchCurrentPosition(PluginCall call) {
        CancellationTokenSource cts = new CancellationTokenSource();
        triggerWifiScan();
        fusedClient.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, cts.getToken())
            .addOnSuccessListener(location -> {
                if (location != null) {
                    Location sanitized = sanitizeAndPinLocation(location);
                    bestKnownAccuracy = sanitized.hasAccuracy() ? sanitized.getAccuracy() : 999f;
                    call.resolve(locationToJS(sanitized));
                } else {
                    Location bestLast = getBestLastKnownLocation();
                    if (bestLast != null) {
                        Location sanitized = sanitizeAndPinLocation(bestLast);
                        call.resolve(locationToJS(sanitized));
                    } else {
                        call.reject("Searching for high-precision GNSS fix...");
                    }
                }
            })
            .addOnFailureListener(e -> {
                Location bestLast = getBestLastKnownLocation();
                if (bestLast != null) {
                    Location sanitized = sanitizeAndPinLocation(bestLast);
                    call.resolve(locationToJS(sanitized));
                } else {
                    call.reject("Location acquisition error: " + e.getMessage());
                }
            });
    }

    @PluginMethod
    public void startTracking(PluginCall call) {
        if (!getPermissionState("location").equals(com.getcapacitor.PermissionState.GRANTED)) {
            requestPermissionForAlias("location", call, "locationPermCallback");
            return;
        }

        startLocationUpdates(call);
    }

    @SuppressLint("MissingPermission")
    private void emitImmediateLastKnownLocation() {
        Location instantLocal = getBestLastKnownLocation();
        if (instantLocal != null) {
            Log.d(TAG, "Immediate last-known fix from " + instantLocal.getProvider() + " (±" + Math.round(instantLocal.getAccuracy()) + "m)");
            handleNewLocation(instantLocal);
        }

        if (fusedClient != null) {
            fusedClient.getLastLocation().addOnSuccessListener(fusedLast -> {
                if (fusedLast != null && (System.currentTimeMillis() - fusedLast.getTime()) < MAX_INDOOR_ANCHOR_AGE_MS) {
                    handleNewLocation(fusedLast);
                }
            });
        }
    }

    @SuppressLint("MissingPermission")
    private void startLocationUpdates(PluginCall call) {
        long intervalMs = call.getLong("interval", 1000L);

        stopAllLocationListeners();
        startMotionSensor();

        // 0. Emit best cached last-known location immediately so beacon appears without blocking on cold GNSS/NLP
        emitImmediateLastKnownLocation();

        // 1. Trigger active Wi-Fi scan so Google Location Services resolves nearby APs quickly
        triggerWifiScan();

        // 2. Request an immediate high-accuracy fix alongside continuous tracking
        CancellationTokenSource cts = new CancellationTokenSource();
        fusedClient.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, cts.getToken()).addOnSuccessListener(loc -> {
            if (loc != null) {
                handleNewLocation(loc);
            }
        });

        // 3. Google Play Services Fused Location Provider with continuous high accuracy
        LocationRequest fusedRequest = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, intervalMs)
            .setMinUpdateIntervalMillis(500L)
            .setMaxUpdateDelayMillis(1000L)
            .setWaitForAccurateLocation(false)
            .build();

        fusedLocationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult locationResult) {
                if (locationResult == null) return;
                for (Location location : locationResult.getLocations()) {
                    if (location != null) {
                        handleNewLocation(location);
                    }
                }
            }
        };

        fusedClient.requestLocationUpdates(fusedRequest, fusedLocationCallback, Looper.getMainLooper())
            .addOnSuccessListener(aVoid -> Log.d(TAG, "Fused high-accuracy GNSS tracking started"))
            .addOnFailureListener(e -> {
                Log.w(TAG, "Fused location provider failed, activating native GPS_PROVIDER fallback: " + e.getMessage());
                startNativeGpsFallback();
            });

        // 4. Hardware Satellite Status Callback (Count satellites without competing location stream)
        LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        if (lm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            gnssStatusCallback = new GnssStatus.Callback() {
                @Override
                public void onSatelliteStatusChanged(@NonNull GnssStatus status) {
                    satellitesTotal = status.getSatelliteCount();
                    int inFix = 0;
                    for (int i = 0; i < satellitesTotal; i++) {
                        if (status.usedInFix(i)) {
                            inFix++;
                        }
                    }
                    satellitesInFix = inFix;
                }
            };

            try {
                lm.registerGnssStatusCallback(gnssStatusCallback, null);
            } catch (Exception ignored) {}
        }

        isTracking = true;
        this.trackingIntervalMs = intervalMs;
        JSObject ret = new JSObject();
        ret.put("tracking", true);
        ret.put("interval", intervalMs);
        call.resolve(ret);
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void setTrackingRate(PluginCall call) {
        long newInterval = call.getInt("intervalMs", 1000);
        if (newInterval < 500) newInterval = 500;
        this.trackingIntervalMs = newInterval;
        if (isTracking && fusedLocationCallback != null && fusedClient != null) {
            try {
                fusedClient.removeLocationUpdates(fusedLocationCallback);
                LocationRequest fusedRequest = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, newInterval)
                    .setMinUpdateIntervalMillis(Math.min(500L, newInterval / 2))
                    .setMaxUpdateDelayMillis(newInterval)
                    .setWaitForAccurateLocation(false)
                    .build();
                fusedClient.requestLocationUpdates(fusedRequest, fusedLocationCallback, Looper.getMainLooper());
                Log.d(TAG, "Adaptive GNSS rate throttle active: " + newInterval + "ms (PERF-06)");
            } catch (Exception e) {
                Log.w(TAG, "Failed to adapt tracking rate: " + e.getMessage());
            }
        }
        JSObject ret = new JSObject();
        ret.put("intervalMs", newInterval);
        call.resolve(ret);
    }

    @SuppressLint("MissingPermission")
    private void startNativeGpsFallback() {
        LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        if (lm == null) return;

        gpsLocationListener = new LocationListener() {
            @Override
            public void onLocationChanged(@NonNull Location location) {
                handleNewLocation(location);
            }
            @Override
            public void onStatusChanged(String provider, int status, Bundle extras) {}
            @Override
            public void onProviderEnabled(@NonNull String provider) {}
            @Override
            public void onProviderDisabled(@NonNull String provider) {}
        };

        try {
            if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, gpsLocationListener, Looper.getMainLooper());
            }
        } catch (Exception ignored) {}
    }

    private boolean isHighConfidenceGnss(Location loc) {
        if (loc == null || !loc.hasAccuracy()) return false;
        float acc = loc.getAccuracy();
        boolean hasGpsLock = "gps".equalsIgnoreCase(loc.getProvider()) && satellitesInFix >= 3 && acc <= 25.0f;
        boolean hasFusedSatLock = satellitesInFix >= 3 && acc <= 22.0f;
        boolean hasTightFusedAlt = acc <= 14.0f && loc.hasAltitude();
        return hasGpsLock || hasFusedSatLock || hasTightFusedAlt;
    }

    private boolean confirmJumpCandidate(Location candidate) {
        long now = System.currentTimeMillis();
        if (pendingJumpLocation != null && (now - pendingJumpTimestampMs) <= 12000L) {
            float agreementDist = candidate.distanceTo(pendingJumpLocation);
            if (agreementDist <= 28.0f) {
                pendingJumpHits++;
                pendingJumpLocation = new Location(candidate);
                pendingJumpTimestampMs = now;
                if (pendingJumpHits >= 2) {
                    pendingJumpLocation = null;
                    pendingJumpHits = 0;
                    return true;
                }
                return false;
            }
        }
        pendingJumpLocation = new Location(candidate);
        pendingJumpTimestampMs = now;
        pendingJumpHits = 1;
        return false;
    }

    private void resetPendingJump() {
        pendingJumpLocation = null;
        pendingJumpHits = 0;
        pendingJumpTimestampMs = 0L;
    }

    /**
     * Google Maps-Style Anti-Teleport Pinning & Sensor Fusion:
     * When fine GNSS satellite lock is lost and coarse Cell 2D / Wi-Fi NLP readings bounce indoors,
     * pin coordinates to the persistent high-confidence GNSS anchor instead of teleporting, while
     * gradually expanding uncertainty radius to reflect decaying indoor confidence.
     */
    private Location sanitizeAndPinLocation(Location loc) {
        if (loc == null) return null;
        Location result = new Location(loc);
        long now = System.currentTimeMillis();

        if (isHighConfidenceGnss(loc)) {
            if (lastKnownGoodGnssLocation == null
                || loc.distanceTo(lastKnownGoodGnssLocation) <= 35.0f
                || !isPhysicallyStationary()
                || (satellitesInFix >= 4 && loc.getAccuracy() <= 15.0f)) {
                lastKnownGoodGnssLocation = new Location(loc);
                lastGoodGnssTimestamp = now;
                resetPendingJump();
                persistLocationCache(lastKnownGoodGnssLocation, true);
                return result;
            }
        }

        // If we have a recent high-accuracy GNSS anchor (within 60 minutes)
        if (lastKnownGoodGnssLocation != null) {
            long ageMs = now - lastGoodGnssTimestamp;
            if (ageMs < MAX_INDOOR_ANCHOR_AGE_MS) {
                float dist = loc.distanceTo(lastKnownGoodGnssLocation);
                float acc = loc.hasAccuracy() ? loc.getAccuracy() : 200.0f;
                boolean isCoarseOrUnverified = acc > 25.0f
                    || "network".equalsIgnoreCase(loc.getProvider())
                    || satellitesInFix < 3;

                // Pin any drift > 12m (or any bounce while device IMU detects stationary state)
                if (isCoarseOrUnverified && (dist > 12.0f || isPhysicallyStationary())) {
                    Log.d(TAG, "Anti-Teleport active: Pinning " + Math.round(dist) + "m indoor/coarse reading (±" + Math.round(acc) + "m) to GNSS anchor");
                    result.setLatitude(lastKnownGoodGnssLocation.getLatitude());
                    result.setLongitude(lastKnownGoodGnssLocation.getLongitude());
                    if (lastKnownGoodGnssLocation.hasAltitude()) {
                        result.setAltitude(lastKnownGoodGnssLocation.getAltitude());
                    }

                    // Decaying confidence: expands 0.25m/s without GNSS, capped at 250m indoors
                    float elapsedSec = ageMs / 1000.0f;
                    float baseAcc = lastKnownGoodGnssLocation.hasAccuracy() ? lastKnownGoodGnssLocation.getAccuracy() : 15.0f;
                    float expandedAcc = Math.min(Math.max(baseAcc + (elapsedSec * 0.25f), 35.0f), 250.0f);
                    result.setAccuracy(expandedAcc);
                    result.setSpeed(0f);
                }
            }
        }

        return result;
    }

    /**
     * Multi-layer Google Maps-style location gate:
     * 1. Allows pinned uncertainty updates at the same spot.
     * 2. Locks coarse/cell readings while IMU indicates the device is stationary (Zero-Velocity Update).
     * 3. Prevents coarse-to-coarse cell tower oscillation regardless of elapsed time.
     * 4. Allows verified high-confidence GNSS fixes to cleanly recover from coarse cached fixes.
     * 5. Enforces realistic velocity bounds with 2-hit confirmation hysteresis against multipath spikes.
     */
    private boolean isBetterLocation(Location location, Location currentBestLocation) {
        if (location == null || (location.getLatitude() == 0.0 && location.getLongitude() == 0.0)) {
            return false;
        }
        if (currentBestLocation == null) {
            return true;
        }

        float dist = location.distanceTo(currentBestLocation);
        long timeDeltaMs = location.getTime() - currentBestLocation.getTime();
        float newAcc = location.hasAccuracy() ? location.getAccuracy() : 200.0f;
        float curAcc = currentBestLocation.hasAccuracy() ? currentBestLocation.getAccuracy() : 200.0f;

        // 1. Pinned / same-spot update: allow decaying uncertainty circle & provider refresh
        if (dist < 2.5f) {
            resetPendingJump();
            return true;
        }

        // 2. Reject stale readings older than current best fix
        if (timeDeltaMs < -5000L) {
            return false;
        }

        boolean newIsFineGnss = isHighConfidenceGnss(location);
        boolean curIsCoarse = curAcc > 25.0f || "network".equalsIgnoreCase(currentBestLocation.getProvider());

        // 3. Recovery path: fine GNSS fix upgrading from an earlier coarse/cached fix
        if (curIsCoarse && newIsFineGnss) {
            if (dist <= 60.0f || (satellitesInFix >= 4 && newAcc <= 15.0f)) {
                resetPendingJump();
                return true;
            }
            boolean confirmed = confirmJumpCandidate(location);
            if (!confirmed) {
                Log.d(TAG, "Awaiting 2nd GNSS confirmation for " + Math.round(dist) + "m recovery from coarse fix");
            }
            return confirmed;
        }

        // 4. Hardware IMU Stationary Lock (ZUPT): refuse non-GNSS jumps when phone is physically still
        if (isPhysicallyStationary() && dist > 10.0f && !(satellitesInFix >= 4 && newAcc <= 15.0f)) {
            Log.d(TAG, "Stationary IMU lock suppressed " + Math.round(dist) + "m drift (±" + Math.round(newAcc) + "m)");
            return false;
        }

        // 5. Coarse-to-Coarse Cell/Wi-Fi Anti-Bounce: never hop between distant cell towers unless accuracy
        // improves dramatically (<= 50% radius) AND 2 consecutive fixes confirm the new zone
        if (!newIsFineGnss && newAcc > 25.0f) {
            if (dist > 20.0f) {
                if (newAcc > curAcc * 0.50f) {
                    Log.w(TAG, "Blocked coarse tower bounce: " + Math.round(dist) + "m (±" + Math.round(curAcc) + "m -> ±" + Math.round(newAcc) + "m)");
                    return false;
                }
                return confirmJumpCandidate(location);
            }
            return newAcc <= curAcc;
        }

        // 6. Velocity Feasibility Envelope + 2-hit multipath spike filter for moving fixes
        float dtSec = Math.max(timeDeltaMs / 1000.0f, 1.0f);
        float maxSpeedMps;
        if (location.hasSpeed() && location.getSpeed() > 5.0f) {
            maxSpeedMps = Math.max(location.getSpeed() * 1.5f, 18.0f);
        } else if (isPhysicallyStationary()) {
            maxSpeedMps = 2.0f;
        } else {
            maxSpeedMps = 8.0f;
        }

        float maxReachableDist = (maxSpeedMps * dtSec) + Math.min(curAcc + newAcc, 80.0f) + 15.0f;
        if (dist > maxReachableDist && dist > 25.0f) {
            boolean confirmed = confirmJumpCandidate(location);
            if (!confirmed) {
                Log.w(TAG, "Rejected teleport jump pending confirmation: " + Math.round(dist) + "m in " + timeDeltaMs + "ms (limit " + Math.round(maxReachableDist) + "m)");
            }
            return confirmed;
        }

        // 7. Reject significantly degraded accuracy outliers at distinct locations
        if (newAcc > curAcc * 1.6f && newAcc > 30.0f && dist > 15.0f) {
            return false;
        }

        resetPendingJump();
        return true;
    }

    private synchronized void handleNewLocation(Location loc) {
        if (loc == null) return;

        Location sanitized = sanitizeAndPinLocation(loc);

        if (isBetterLocation(sanitized, lastAcceptedLocation)) {
            if (lastAcceptedLocation != null) {
                float dist = sanitized.distanceTo(lastAcceptedLocation);
                float speed = sanitized.hasSpeed() ? sanitized.getSpeed() : 0f;

                // 1. Stationary Dead-Band: Lock coordinates within 2.0m when stationary or walking speed near zero
                if ((isPhysicallyStationary() || speed < 1.0f) && dist < 2.0f) {
                    sanitized.setLatitude(lastAcceptedLocation.getLatitude());
                    sanitized.setLongitude(lastAcceptedLocation.getLongitude());
                } else if (dist < 15.0f && lastAcceptedLocation.hasAccuracy()) {
                    // 2. Moving EMA Filter: Smooth small noisy deviations (40% history, 60% fresh)
                    double smoothLat = lastAcceptedLocation.getLatitude() * 0.40 + sanitized.getLatitude() * 0.60;
                    double smoothLon = lastAcceptedLocation.getLongitude() * 0.40 + sanitized.getLongitude() * 0.60;
                    sanitized.setLatitude(smoothLat);
                    sanitized.setLongitude(smoothLon);
                }
            }

            lastAcceptedLocation = sanitized;
            lastKnownDisplayLocation = sanitized;
            bestKnownAccuracy = sanitized.hasAccuracy() ? sanitized.getAccuracy() : 999.0f;
            persistLocationCache(sanitized, false);
            notifyListeners("locationUpdate", locationToJS(sanitized));
        }
    }

    private void stopAllLocationListeners() {
        stopMotionSensor();

        if (fusedLocationCallback != null) {
            try {
                fusedClient.removeLocationUpdates(fusedLocationCallback);
            } catch (Exception ignored) {}
            fusedLocationCallback = null;
        }

        LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        if (lm != null) {
            if (gnssStatusCallback != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                try {
                    lm.unregisterGnssStatusCallback(gnssStatusCallback);
                } catch (Exception ignored) {}
                gnssStatusCallback = null;
            }
            if (gpsLocationListener != null) {
                try {
                    lm.removeUpdates(gpsLocationListener);
                } catch (Exception ignored) {}
                gpsLocationListener = null;
            }
        }
    }

    @PluginMethod
    public void stopTracking(PluginCall call) {
        stopAllLocationListeners();
        lastAcceptedLocation = null;
        resetPendingJump();
        isTracking = false;
        JSObject ret = new JSObject();
        ret.put("tracking", false);
        call.resolve(ret);
    }

    private JSObject locationToJS(Location loc) {
        JSObject o = new JSObject();
        o.put("latitude", loc.getLatitude());
        o.put("longitude", loc.getLongitude());
        if (Build.VERSION.SDK_INT >= 34 && loc.hasMslAltitude()) {
            o.put("altitude", loc.getMslAltitudeMeters());
            o.put("altitudeMsl", true);
        } else if (loc.hasAltitude()) {
            o.put("altitude", loc.getAltitude());
            o.put("altitudeMsl", false);
        } else {
            o.put("altitude", null);
        }
        o.put("accuracy", loc.hasAccuracy() ? loc.getAccuracy() : null);
        o.put("speed", loc.hasSpeed() ? loc.getSpeed() : null);
        o.put("bearing", loc.hasBearing() ? loc.getBearing() : null);
        o.put("provider", loc.getProvider());
        o.put("satellites", satellitesInFix > 0 ? satellitesInFix : (loc.getExtras() != null ? loc.getExtras().getInt("satellites", 0) : 0));
        o.put("timestamp", loc.getTime());
        return o;
    }

    @Override
    protected void handleOnDestroy() {
        stopAllLocationListeners();
        super.handleOnDestroy();
    }
}
