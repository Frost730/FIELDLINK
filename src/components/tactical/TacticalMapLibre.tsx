import React, { useEffect, useRef, useState } from 'react';
import { Map as MapLibreInstance, Marker, addProtocol, type StyleSpecification, type MapMouseEvent, type GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useTacticalStore, type SquadMember } from '../../store/useTacticalStore';
import { Plus, Minus, LocateFixed, Pencil, Undo, Trash2, Check, Shield, MapPin } from 'lucide-react';
import { calculateDistanceKm, calculateBearing, getShortestRotation, getMGRS, getMGRSShort, formatDMS, formatCoordinateShort, getCallsignColor, escapeHtml, createGeoJsonCircle } from '../../utils/coordinates';
import { FieldlinkLocationService } from '../../services/native/FieldlinkLocation';
import { FieldlinkMeshService } from '../../services/native/FieldlinkNearby';
import { TileCacheManager } from '../../services/offline/TileCacheManager';

let isTileProtocolRegistered = false;
function registerOfflineTileProtocol() {
  if (isTileProtocolRegistered) return;
  try {
    addProtocol('flktile', async (params, abortController) => {
      const rawUrl = params.url.replace(/^flktile:\/\//, 'https://');

      // 1. Check local persistent IndexedDB first
      const cached = await TileCacheManager.getTile(rawUrl);
      if (cached) {
        return { data: cached };
      }

      // 2. Fetch from network
      try {
        const response = await fetch(rawUrl, {
          signal: abortController.signal,
          mode: 'cors',
        });
        if (response.ok) {
          const buffer = await response.arrayBuffer();
          // Store in IndexedDB in background
          TileCacheManager.putTile(rawUrl, buffer, response.headers.get('content-type') || 'image/jpeg');
          return { data: buffer };
        }
      } catch {
        // Network offline or failed
      }

      throw new Error(`Tile unavailable offline: ${rawUrl}`);
    });
    isTileProtocolRegistered = true;
  } catch (e) {
    console.warn('flktile protocol registration error:', e);
  }
}

registerOfflineTileProtocol();

const hasStyleLayers = (map: MapLibreInstance): boolean => {
  try {
    return Boolean(map.getStyle()?.layers?.length);
  } catch {
    return false;
  }
};

const runWhenStyleReady = (map: MapLibreInstance, fn: () => void) => {
  if (hasStyleLayers(map)) {
    fn();
    return;
  }
  map.once('style.load', fn);
};

interface TacticalMapLibreProps {
  onMapReady?: (map: MapLibreInstance | null) => void;
}

export const TacticalMapLibre: React.FC<TacticalMapLibreProps> = ({ onMapReady }) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<MapLibreInstance | null>(null);
  const userMarkerRef = useRef<Marker | null>(null);
  const userMarkerElRef = useRef<HTMLDivElement | null>(null);
  const userMarkerStyleSigRef = useRef<string>('');
  const targetMarkerRef = useRef<Marker | null>(null);
  const waypointMarkersRef = useRef<Map<string, Marker>>(new Map());
  const squadMarkersRef = useRef<Map<string, { marker: Marker; el: HTMLElement; cumulativeHeading?: number; stateSig?: string }>>(new Map());
  const drawingMarkersRef = useRef<Marker[]>([]);
  const hasInitiallyCenteredRef = useRef<boolean>(false);
  const markerAnimationsRef = useRef<Map<Marker, number>>(new Map());
  const cumulativeUserHeadingRef = useRef<number>(0);
  const updateClusterLayoutRef = useRef<() => void>(() => {});

  // Smooth Marker Position Animation (Interpolation)
  const animateMarkerTo = (marker: Marker, targetLng: number, targetLat: number, durationMs = 600) => {
    const activeAnim = markerAnimationsRef.current.get(marker);
    if (activeAnim) {
      cancelAnimationFrame(activeAnim);
      markerAnimationsRef.current.delete(marker);
    }

    const currentLngLat = marker.getLngLat();
    if (!currentLngLat) {
      marker.setLngLat([targetLng, targetLat]);
      return;
    }

    const startLng = currentLngLat.lng;
    const startLat = currentLngLat.lat;
    const deltaLng = targetLng - startLng;
    const deltaLat = targetLat - startLat;

    // Micro dead-band filter (under ~0.5m): do not twitch or animate
    if (Math.abs(deltaLng) < 0.000005 && Math.abs(deltaLat) < 0.000005) {
      return;
    }

    // Outlier snap: if jump is large (> 500m / teleport), snap instantly
    if (Math.abs(deltaLng) > 0.005 || Math.abs(deltaLat) > 0.005) {
      marker.setLngLat([targetLng, targetLat]);
      return;
    }

    const startTime = performance.now();
    const frame = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / durationMs, 1);
      // Cubic ease-out curve
      const ease = 1 - Math.pow(1 - progress, 3);
      const curLng = startLng + deltaLng * ease;
      const curLat = startLat + deltaLat * ease;
      marker.setLngLat([curLng, curLat]);

      if (progress < 1) {
        const nextId = requestAnimationFrame(frame);
        markerAnimationsRef.current.set(marker, nextId);
      } else {
        markerAnimationsRef.current.delete(marker);
      }
    };

    const animId = requestAnimationFrame(frame);
    markerAnimationsRef.current.set(marker, animId);
  };

  const {
    lat,
    lon,
    accuracyM,
    hasAltitudeFix,
    satellitesCount,
    locationProvider,
    hasGpsFix,
    mapStyle,
    isGridVisible,
    isNightMode,
    waypoints,
    addWaypoint,
    squadMembers,
    selectedTarget,
    setSelectedTarget,
    isDrawingActive,
    toggleDrawing,
    drawingPoints,
    undoDrawingPoint,
    clearDrawing,
    drawings,
    addDrawing,
    removeDrawing,
    clearAllDrawings,
    isLeader,
    callsign,
    distanceUnit,
    coordFormat,
    setActiveModal,
  } = useTacticalStore();

  const [isTilted, setIsTilted] = useState(false);
  const [gridIntervalText, setGridIntervalText] = useState('1 KM');
  const [gridZoneText, setGridZoneText] = useState('MGRS');
  const [eastingTicks, setEastingTicks] = useState<Array<{ x: number; label: string }>>([]);
  const [northingTicks, setNorthingTicks] = useState<Array<{ y: number; label: string }>>([]);
  const reticleRef = useRef<HTMLDivElement>(null);
  const reticlePlumbRef = useRef<HTMLDivElement>(null);
  const reticlePitchElRef = useRef<HTMLSpanElement>(null);
  const reticleMgrsElRef = useRef<HTMLDivElement>(null);
  const [recenterToast, setRecenterToast] = useState<string | null>(null);
  const recenterToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showRecenterToast = (msg: string, durationMs = 3000) => {
    setRecenterToast(msg);
    if (recenterToastTimerRef.current) {
      clearTimeout(recenterToastTimerRef.current);
    }
    recenterToastTimerRef.current = setTimeout(() => {
      setRecenterToast(null);
      recenterToastTimerRef.current = null;
    }, durationMs);
  };

  const handleToggleTilt = () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const currentPitch = map.getPitch();
    const nextPitch = currentPitch > 25 ? 0 : 60;
    map.easeTo({ pitch: nextPitch, duration: 600 });
    setIsTilted(nextPitch > 0);
  };

  const isDrawingActiveRef = useRef(isDrawingActive);
  useEffect(() => {
    isDrawingActiveRef.current = isDrawingActive;
    const map = mapInstanceRef.current;
    if (map) {
      map.getCanvas().style.cursor = isDrawingActive ? 'crosshair' : '';
    }
  }, [isDrawingActive]);

  const onMapReadyRef = useRef(onMapReady);
  useEffect(() => {
    onMapReadyRef.current = onMapReady;
  }, [onMapReady]);

  // 1. Initialize MapLibre GL Map with Google Maps Latest Data
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const initState = useTacticalStore.getState();
    const initialMapStyle = initState.mapStyle;
    const initialHasGpsFix = initState.hasGpsFix;
    const initialLat = initState.lat;
    const initialLon = initState.lon;

    // Latest Google Maps Satellite & Hybrid Tile Sources + Topo Sources with Persistent Offline Tile Caching
    const tacticalMapStyle: StyleSpecification = {
      version: 8,
      sources: {
        'google-satellite-tiles': {
          type: 'raster',
          tiles: [
            'flktile://mt0.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
            'flktile://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
            'flktile://mt2.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
            'flktile://mt3.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
          ],
          tileSize: 256,
          attribution: 'Google',
          maxzoom: 19,
        },
        'google-topo-tiles': {
          type: 'raster',
          tiles: [
            'flktile://mt0.google.com/vt/lyrs=p&x={x}&y={y}&z={z}',
            'flktile://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}',
            'flktile://mt2.google.com/vt/lyrs=p&x={x}&y={y}&z={z}',
            'flktile://mt3.google.com/vt/lyrs=p&x={x}&y={y}&z={z}',
          ],
          tileSize: 256,
          attribution: 'Google',
          maxzoom: 19,
        },
      },
      layers: [
        {
          id: 'tactical-dark-background',
          type: 'background',
          paint: {
            'background-color': '#0d131a',
          },
        },
        {
          id: 'google-satellite-layer',
          type: 'raster',
          source: 'google-satellite-tiles',
          minzoom: 0,
          maxzoom: 24,
          layout: {
            visibility: initialMapStyle === 'satellite' ? 'visible' : 'none',
          },
        },
        {
          id: 'google-topo-layer',
          type: 'raster',
          source: 'google-topo-tiles',
          minzoom: 0,
          maxzoom: 24,
          layout: {
            visibility: initialMapStyle === 'topo' ? 'visible' : 'none',
          },
        },
      ],
    };

    const initialCenter: [number, number] = (initialLat !== 0 || initialLon !== 0)
      ? [initialLon, initialLat]
      : [75.8535, 11.1861]; // Fallback before first recorded fix

    const map = new MapLibreInstance({
      container: mapContainerRef.current,
      style: tacticalMapStyle,
      center: initialCenter,
      zoom: initialHasGpsFix || (initialLat !== 0 || initialLon !== 0) ? 17 : 14,
      minZoom: 2.5,
      maxZoom: 22,
      pitch: 0,
      maxPitch: 65,
      bearing: 0,
      attributionControl: false,
      dragRotate: true,
      pitchWithRotate: true,
      touchPitch: true,
      renderWorldCopies: true,
      canvasContextAttributes: {
        preserveDrawingBuffer: true,
        antialias: true,
        contextType: 'webgl2',
      },
    });

    // Explicitly ensure touch gestures for pitch and zoom are enabled on mobile WebView
    if (map.touchPitch) map.touchPitch.enable();
    if (map.touchZoomRotate) map.touchZoomRotate.enable();

    mapInstanceRef.current = map;
    onMapReadyRef.current?.(map);

    // Click on map: either add drawing vertex or set tactical target
    map.on('click', (e: MapMouseEvent) => {
      if (isDrawingActiveRef.current) {
        useTacticalStore.getState().addDrawingPoint({ lat: e.lngLat.lat, lon: e.lngLat.lng });
      } else {
        useTacticalStore.getState().setSelectedTarget({
          lat: e.lngLat.lat,
          lon: e.lngLat.lng,
          name: `POINT ${e.lngLat.lat.toFixed(4)}, ${e.lngLat.lng.toFixed(4)}`,
        });
      }
    });

    // Track map 3D pitch tilt state & update reticle 2D/3D perspective transform
    const updateReticleTransform = () => {
      const pitch = map.getPitch();
      setIsTilted(pitch > 25);
      if (reticleRef.current) {
        // Dynamic 3D ground projection:
        // When pitch is 0: perfectly flat orthogonal 2D precision crosshairs
        // When pitch > 0: tilts seamlessly into the 3D terrain surface plane
        reticleRef.current.style.transform = `perspective(600px) rotateX(${pitch}deg)`;
      }
      if (reticlePlumbRef.current) {
        reticlePlumbRef.current.style.opacity = pitch > 15 ? '0.85' : '0';
      }
      if (reticlePitchElRef.current) {
        if (pitch > 15) {
          reticlePitchElRef.current.textContent = `3D • ${Math.round(pitch)}°`;
          reticlePitchElRef.current.style.display = 'inline-block';
        } else {
          reticlePitchElRef.current.style.display = 'none';
        }
      }
    };

    map.on('pitch', updateReticleTransform);
    map.on('pitchend', updateReticleTransform);
    map.on('rotate', updateReticleTransform);

    const syncClusterLayout = () => updateClusterLayoutRef.current();
    map.on('zoom', syncClusterLayout);
    map.on('move', syncClusterLayout);
    map.on('moveend', syncClusterLayout);

    // Sync persistent offline tile cache metrics
    TileCacheManager.getTileCount().then((count) => {
      useTacticalStore.setState({
        cachedTilesCount: count,
        tileCacheStatus: count > 0 ? 'cached' : 'offline_grid',
      });
    });

    // Tile Cache Event Listeners for Operator Offline Situational Awareness
    map.on('dataloading', (e: any) => {
      if (e.dataType === 'tile') {
        useTacticalStore.getState().setTileCacheStatus('downloading');
      }
    });

    map.on('idle', () => {
      const store = useTacticalStore.getState();
      if (map.areTilesLoaded()) {
        store.setTileCacheStatus('cached');
      }
    });

    map.on('error', (e: any) => {
      if (
        e &&
        e.error &&
        (e.error.status === 0 ||
          e.error.message?.includes('Failed to fetch') ||
          e.error.message?.includes('NetworkError'))
      ) {
        useTacticalStore.getState().setTileCacheStatus('offline_grid');
      }
    });

    const animationsMap = markerAnimationsRef.current;
    const waypointMap = waypointMarkersRef.current;
    const squadMap = squadMarkersRef.current;
    const notifyMapReady = onMapReadyRef.current;

    return () => {
      map.off('pitch', updateReticleTransform);
      map.off('pitchend', updateReticleTransform);
      map.off('rotate', updateReticleTransform);
      map.off('zoom', syncClusterLayout);
      map.off('move', syncClusterLayout);
      map.off('moveend', syncClusterLayout);
      animationsMap.forEach((id) => cancelAnimationFrame(id));
      animationsMap.clear();

      if (userMarkerRef.current) {
        userMarkerRef.current.remove();
        userMarkerRef.current = null;
      }
      if (targetMarkerRef.current) {
        targetMarkerRef.current.remove();
        targetMarkerRef.current = null;
      }
      waypointMap.forEach((m) => m.remove());
      waypointMap.clear();

      squadMap.forEach((item) => item.marker.remove());
      squadMap.clear();

      drawingMarkersRef.current.forEach((m) => m.remove());
      drawingMarkersRef.current = [];

      map.remove();
      mapInstanceRef.current = null;
      notifyMapReady?.(null);
    };
  }, []);

  // 2. Real GPS User Marker & Precise Auto-Center
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !hasGpsFix || (lat === 0 && lon === 0)) return;

    const buildUserBeaconHtml = (headingDeg: number) => {
      const accentColor = isNightMode ? '#ef4444' : '#10b981';
      const glowColor = isNightMode ? 'rgba(239,68,68,0.5)' : 'rgba(16,185,129,0.5)';
      const calloutBorder = isNightMode ? 'border-red-500/80 text-red-300' : 'border-emerald-400/80 text-emerald-300';
      const userMgrsStr = formatCoordinateShort(lat, lon, coordFormat);
      return `
        <!-- Live Operator Callsign & Grid Badge Attached to Beacon -->
        <div class="user-beacon-callout absolute px-2 py-0.5 rounded bg-black/95 border ${calloutBorder} text-[8.5px] font-mono-tactical font-black tracking-wider uppercase whitespace-nowrap shadow-2xl flex items-center gap-1 pointer-events-none z-30"
             style="left: 26px; top: -18px; transform: translate(-50%, -50%);">
          <span class="w-1.5 h-1.5 rounded-full ${isNightMode ? 'bg-red-400' : 'bg-emerald-400'} animate-pulse"></span>
          <span>${escapeHtml(callsign)}</span>
          <span class="text-white font-bold user-beacon-mgrs ml-0.5">• ${userMgrsStr}</span>
        </div>

        <!-- Smooth Tactical Radar Breathing Pulse (Infinite) -->
        <div class="user-sonar-ring absolute w-12 h-12 rounded-full border ${
          isNightMode ? 'border-red-500/40 bg-red-500/15' : 'border-emerald-400/40 bg-emerald-500/15'
        } animate-tactical-sonar pointer-events-none"></div>

        <!-- Recenter Radar Burst Ring (Triggered on Recenter) -->
        <div class="user-sonar-burst absolute w-12 h-12 rounded-full border ${
          isNightMode ? 'border-red-400 bg-red-500/25' : 'border-emerald-300 bg-emerald-400/25'
        } opacity-0 pointer-events-none"></div>

        <!-- Range Calibration Ring (Static Subtle Glow) -->
        <div class="absolute w-8 h-8 rounded-full border ${
          isNightMode ? 'border-red-500/30 bg-red-950/40' : 'border-emerald-400/30 bg-emerald-950/40'
        } shadow-[0_0_12px_${glowColor}]"></div>

        <!-- Rotating Tactical Chevron Navigation Beacon (Tilts flat with map pitch, rotates with device orientation) -->
        <svg class="tactical-user-rotator absolute w-[52px] h-[52px]" viewBox="0 0 52 52" fill="none" style="transform-origin: 26px 26px; transform: rotate(${headingDeg}deg); transition: transform 0.12s cubic-bezier(0.2, 0.8, 0.2, 1);">
          <!-- Forward Radar Field of View (FOV) Illumination Beam (±25 deg) -->
          <path d="M 26 26 L 15 4 A 24 24 0 0 1 37 4 Z" fill="url(#user-fov-gradient)" />

          <!-- Clean Aerodynamic Tactical Chevron Arrow (Live Orientation) -->
          <path d="M 26 8 L 37 36 L 26 30 L 15 36 Z" 
                fill="${accentColor}" 
                stroke="#ffffff" 
                stroke-width="1.8" 
                stroke-linejoin="round"
                class="drop-shadow-[0_0_8px_${glowColor}]" />

          <!-- Center Precision Millimeter Core Anchor -->
          <circle cx="26" cy="26" r="4.5" fill="${isNightMode ? '#3f0c0c' : '#042f1a'}" stroke="${isNightMode ? '#f87171' : '#34d399'}" stroke-width="1.5" />
          <circle cx="26" cy="26" r="2" fill="#ffffff" />

          <defs>
            <radialGradient id="user-fov-gradient" cx="50%" cy="100%" r="100%">
              <stop offset="0%" stop-color="${accentColor}" stop-opacity="0.5" />
              <stop offset="60%" stop-color="${accentColor}" stop-opacity="0.18" />
              <stop offset="100%" stop-color="${accentColor}" stop-opacity="0.0" />
            </radialGradient>
          </defs>
        </svg>
      `;
    };

    const nextStyleSig = `${isNightMode ? 1 : 0}-${callsign}`;

    // Create custom tactical DOM element for user beacon if not existing
    if (!userMarkerRef.current) {
      const el = document.createElement('div');
      el.className = 'tactical-user-beacon relative flex items-center justify-center pointer-events-none select-none';
      el.style.width = '52px';
      el.style.height = '52px';
      el.innerHTML = buildUserBeaconHtml(useTacticalStore.getState().compassHeading);

      userMarkerStyleSigRef.current = nextStyleSig;
      userMarkerElRef.current = el;
      userMarkerRef.current = new Marker({
        element: el,
        pitchAlignment: 'map',
        rotationAlignment: 'map',
      })
        .setLngLat([lon, lat])
        .addTo(map);
    } else {
      animateMarkerTo(userMarkerRef.current, lon, lat, 600);
      if (userMarkerStyleSigRef.current !== nextStyleSig && userMarkerElRef.current) {
        userMarkerStyleSigRef.current = nextStyleSig;
        userMarkerElRef.current.innerHTML = buildUserBeaconHtml(cumulativeUserHeadingRef.current);
      } else {
        const mgrsSpan = userMarkerElRef.current?.querySelector('.user-beacon-mgrs');
        if (mgrsSpan) {
          mgrsSpan.textContent = `• ${formatCoordinateShort(lat, lon, coordFormat)}`;
        }
      }
    }

    // Auto-fly strictly ONCE on initial GPS lock
    if (!hasInitiallyCenteredRef.current) {
      hasInitiallyCenteredRef.current = true;
      map.flyTo({ center: [lon, lat], zoom: 17.5, duration: 1500 });
    }
  }, [lat, lon, hasGpsFix, isNightMode, callsign, coordFormat]);

  // Instantly re-render on-screen reticle and beacon badges when coordinate format is switched
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (map && reticleMgrsElRef.current) {
      const center = map.getCenter();
      reticleMgrsElRef.current.textContent = formatCoordinateShort(center.lat, center.lng, coordFormat);
    }
    if (userMarkerElRef.current && (lat !== 0 || lon !== 0)) {
      const mgrsSpan = userMarkerElRef.current.querySelector('.user-beacon-mgrs');
      if (mgrsSpan) {
        mgrsSpan.textContent = `• ${formatCoordinateShort(lat, lon, coordFormat)}`;
      }
    }
  }, [coordFormat, lat, lon]);

  // Google Maps Style Live GNSS & Cell Uncertainty Accuracy Radius Halo
  // Exclusively appears during CELL 2D / coarse indoor mode; completely hidden in 3D GNSS mode
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !hasGpsFix || (lat === 0 && lon === 0)) return;

    const sourceId = 'user-accuracy-source';
    const fillLayerId = 'user-accuracy-fill';
    const lineLayerId = 'user-accuracy-line';

    const isGnss3D = satellitesCount >= 4 || (accuracyM > 0 && accuracyM <= 15 && hasAltitudeFix && locationProvider !== 'network');
    const isCellOrCoarse = !isGnss3D || accuracyM > 25 || locationProvider === 'network';

    const renderAccuracy = () => {
      if (!hasStyleLayers(map)) return;

      const existingSource = map.getSource(sourceId) as GeoJSONSource;

      // In 3D GNSS mode (clear satellite lock): keep map clean, hide uncertainty halo completely
      if (!isCellOrCoarse) {
        if (existingSource) {
          existingSource.setData({
            type: 'FeatureCollection',
            features: [],
          });
        }
        return;
      }

      // In CELL 2D / coarse mode: render expanding uncertainty perimeter around pinned position
      const displayRadiusM = Math.max(accuracyM || 35, 25);
      const circleFeature = createGeoJsonCircle(lon, lat, displayRadiusM);
      const geojsonData: any = {
        type: 'FeatureCollection',
        features: [circleFeature],
      };

      const color = isNightMode ? '#ef4444' : '#10b981';

      if (existingSource) {
        existingSource.setData(geojsonData);
        if (map.getLayer(fillLayerId)) {
          map.setPaintProperty(fillLayerId, 'fill-color', color);
          map.setPaintProperty(fillLayerId, 'fill-opacity', isNightMode ? 0.08 : 0.06);
        }
        if (map.getLayer(lineLayerId)) {
          map.setPaintProperty(lineLayerId, 'line-color', color);
        }
      } else {
        map.addSource(sourceId, {
          type: 'geojson',
          data: geojsonData,
        });

        if (!map.getLayer(fillLayerId)) {
          map.addLayer({
            id: fillLayerId,
            type: 'fill',
            source: sourceId,
            paint: {
              'fill-color': color,
              'fill-opacity': isNightMode ? 0.08 : 0.06,
            },
          });
        }

        if (!map.getLayer(lineLayerId)) {
          map.addLayer({
            id: lineLayerId,
            type: 'line',
            source: sourceId,
            paint: {
              'line-color': color,
              'line-width': 1.2,
              'line-opacity': 0.35,
              'line-dasharray': [2, 2],
            },
          });
        }
      }
    };

    runWhenStyleReady(map, renderAccuracy);
  }, [lat, lon, accuracyM, hasGpsFix, isNightMode, mapStyle, satellitesCount, hasAltitudeFix, locationProvider]);

  // Cluster-Wide Peer Accuracy Uncertainty Halos (Renders for any indoor/degraded squad members)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const sourceId = 'squad-accuracy-source';
    const fillLayerId = 'squad-accuracy-fill';
    const lineLayerId = 'squad-accuracy-line';

    const renderSquadAccuracy = () => {
      if (!hasStyleLayers(map)) return;

      const indoorMembers = squadMembers.filter(
        (m) => m.lat !== 0 && m.lon !== 0 && (m.fixType === 'PINNED_INDOOR' || (m.accuracy !== undefined && m.accuracy > 35))
      );

      const features = indoorMembers.map((m) =>
        createGeoJsonCircle(m.lon, m.lat, Math.max(m.accuracy || 45, 30))
      );

      const geojsonData: any = {
        type: 'FeatureCollection',
        features,
      };

      const existingSource = map.getSource(sourceId) as GeoJSONSource;
      if (existingSource) {
        existingSource.setData(geojsonData);
      } else {
        map.addSource(sourceId, {
          type: 'geojson',
          data: geojsonData,
        });

        if (!map.getLayer(fillLayerId)) {
          map.addLayer({
            id: fillLayerId,
            type: 'fill',
            source: sourceId,
            paint: {
              'fill-color': '#f59e0b',
              'fill-opacity': isNightMode ? 0.08 : 0.06,
            },
          });
        }

        if (!map.getLayer(lineLayerId)) {
          map.addLayer({
            id: lineLayerId,
            type: 'line',
            source: sourceId,
            paint: {
              'line-color': '#f59e0b',
              'line-width': 1.2,
              'line-opacity': 0.45,
              'line-dasharray': [2, 2],
            },
          });
        }
      }
    };

    runWhenStyleReady(map, renderSquadAccuracy);
  }, [squadMembers, isNightMode, mapStyle]);

  // 3. High-Performance Direct DOM Heading Pointer (Zero React Component Re-renders at 30Hz)
  useEffect(() => {
    let lastHeading = useTacticalStore.getState().compassHeading;
    const unsub = useTacticalStore.subscribe((state) => {
      if (state.compassHeading !== lastHeading) {
        lastHeading = state.compassHeading;
        if (userMarkerElRef.current) {
          const rotator = userMarkerElRef.current.querySelector('.tactical-user-rotator') as HTMLElement;
          if (rotator) {
            cumulativeUserHeadingRef.current = getShortestRotation(cumulativeUserHeadingRef.current, state.compassHeading);
            rotator.style.transform = `rotate(${cumulativeUserHeadingRef.current}deg)`;
          }
        }
      }
    });
    return () => unsub();
  }, []);

  // Recenter radar pulse trigger (preserves infinite breathing pulse, fires fast burst)
  const triggerRecenterPulse = () => {
    const burstRing = userMarkerElRef.current?.querySelector('.user-sonar-burst') as HTMLElement;
    if (burstRing) {
      burstRing.style.animation = 'none';
      void burstRing.offsetWidth;
      burstRing.style.animation = 'tactical-sonar-burst 1.2s ease-out forwards';
    }
    const sonarRing = userMarkerElRef.current?.querySelector('.user-sonar-ring') as HTMLElement;
    if (sonarRing) {
      // Ensure infinite breathing pulse continues cleanly and never stops
      if (sonarRing.style.animation) {
        sonarRing.style.animation = '';
      }
    }
  };

  useEffect(() => {
    const lastCryptoToastMs = new Map<string, number>();
    const handleRecenterEvent = () => {
      triggerRecenterPulse();
    };
    const handleCryptoErr = (e: any) => {
      const err = e.detail;
      // Passive pre-connect blocks are surfaced in the Squad/Nearby modal; don't spam the live map HUD
      if (err?.type === 'PRECONNECT_KEY_MISMATCH') {
        return;
      }
      const caller = err?.callsign || 'SQUAD PEER';
      const peerKey = String(err?.nodeId || err?.endpointId || caller);
      const now = Date.now();
      if (now - (lastCryptoToastMs.get(peerKey) ?? 0) < 60000) {
        return;
      }
      lastCryptoToastMs.set(peerKey, now);
      showRecenterToast(`⚠️ CIPHER MISMATCH: Packets from ${caller} rejected! Ensure both devices have identical Mission Key.`, 3500);
    };

    window.addEventListener('fieldlink:recenter', handleRecenterEvent);
    window.addEventListener('fieldlink:crypto-error', handleCryptoErr);
    return () => {
      window.removeEventListener('fieldlink:recenter', handleRecenterEvent);
      window.removeEventListener('fieldlink:crypto-error', handleCryptoErr);
    };
  }, []);

  // 4. Target Marker Overlay
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (!selectedTarget) {
      if (targetMarkerRef.current) {
        targetMarkerRef.current.remove();
        targetMarkerRef.current = null;
      }
      return;
    }

    if (!targetMarkerRef.current) {
      const el = document.createElement('div');
      el.className = 'relative flex items-center justify-center pointer-events-none';
      el.style.width = '36px';
      el.style.height = '36px';
      el.innerHTML = `
        <div class="absolute w-8 h-[2px] bg-[#35D5D9] shadow-[0_0_8px_#35D5D9]"></div>
        <div class="absolute h-8 w-[2px] bg-[#35D5D9] shadow-[0_0_8px_#35D5D9]"></div>
        <div class="w-4 h-4 rounded-full border-2 border-[#35D5D9] bg-cyan-500/20"></div>
      `;
      targetMarkerRef.current = new Marker({
        element: el,
        pitchAlignment: 'map',
        rotationAlignment: 'map',
      })
        .setLngLat([selectedTarget.lon, selectedTarget.lat])
        .addTo(map);
    } else {
      targetMarkerRef.current.setLngLat([selectedTarget.lon, selectedTarget.lat]);
    }
  }, [selectedTarget]);

  // 5. Waypoints Markers
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const currentMap = waypointMarkersRef.current;
    const activeIds = new Set(waypoints.map((w) => w.id));

    currentMap.forEach((marker, id) => {
      if (!activeIds.has(id)) {
        marker.remove();
        currentMap.delete(id);
      }
    });

    waypoints.forEach((wp) => {
      const dKm = hasGpsFix && (lat !== 0 || lon !== 0)
        ? calculateDistanceKm(lat, lon, wp.lat, wp.lon)
        : 0;

      const distText = dKm > 0
        ? (distanceUnit === 'KM'
            ? (dKm < 1 ? `${Math.round(dKm * 1000)} M` : `${dKm.toFixed(2)} KM`)
            : `${(dKm * 0.621371).toFixed(2)} MI`)
        : '';

      const mgrsText = formatCoordinateShort(wp.lat, wp.lon, coordFormat);
      const creator = wp.createdBy || callsign;
      const isMyWp = wp.createdBy === callsign;
      const userCol = getCallsignColor(creator);

      if (!currentMap.has(wp.id)) {
        const el = document.createElement('div');
        el.className = 'tactical-waypoint-marker flex flex-col items-center cursor-pointer select-none -translate-y-4';
        el.innerHTML = `
          <!-- Name, Category & Unique Device Attribution Tactical Badge -->
          <div class="px-2 py-0.5 rounded bg-black/95 text-[9px] font-mono-tactical font-black tracking-wider whitespace-nowrap shadow-2xl flex items-center gap-1.5"
               style="border: 1px solid ${userCol.borderHex}; box-shadow: ${userCol.glow};">
            <span class="w-1.5 h-1.5 rounded-full" style="background-color: ${userCol.hex};"></span>
            <span class="text-white font-bold">${escapeHtml(wp.name)}</span>
            <span class="px-1 py-0.2 rounded text-[7.5px] border font-black"
                  style="background-color: ${userCol.bgHex}; border-color: ${userCol.borderHex}; color: ${userCol.hex};">
              ${escapeHtml(wp.category)}
            </span>
            <span class="px-1 py-0.2 rounded text-[7px] font-black uppercase tracking-tight bg-black/90"
                  style="border: 1px solid ${userCol.hex}; color: ${userCol.hex};">
              ${isMyWp ? '★ YOU' : escapeHtml(creator)}
            </span>
          </div>
          <!-- Exact Coordinate Grid & Range Badge -->
          <div class="wp-dist-badge px-1.5 py-0.2 rounded bg-black/90 border border-[#2b3d2f] text-cyan-300 text-[8px] font-mono whitespace-nowrap mt-0.5 shadow-md">
            ${mgrsText}${distText ? ` • ${distText}` : ''}
          </div>
          <!-- Tactical Ground Pin Anchor in User's Unique Device Color -->
          <div class="w-3.5 h-3.5 rotate-45 flex items-center justify-center shadow-lg mt-0.5 border"
               style="background-color: ${userCol.hex}; border-color: #ffffff; box-shadow: ${userCol.glow};">
            <div class="w-1.5 h-1.5 bg-black rounded-full"></div>
          </div>
        `;

        el.onclick = (e) => {
          e.stopPropagation();
          useTacticalStore.getState().setSelectedTarget({
            lat: wp.lat,
            lon: wp.lon,
            name: `WP: ${wp.name}`,
          });
        };

        const marker = new Marker({
          element: el,
          pitchAlignment: 'map',
          rotationAlignment: 'viewport',
        })
          .setLngLat([wp.lon, wp.lat])
          .addTo(map);
        currentMap.set(wp.id, marker);
      } else {
        const marker = currentMap.get(wp.id);
        if (marker) {
          const el = marker.getElement();
          const distEl = el.querySelector('.wp-dist-badge');
          if (distEl) {
            distEl.textContent = `${mgrsText}${distText ? ` • ${distText}` : ''}`;
          }
        }
      }
    });
  }, [waypoints, lat, lon, hasGpsFix, distanceUnit, coordFormat, callsign]);

  // 6. Tactical Squad Members Markers (NATO Symbols from Reference Design)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const currentMap = squadMarkersRef.current;
    const activeIds = new Set(squadMembers.map((m) => m.id));

    // Remove disconnected/removed squad members
    currentMap.forEach((item, id) => {
      if (!activeIds.has(id)) {
        item.marker.remove();
        currentMap.delete(id);
      }
    });

    // Add or update active squad members as live tactical beacons
    squadMembers.forEach((member: SquadMember) => {
      if (member.lat === 0 && member.lon === 0) return;

      const dKm = (hasGpsFix && (lat !== 0 || lon !== 0) && member.lat !== 0 && member.lon !== 0)
        ? calculateDistanceKm(lat, lon, member.lat, member.lon)
        : (member.distanceKm || 0);

      const distText = dKm > 0
        ? (distanceUnit === 'KM'
            ? (dKm < 1 ? `${Math.round(dKm * 1000)} M` : `${dKm.toFixed(2)} KM`)
            : `${(dKm * 0.621371).toFixed(2)} MI`)
        : '';

      const isSOS = member.status === 'SOS';
      const isDisconnected = member.status === 'DISCONNECTED';
      const isIndoor = member.fixType === 'PINNED_INDOOR' || (member.accuracy !== undefined && member.accuracy > 35);
      const stateSig = `${member.status}-${member.isLeader ? 1 : 0}-${isIndoor ? Math.round(member.accuracy || 50) : 0}-${escapeHtml(member.callsign)}`;

      const buildSquadBeaconHtml = (headingDeg: number) => {
        const indoorBadge = isIndoor ? `<span class="px-1 py-0.2 rounded bg-amber-950/80 border border-amber-500/60 text-amber-300 text-[6.5px] font-black uppercase tracking-tight ml-0.5">±${Math.round(member.accuracy || 50)}M PINNED</span>` : '';
        const offBadge = isDisconnected ? `<span class="px-1 py-0.2 rounded bg-slate-900/90 border border-slate-600 text-slate-400 text-[6.5px] font-black uppercase tracking-tight ml-0.5">OFFLINE</span>` : '';
        const memberCol = getCallsignColor(member.callsign);
        const squadColor = isSOS ? '#ef4444' : isDisconnected ? '#64748b' : memberCol.hex;
        const squadBorder = isSOS ? 'border-red-500' : '';
        const squadText = isSOS ? 'text-red-400' : isDisconnected ? 'text-slate-400' : memberCol.textClass;
        const squadBgCore = isSOS ? '#3f0c0c' : isDisconnected ? '#1e293b' : '#082f49';
        const squadCoreStroke = isSOS ? '#f87171' : isDisconnected ? '#94a3b8' : memberCol.borderHex;

        return `
          <!-- Callsign, Grid & Distance Badge with Distinct Cluster Color -->
          <div class="squad-callout-card absolute px-2 py-0.5 rounded bg-black/90 ${squadBorder} ${squadText} ${
            isSOS ? 'animate-pulse' : ''
          } text-[9px] font-mono-tactical font-black tracking-wider uppercase whitespace-nowrap shadow-2xl flex flex-col items-center z-20 pointer-events-auto"
               style="left: 26px; top: -18px; transform: translate(-50%, -50%); border: 1px solid ${isSOS ? '#ef4444' : isDisconnected ? '#64748b' : memberCol.borderHex}; box-shadow: ${isSOS || isDisconnected ? '' : memberCol.glow};">
            <div class="flex items-center gap-1">
              <span class="w-1.5 h-1.5 rounded-full ${isSOS ? 'bg-red-500' : ''}" style="${isSOS ? '' : `background-color: ${squadColor};`}"></span>
              <span>${member.isLeader ? '★ ' : ''}${escapeHtml(member.callsign)}</span>
              ${indoorBadge}${offBadge}
              <span class="squad-dist-badge text-amber-400 font-bold ml-0.5">${distText ? `• ${distText}` : ''}</span>
            </div>
            <div class="squad-mgrs-badge text-[7.5px] font-mono tracking-tighter mt-0.5" style="color: ${squadColor};">
              ${formatCoordinateShort(member.lat, member.lon, coordFormat)}${isIndoor ? ` • ±${Math.round(member.accuracy || 50)}M` : ''}
            </div>
          </div>

          <!-- Clean Shaped Squad Beacon (Centered directly on operator GPS fix) -->
          <div class="relative w-[52px] h-[52px] flex items-center justify-center">
            <!-- Smooth Sonar Breathing Pulse -->
            <div class="absolute w-11 h-11 rounded-full border ${
              isSOS ? 'border-red-500/40 bg-red-500/20 animate-tactical-sonar' : isDisconnected ? 'border-slate-500/30 bg-slate-500/10' : 'border-cyan-400/40 bg-cyan-500/15 animate-tactical-sonar'
            }"></div>

            <!-- Rotating Tactical Chevron Navigation Beacon (Tilts flat with map pitch, centered at 26px, 26px) -->
            <svg class="squad-heading-rotator absolute w-[52px] h-[52px]" viewBox="0 0 52 52" fill="none" style="transform-origin: 26px 26px; transform: rotate(${headingDeg}deg); transition: transform 0.15s ease-out;">
              <!-- Tactical Chevron Arrow -->
              <path d="M 26 9 L 37 36 L 26 30 L 15 36 Z" 
                    fill="${squadColor}" 
                    stroke="#ffffff" 
                    stroke-width="1.8" 
                    stroke-linejoin="round"
                    class="drop-shadow-[0_0_8px_${squadColor}]" />

              <!-- Center Precision Core -->
              <circle cx="26" cy="26" r="4.5" fill="${squadBgCore}" stroke="${squadCoreStroke}" stroke-width="1.5" />
              <circle cx="26" cy="26" r="2" fill="#ffffff" />
            </svg>
          </div>
        `;
      };

      const bindClickHandler = (el: HTMLElement) => {
        el.onclick = (e) => {
          e.stopPropagation();
          const targetName = isIndoor
            ? `SQUAD: ${member.callsign} [INDOOR PINNED]`
            : `SQUAD: ${member.callsign}`;
          setSelectedTarget({
            lat: member.lat,
            lon: member.lon,
            name: targetName,
          });
          if (isIndoor) {
            showRecenterToast(`TARGET: ${member.callsign} • LAST CONFIRMED GPS (INDOOR PINNED ±${Math.round(member.accuracy || 50)}M)`, 3000);
          }
        };
      };

      if (!currentMap.has(member.id)) {
        const el = document.createElement('div');
        el.className = 'tactical-squad-beacon relative flex items-center justify-center cursor-pointer select-none';
        el.style.width = '52px';
        el.style.height = '52px';
        el.style.opacity = isDisconnected ? '0.6' : '1';
        el.innerHTML = buildSquadBeaconHtml(member.heading || 0);
        bindClickHandler(el);

        const marker = new Marker({
          element: el,
          pitchAlignment: 'map',
          rotationAlignment: 'map',
        })
          .setLngLat([member.lon, member.lat])
          .addTo(map);

        currentMap.set(member.id, { marker, el, cumulativeHeading: member.heading || 0, stateSig });
      } else {
        const item = currentMap.get(member.id)!;
        animateMarkerTo(item.marker, member.lon, member.lat, 800);

        const targetHeading = member.heading || 0;
        item.cumulativeHeading = getShortestRotation(item.cumulativeHeading ?? targetHeading, targetHeading);

        if (item.stateSig !== stateSig) {
          item.stateSig = stateSig;
          item.el.style.opacity = isDisconnected ? '0.6' : '1';
          item.el.innerHTML = buildSquadBeaconHtml(item.cumulativeHeading);
          bindClickHandler(item.el);
        } else {
          const rotator = item.el.querySelector('.squad-heading-rotator') as HTMLElement;
          if (rotator) {
            rotator.style.transform = `rotate(${item.cumulativeHeading}deg)`;
          }

          const distBadge = item.el.querySelector('.squad-dist-badge') as HTMLElement;
          if (distBadge) {
            distBadge.textContent = distText ? `• ${distText}` : '';
          }
          const mgrsBadge = item.el.querySelector('.squad-mgrs-badge') as HTMLElement;
          if (mgrsBadge) {
            const coordStr = formatCoordinateShort(member.lat, member.lon, coordFormat);
            mgrsBadge.textContent = isIndoor
              ? `${coordStr} • ±${Math.round(member.accuracy || 50)}M PINNED`
              : coordStr;
          }
        }
      }
    });

    // Dynamic screen-space anti-overlap layout for close-range peer chevrons and callout cards
    const layoutCloseRangeBeacons = () => {
      type Rect = { x1: number; y1: number; x2: number; y2: number };
      const overlapArea = (a: Rect, b: Rect) => {
        const ix = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
        const iy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
        return ix * iy;
      };

      const occupiedRects: Rect[] = [];
      const placedIcons: Array<{ x: number; y: number }> = [];

      // Reserve viewport center reticle + live ground coordinate pill so badges stay clear of it
      const containerEl = map.getContainer();
      if (containerEl) {
        const cx = containerEl.clientWidth / 2;
        const cy = containerEl.clientHeight / 2;
        occupiedRects.push({ x1: cx - 18, y1: cy - 18, x2: cx + 18, y2: cy + 18 });
        const reticleBox = reticleMgrsElRef.current?.parentElement as HTMLElement | null;
        const rW = Math.max(reticleBox?.offsetWidth || 126, 96);
        const rH = Math.max(reticleBox?.offsetHeight || 22, 20);
        // translate-y-9 (36px) below center
        occupiedRects.push({
          x1: cx - rW / 2 - 4,
          y1: cy + 36 - rH / 2 - 4,
          x2: cx + rW / 2 + 4,
          y2: cy + 36 + rH / 2 + 4,
        });
      }

      const orderedPeers = Array.from(currentMap.entries()).sort(([idA], [idB]) => idA.localeCompare(idB));
      const iconOffsets: Array<[number, number]> = [
        [0, 0],
        [-38, 0],
        [38, 0],
        [0, 38],
        [-32, 32],
        [32, 32],
        [-32, -32],
        [32, -32],
      ];

      // Pre-compute peer chevron centers so the self callout card can also dodge any peer chevron above it
      const peerIconPositions = new Map<string, { iconX: number; iconY: number; marker: Marker; el: HTMLElement }>();

      // Reserve self operator chevron first
      let selfPt: { x: number; y: number } | null = null;
      if (hasGpsFix && (lat !== 0 || lon !== 0)) {
        selfPt = map.project([lon, lat]);
        placedIcons.push({ x: selfPt.x, y: selfPt.y });
        occupiedRects.push({ x1: selfPt.x - 27, y1: selfPt.y - 27, x2: selfPt.x + 27, y2: selfPt.y + 27 });
      }

      // 1. Place all peer chevrons and reserve their chevron rects
      for (const [id, item] of orderedPeers) {
        const lngLat = item.marker.getLngLat();
        const basePt = map.project(lngLat);

        let chosenIconOffset: [number, number] = [0, 0];
        for (const cand of iconOffsets) {
          const cx = basePt.x + cand[0];
          const cy = basePt.y + cand[1];
          const collides = placedIcons.some((p) => Math.hypot(cx - p.x, cy - p.y) < 34);
          if (!collides) {
            chosenIconOffset = cand;
            break;
          }
        }
        item.marker.setOffset(chosenIconOffset);

        const iconX = basePt.x + chosenIconOffset[0];
        const iconY = basePt.y + chosenIconOffset[1];
        placedIcons.push({ x: iconX, y: iconY });
        occupiedRects.push({ x1: iconX - 27, y1: iconY - 27, x2: iconX + 27, y2: iconY + 27 });
        peerIconPositions.set(id, { iconX, iconY, marker: item.marker, el: item.el });
      }

      // Helper to pick best non-overlapping center offset (ox, oy) for a callout card
      const pickCardSlot = (anchorX: number, anchorY: number, cardEl: HTMLElement, defaultW: number, defaultH: number, preferLeftFirst = false) => {
        const w = Math.max(cardEl.offsetWidth || defaultW, 100);
        const h = Math.max(cardEl.offsetHeight || defaultH, 22);
        const topSlot: [number, number] = [0, -(28 + 6 + h / 2)];
        const bottomSlot: [number, number] = [0, 28 + 6 + h / 2];
        const leftSlot: [number, number] = [-(28 + 8 + w / 2), 0];
        const rightSlot: [number, number] = [28 + 8 + w / 2, 0];
        const brSlot: [number, number] = [22 + w / 2, 24 + h / 2];
        const blSlot: [number, number] = [-(22 + w / 2), 24 + h / 2];
        const trSlot: [number, number] = [22 + w / 2, -(24 + h / 2)];
        const tlSlot: [number, number] = [-(22 + w / 2), -(24 + h / 2)];

        const cardSlots: Array<[number, number]> = preferLeftFirst
          ? [topSlot, bottomSlot, rightSlot, leftSlot, trSlot, tlSlot, brSlot, blSlot]
          : [topSlot, bottomSlot, rightSlot, leftSlot, brSlot, blSlot, trSlot, tlSlot];

        const safeLeft = 56;
        const safeRight = containerEl ? Math.max(containerEl.clientWidth - 10, 220) : 9999;
        const safeTop = 44;
        const safeBottom = containerEl ? Math.max(containerEl.clientHeight - 16, 200) : 9999;

        let bestCenterX = anchorX;
        let bestCenterY = anchorY + cardSlots[0][1];
        let bestScore = Infinity;
        for (const slot of cardSlots) {
          const clampedX = Math.max(safeLeft + w / 2, Math.min(safeRight - w / 2, anchorX + slot[0]));
          const clampedY = Math.max(safeTop + h / 2, Math.min(safeBottom - h / 2, anchorY + slot[1]));
          const rect: Rect = {
            x1: clampedX - w / 2 - 4,
            y1: clampedY - h / 2 - 4,
            x2: clampedX + w / 2 + 4,
            y2: clampedY + h / 2 + 4,
          };
          let score = 0;
          for (const occ of occupiedRects) {
            score += overlapArea(rect, occ);
          }
          if (score === 0) {
            bestCenterX = clampedX;
            bestCenterY = clampedY;
            bestScore = 0;
            break;
          }
          if (score < bestScore) {
            bestScore = score;
            bestCenterX = clampedX;
            bestCenterY = clampedY;
          }
        }

        cardEl.style.left = `${26 + (bestCenterX - anchorX)}px`;
        cardEl.style.top = `${26 + (bestCenterY - anchorY)}px`;
        cardEl.style.transform = 'translate(-50%, -50%)';

        occupiedRects.push({
          x1: bestCenterX - w / 2 - 4,
          y1: bestCenterY - h / 2 - 4,
          x2: bestCenterX + w / 2 + 4,
          y2: bestCenterY + h / 2 + 4,
        });
      };

      // 2. Place self operator callout card cleanly around self chevron (never covered by peer chevrons)
      if (selfPt) {
        const selfCallout = userMarkerElRef.current?.querySelector('.user-beacon-callout') as HTMLElement | null;
        if (selfCallout) {
          pickCardSlot(selfPt.x, selfPt.y, selfCallout, 146, 22, true);
        }
      }

      // 3. Place every peer callout card avoiding reticle, self card, all chevrons, and earlier peer cards
      for (const [id] of orderedPeers) {
        const info = peerIconPositions.get(id);
        if (!info) continue;
        const cardEl = info.el.querySelector('.squad-callout-card') as HTMLElement | null;
        if (!cardEl) continue;
        pickCardSlot(info.iconX, info.iconY, cardEl, 144, 28, false);
      }
    };

    updateClusterLayoutRef.current = layoutCloseRangeBeacons;
    layoutCloseRangeBeacons();
    const rafLayout = requestAnimationFrame(layoutCloseRangeBeacons);
    return () => cancelAnimationFrame(rafLayout);
  }, [squadMembers, lat, lon, hasGpsFix, distanceUnit, coordFormat, setSelectedTarget]);

  // 7. Tactical Drawing & Shared Cluster Routes Overlay on MapLibre
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // 1. Remove old drawing vertex markers
    drawingMarkersRef.current.forEach((m) => m.remove());
    drawingMarkersRef.current = [];

    // 2. Add numbered tactical markers for active drawing vertices
    drawingPoints.forEach((p, idx) => {
      const el = document.createElement('div');
      el.className = 'relative flex items-center justify-center pointer-events-none select-none';
      el.style.width = '24px';
      el.style.height = '24px';
      el.innerHTML = `
        <div class="w-5 h-5 rounded-full ${
          isNightMode ? 'bg-red-600 border-red-300' : 'bg-[#D1A34A] border-black'
        } border-2 flex items-center justify-center shadow-lg font-mono-tactical text-[9px] font-black text-black">
          ${idx + 1}
        </div>
      `;
      const marker = new Marker({ element: el })
        .setLngLat([p.lon, p.lat])
        .addTo(map);
      drawingMarkersRef.current.push(marker);
    });

    // 3. Update GeoJSON LineString on MapLibre (combining shared cluster drawings & active line)
    const updateLineOverlay = () => {
      if (!hasStyleLayers(map)) return;

      const sourceId = 'tactical-draw-source';
      const lineLayerId = 'tactical-draw-line';
      const haloLayerId = 'tactical-draw-halo';

      const features: any[] = [];

      // Add all shared cluster drawings from all members
      drawings.forEach((d) => {
        if (d.points.length >= 2) {
          const userCol = getCallsignColor(d.createdBy);
          features.push({
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: d.points.map((pt) => [pt.lon, pt.lat]),
            },
            properties: {
              id: d.id,
              color: d.color || userCol.hex,
            },
          });
        }
      });

      // Add in-progress active drawing by current operator
      if (drawingPoints.length >= 2) {
        features.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: drawingPoints.map((pt) => [pt.lon, pt.lat]),
          },
          properties: {
            id: 'active-plot',
            color: isNightMode ? '#ff4444' : '#D1A34A',
          },
        });
      }

      const lineGeoJson: any = {
        type: 'FeatureCollection',
        features,
      };

      const existingSource = map.getSource(sourceId) as GeoJSONSource;
      if (existingSource) {
        existingSource.setData(lineGeoJson);
      } else {
        map.addSource(sourceId, {
          type: 'geojson',
          data: lineGeoJson,
        });

        map.addLayer({
          id: haloLayerId,
          type: 'line',
          source: sourceId,
          layout: {
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-color': '#000000',
            'line-width': 5,
            'line-opacity': 0.8,
          },
        });

        map.addLayer({
          id: lineLayerId,
          type: 'line',
          source: sourceId,
          layout: {
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-color': ['coalesce', ['get', 'color'], '#35D5D9'],
            'line-width': 3,
            'line-dasharray': [2, 1],
          },
        });
      }
    };

    runWhenStyleReady(map, updateLineOverlay);
  }, [drawings, drawingPoints, isNightMode]);

  // 8. Instant 0ms Switch between Google Satellite / Hybrid & Google Topo styles
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const applyVisibility = () => {
      try {
        if (map.getLayer('google-satellite-layer')) {
          map.setLayoutProperty(
            'google-satellite-layer',
            'visibility',
            mapStyle === 'satellite' ? 'visible' : 'none'
          );
        }
        if (map.getLayer('google-topo-layer')) {
          map.setLayoutProperty(
            'google-topo-layer',
            'visibility',
            mapStyle === 'topo' ? 'visible' : 'none'
          );
        }
        map.triggerRepaint();
      } catch {}
    };

    runWhenStyleReady(map, applyVisibility);
  }, [mapStyle]);

  // 9. Real Tactical MGRS GeoJSON Coordinate Grid with Dynamic Scale & Marginalia Ticks
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const sourceId = 'tactical-mgrs-grid-source';
    const haloLayerId = 'tactical-mgrs-grid-halo';
    const lineLayerId = 'tactical-mgrs-grid-lines';

    let lastStep = 0;
    let lastBufferedBounds: { west: number; east: number; south: number; north: number } | null = null;

    const updateGrid = (forceGeometry = false) => {
      if (!isGridVisible) {
        if (map.getLayer(haloLayerId)) map.setLayoutProperty(haloLayerId, 'visibility', 'none');
        if (map.getLayer(lineLayerId)) map.setLayoutProperty(lineLayerId, 'visibility', 'none');
        setEastingTicks([]);
        setNorthingTicks([]);
        return;
      }

      const bounds = map.getBounds();
      const zoom = map.getZoom();
      const center = map.getCenter();

      // Update reticle coordinate badge directly in DOM (ZERO React re-renders)
      if (reticleMgrsElRef.current) {
        reticleMgrsElRef.current.textContent = formatCoordinateShort(center.lat, center.lng, coordFormat);
      }

      // Dynamic Grid Step based on tactical zoom level
      let step = 0.01;
      let label = '1 KM';
      let decimals = 2;

      if (zoom >= 16.5) { step = 0.001; label = '100 M'; decimals = 3; }
      else if (zoom >= 15.0) { step = 0.002; label = '200 M'; decimals = 3; }
      else if (zoom >= 13.5) { step = 0.005; label = '500 M'; decimals = 3; }
      else if (zoom >= 12.0) { step = 0.01; label = '1 KM'; decimals = 2; }
      else if (zoom >= 10.5) { step = 0.02; label = '2 KM'; decimals = 2; }
      else if (zoom >= 9.0) { step = 0.05; label = '5 KM'; decimals = 2; }
      else if (zoom >= 7.5) { step = 0.1; label = '10 KM'; decimals = 1; }
      else if (zoom >= 6.0) { step = 0.5; label = '50 KM'; decimals = 1; }
      else { step = 1.0; label = '100 KM'; decimals = 0; }

      // Check if GeoJSON geometry needs regeneration
      const west = bounds.getWest();
      const east = bounds.getEast();
      const south = Math.max(-85, bounds.getSouth());
      const north = Math.min(85, bounds.getNorth());

      const stepChanged = step !== lastStep;
      const outOfBounds =
        !lastBufferedBounds ||
        west < lastBufferedBounds.west ||
        east > lastBufferedBounds.east ||
        south < lastBufferedBounds.south ||
        north > lastBufferedBounds.north;

      const shouldUpdateGeoJSON = forceGeometry || stepChanged || outOfBounds;

      if (shouldUpdateGeoJSON) {
        lastStep = step;
        setGridIntervalText(label);
        try {
          const mgrsStr = getMGRS(center.lat, center.lng);
          setGridZoneText(mgrsStr ? mgrsStr.substring(0, 7) : 'MGRS WGS84');
        } catch {
          setGridZoneText('MGRS WGS84');
        }

        // Buffer 2 steps around bounds for seamless panning without GeoJSON rebuilds
        let bufWest = west - step * 2;
        let bufEast = east + step * 2;
        let bufSouth = Math.max(-85, south - step * 2);
        let bufNorth = Math.min(85, north + step * 2);

        // Cap to 35 lines per axis centered on viewport to prevent distant 3D horizon clutter
        const maxLines = 35;
        if ((bufEast - bufWest) / step > maxLines) {
          const halfSpan = (maxLines * step) / 2;
          bufWest = center.lng - halfSpan;
          bufEast = center.lng + halfSpan;
        }
        if ((bufNorth - bufSouth) / step > maxLines) {
          const halfSpan = (maxLines * step) / 2;
          bufSouth = Math.max(-85, center.lat - halfSpan);
          bufNorth = Math.min(85, center.lat + halfSpan);
        }

        lastBufferedBounds = { west: bufWest, east: bufEast, south: bufSouth, north: bufNorth };

        const startLng = Math.floor(bufWest / step) * step;
        const startLat = Math.floor(bufSouth / step) * step;

        const features: any[] = [];

        // Vertical lines
        for (let lng = startLng; lng <= bufEast + step; lng += step) {
          features.push({
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [[lng, bufSouth], [lng, bufNorth]],
            },
            properties: {},
          });
        }

        // Horizontal lines
        for (let latVal = startLat; latVal <= bufNorth + step; latVal += step) {
          features.push({
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [[bufWest, latVal], [bufEast, latVal]],
            },
            properties: {},
          });
        }

        // Crosshairs at line intersections in visible viewport
        const crossHalf = step * 0.08;
        for (let lng = Math.floor(west / step) * step; lng <= east + step; lng += step) {
          for (let latVal = Math.floor(south / step) * step; latVal <= north + step; latVal += step) {
            features.push({
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: [[lng - crossHalf, latVal], [lng + crossHalf, latVal]],
              },
              properties: { isCross: true },
            });
            features.push({
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: [[lng, latVal - crossHalf], [lng, latVal + crossHalf]],
              },
              properties: { isCross: true },
            });
          }
        }

        const geojson: any = { type: 'FeatureCollection', features };
        const existingSource = map.getSource(sourceId) as GeoJSONSource;
        if (existingSource) {
          existingSource.setData(geojson);
        } else {
          map.addSource(sourceId, { type: 'geojson', data: geojson });
          map.addLayer({
            id: haloLayerId,
            type: 'line',
            source: sourceId,
            layout: {
              visibility: isGridVisible ? 'visible' : 'none',
              'line-cap': 'round',
              'line-join': 'round',
            },
            paint: {
              'line-color': '#000000',
              'line-width': 2.8,
              'line-opacity': 0.9,
            },
          });
          map.addLayer({
            id: lineLayerId,
            type: 'line',
            source: sourceId,
            layout: {
              visibility: isGridVisible ? 'visible' : 'none',
              'line-cap': 'round',
              'line-join': 'round',
            },
            paint: {
              'line-color': isNightMode ? '#ef4444' : '#35D5D9',
              'line-width': 1.4,
              'line-opacity': 0.95,
            },
          });
        }
      }

      // Marginalia screen ticks (perspective-accurate in 2D and 3D)
      const container = map.getContainer();
      const width = container.clientWidth || 360;
      const height = container.clientHeight || 740;
      const newEastings: Array<{ x: number; label: string }> = [];
      const newNorthings: Array<{ y: number; label: string }> = [];

      // Calculate perspective ground anchors for bottom and right borders
      const bottomGround = map.unproject([width / 2, height - 70]);
      const rightGround = map.unproject([width - 40, height / 2]);

      const tickStartLng = Math.floor(west / step) * step;
      const tickStartLat = Math.floor(south / step) * step;

      for (let lng = tickStartLng; lng <= east + step; lng += step) {
        // In 3D tilt, vertical lines slant inward; project where they hit bottom of screen
        const p = map.project([lng, bottomGround.lat]);
        if (p.x >= 25 && p.x <= width - 50) {
          let tickLabel = '';
          if (coordFormat === 'DMS') {
            tickLabel = formatDMS(lng, false);
          } else if (coordFormat === 'DECIMAL') {
            tickLabel = `${Math.abs(lng).toFixed(decimals + 2)}° ${lng >= 0 ? 'E' : 'W'}`;
          } else {
            // MGRS mode
            let mgrsPart = '';
            try {
              const m = getMGRSShort(center.lat, lng, 6);
              if (m && m !== 'GRID UNKNOWN') {
                const parts = m.split(' ');
                mgrsPart = parts.slice(1).join(' ');
              }
            } catch {}
            const degStr = `${Math.abs(lng).toFixed(decimals)}°${lng >= 0 ? 'E' : 'W'}`;
            tickLabel = mgrsPart ? `${mgrsPart} • ${degStr}` : degStr;
          }
          newEastings.push({ x: Math.round(p.x), label: tickLabel });
        }
      }

      for (let latVal = tickStartLat; latVal <= north + step; latVal += step) {
        // In 3D tilt, horizontal lines slant perspective; project where they hit right of screen
        const p = map.project([rightGround.lng, latVal]);
        if (p.y >= 70 && p.y <= height - 90) {
          let tickLabel = '';
          if (coordFormat === 'DMS') {
            tickLabel = formatDMS(latVal, true);
          } else if (coordFormat === 'DECIMAL') {
            tickLabel = `${Math.abs(latVal).toFixed(decimals + 2)}° ${latVal >= 0 ? 'N' : 'S'}`;
          } else {
            // MGRS mode
            let mgrsPart = '';
            try {
              const m = getMGRSShort(latVal, center.lng, 6);
              if (m && m !== 'GRID UNKNOWN') {
                const parts = m.split(' ');
                mgrsPart = parts.slice(1).join(' ');
              }
            } catch {}
            const degStr = `${Math.abs(latVal).toFixed(decimals)}°${latVal >= 0 ? 'N' : 'S'}`;
            tickLabel = mgrsPart ? `${mgrsPart} • ${degStr}` : degStr;
          }
          newNorthings.push({ y: Math.round(p.y), label: tickLabel });
        }
      }

      setEastingTicks(newEastings.slice(0, 8));
      setNorthingTicks(newNorthings.slice(0, 8));

      if (map.getLayer(haloLayerId)) map.setLayoutProperty(haloLayerId, 'visibility', isGridVisible ? 'visible' : 'none');
      if (map.getLayer(lineLayerId)) {
        map.setLayoutProperty(lineLayerId, 'visibility', isGridVisible ? 'visible' : 'none');
        map.setPaintProperty(lineLayerId, 'line-color', isNightMode ? '#ef4444' : '#35D5D9');
      }
    };

    const onMove = () => {
      // Instant direct DOM reticle update without triggering React diffing
      if (reticleMgrsElRef.current) {
        const center = map.getCenter();
        reticleMgrsElRef.current.textContent = formatCoordinateShort(center.lat, center.lng, coordFormat);
      }
    };

    const onMoveEnd = () => {
      updateGrid(false);
    };

    const onZoomEnd = () => {
      updateGrid(true);
    };

    runWhenStyleReady(map, () => updateGrid(true));

    // Always listen to move so reticle coordinates stay synced in both 2D and 3D
    map.on('move', onMove);
    onMove();

    if (isGridVisible) {
      map.on('moveend', onMoveEnd);
      map.on('zoomend', onZoomEnd);
      map.on('pitchend', onMoveEnd);
    }

    return () => {
      map.off('move', onMove);
      map.off('moveend', onMoveEnd);
      map.off('zoomend', onZoomEnd);
      map.off('pitchend', onMoveEnd);
    };
  }, [isGridVisible, isNightMode, coordFormat]);

  const handleZoomIn = () => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.easeTo({ zoom: Math.min(22, mapInstanceRef.current.getZoom() + 1), duration: 300 });
    }
  };

  const handleZoomOut = () => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.easeTo({ zoom: Math.max(2.5, mapInstanceRef.current.getZoom() - 1), duration: 300 });
    }
  };

  const handleCenterUser = () => {
    const map = mapInstanceRef.current;
    const state = useTacticalStore.getState();
    const targetLat = state.lat;
    const targetLon = state.lon;

    if (map && (targetLat !== 0 || targetLon !== 0)) {
      // 1. Instantly smooth-fly camera to live beacon
      map.flyTo({
        center: [targetLon, targetLat],
        zoom: Math.max(map.getZoom(), 17.5),
        duration: 800,
        essential: true,
      });

      // 2. Trigger quick radar burst pulse without breaking infinite beacon breathing
      triggerRecenterPulse();

      // 3. Instant tactical HUD feedback toast
      showRecenterToast(`RECENTERED: ${state.callsign} • ${formatCoordinateShort(targetLat, targetLon, coordFormat)}`, 2500);
    } else {
      showRecenterToast('ACQUIRING GPS SATELLITES...', 2500);
    }

    // 4. Concurrently request fresh high-accuracy satellite reading and broadcast
    FieldlinkLocationService.getCurrentPosition()
      .then((pos) => {
        if (pos.latitude !== 0 || pos.longitude !== 0) {
          useTacticalStore.getState().updatePosition(pos);
          FieldlinkMeshService.broadcastPosition(
            state.callsign,
            pos.latitude,
            pos.longitude,
            pos.altitude ?? state.altitudeM,
            state.compassHeading,
            pos.speed ?? state.speedKmh,
            state.activeSOS ? 'SOS' : 'CONNECTED',
            state.isLeader,
            state.clusterLeaderCallsign,
            pos.accuracy ?? state.accuracyM
          ).catch(() => {});
        }
      })
      .catch(() => {});
  };

  // Live Tactical Drawing Telemetry Calculations
  let totalDrawDistKm = 0;
  for (let i = 0; i < drawingPoints.length - 1; i++) {
    totalDrawDistKm += calculateDistanceKm(
      drawingPoints[i].lat,
      drawingPoints[i].lon,
      drawingPoints[i + 1].lat,
      drawingPoints[i + 1].lon
    );
  }

  let lastLegBearing: number | null = null;
  if (drawingPoints.length >= 2) {
    const pPrev = drawingPoints[drawingPoints.length - 2];
    const pLast = drawingPoints[drawingPoints.length - 1];
    lastLegBearing = calculateBearing(pPrev.lat, pPrev.lon, pLast.lat, pLast.lon);
  } else if (drawingPoints.length === 1 && hasGpsFix) {
    lastLegBearing = calculateBearing(lat, lon, drawingPoints[0].lat, drawingPoints[0].lon);
  }

  return (
    <div className="relative w-full h-full overflow-hidden select-none" style={{ touchAction: 'none', overscrollBehavior: 'none' }}>
      {/* MapLibre DOM Container with Google Maps Raster Tiles & Offline Dark Canvas */}
      <div
        ref={mapContainerRef}
        className="w-full h-full bg-[#0d131a]"
        style={{ touchAction: 'none', overscrollBehavior: 'none' }}
      />

      {/* Recenter / GPS Fix HUD Notification Toast */}
      {recenterToast && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-50 pointer-events-none animate-fadeIn">
          <div className="px-3.5 py-1.5 rounded-full bg-[#070b09]/95 border border-emerald-400 text-emerald-300 text-[10px] font-mono-tactical font-black tracking-wider uppercase shadow-[0_0_16px_rgba(16,185,129,0.4)] flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span>{recenterToast}</span>
          </div>
        </div>
      )}

      {/* Night Vision / Red IR Filter Overlay */}
      {isNightMode && (
        <div className="absolute inset-0 bg-red-950/45 mix-blend-color-burn pointer-events-none z-10" />
      )}

      {/* Dynamic Tactical MGRS Coordinate Grid Info & Marginalia Badges */}
      {isGridVisible && (
        <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden select-none">
          {/* Top Coordinate System Status Bar (Clickable to switch format) */}
          <div
            onClick={() => {
              const next = coordFormat === 'MGRS' ? 'DMS' : coordFormat === 'DMS' ? 'DECIMAL' : 'MGRS';
              useTacticalStore.getState().setCoordFormat(next);
            }}
            className="pointer-events-auto cursor-pointer active:scale-95 transition-transform absolute top-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#070b09]/90 border border-[#35D5D9]/70 backdrop-blur-md shadow-[0_0_12px_rgba(53,213,217,0.2)] text-[10px] font-mono-tactical text-[#35D5D9] tracking-wider font-bold"
            title="Tap to toggle coordinate system (MGRS ⇄ DMS ⇄ DECIMAL)"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#35D5D9] animate-pulse" />
            {coordFormat === 'MGRS' ? (
              <>
                <span>GRID: {gridIntervalText}</span>
                <span className="text-slate-500">•</span>
                <span>ZONE: {gridZoneText}</span>
                <span className="text-slate-500">•</span>
                <span className="text-slate-300">MGRS</span>
              </>
            ) : coordFormat === 'DMS' ? (
              <>
                <span>SYS: DMS</span>
                <span className="text-slate-500">•</span>
                <span>STEP: {gridIntervalText}</span>
                <span className="text-slate-500">•</span>
                <span className="text-slate-300">WGS84</span>
              </>
            ) : (
              <>
                <span>SYS: DECIMAL</span>
                <span className="text-slate-500">•</span>
                <span>STEP: {gridIntervalText}</span>
                <span className="text-slate-500">•</span>
                <span className="text-slate-300">WGS84</span>
              </>
            )}
            <span className="text-[8px] px-1 py-0.2 rounded bg-[#0b2826] border border-cyan-500/40 text-cyan-200 ml-1">⇄</span>
          </div>

          {/* Easting (Longitude) Marginalia Badges along bottom */}
          {eastingTicks.map((tick, idx) => (
            <div
              key={`e-${idx}`}
              className="absolute bottom-24 -translate-x-1/2 px-1 py-0.2 rounded bg-black/85 border border-[#35D5D9]/60 text-[8.5px] font-mono-tactical text-[#35D5D9] shadow-md tracking-tighter"
              style={{ left: `${tick.x}px` }}
            >
              {tick.label}
            </div>
          ))}

          {/* Northing (Latitude) Marginalia Badges along right */}
          {northingTicks.map((tick, idx) => (
            <div
              key={`n-${idx}`}
              className="absolute right-12 -translate-y-1/2 px-1 py-0.2 rounded bg-black/85 border border-[#35D5D9]/60 text-[8.5px] font-mono-tactical text-[#35D5D9] shadow-md tracking-tighter"
              style={{ top: `${tick.y}px` }}
            >
              {tick.label}
            </div>
          ))}
        </div>
      )}

      {/* Central Tactical Red Reticle Crosshairs (2D & 3D Adaptive) */}
      <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-10">
        {/* Reticle Target Designator (Tilts smoothly in 3D perspective) */}
        <div
          ref={reticleRef}
          className="relative w-14 h-14 flex items-center justify-center transition-transform duration-75 ease-out"
          style={{ transformStyle: 'preserve-3d' }}
        >
          {/* 3D Ground Targeting Footprint Ring (projects as an ellipse in 3D perspective) */}
          <div className="absolute w-12 h-12 rounded-full border border-dashed border-red-500/40 shadow-[0_0_8px_rgba(239,68,68,0.25)] pointer-events-none" />

          {/* 4 Precision Corner Brackets */}
          <div className="absolute top-1 left-1 w-2.5 h-2.5 border-t-2 border-l-2 border-red-500/80" />
          <div className="absolute top-1 right-1 w-2.5 h-2.5 border-t-2 border-r-2 border-red-500/80" />
          <div className="absolute bottom-1 left-1 w-2.5 h-2.5 border-b-2 border-l-2 border-red-500/80" />
          <div className="absolute bottom-1 right-1 w-2.5 h-2.5 border-b-2 border-r-2 border-red-500/80" />

          {/* Crosshair Horizontal Bars */}
          <div className="absolute -left-1 w-4 h-[2px] bg-red-500 shadow-[0_0_6px_#ef4444]" />
          <div className="absolute -right-1 w-4 h-[2px] bg-red-500 shadow-[0_0_6px_#ef4444]" />

          {/* Crosshair Vertical Bars */}
          <div className="absolute -top-1 h-4 w-[2px] bg-red-500 shadow-[0_0_6px_#ef4444]" />
          <div className="absolute -bottom-1 h-4 w-[2px] bg-red-500 shadow-[0_0_6px_#ef4444]" />

          {/* Center Precision Laser Aperture */}
          <div className="w-3 h-3 rounded-full border border-red-400 bg-red-500/20 flex items-center justify-center shadow-[0_0_6px_rgba(239,68,68,0.6)]">
            <div className="w-1 h-1 rounded-full bg-red-400 shadow-[0_0_4px_#ff2222]" />
          </div>

          {/* 3D Depth Plumb Line (Emerges when tilted in 3D) */}
          <div
            ref={reticlePlumbRef}
            className="absolute top-7 left-1/2 -translate-x-1/2 w-[1px] h-5 bg-gradient-to-b from-red-500 to-transparent pointer-events-none opacity-0 transition-opacity"
          />
        </div>

        {/* Live Tactical Ground Coordinates (Always legible, placed beneath reticle) */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 translate-y-9 whitespace-nowrap px-2 py-0.5 rounded bg-black/90 border border-red-500/70 text-[8.5px] font-mono-tactical text-red-200 font-bold shadow-xl tracking-wider flex items-center gap-1.5 backdrop-blur-sm pointer-events-none">
          <span
            ref={reticlePitchElRef}
            className="hidden px-1 py-0.2 rounded bg-red-950 text-cyan-300 border border-red-500/60 text-[7.5px] font-extrabold tracking-normal"
          >
            3D
          </span>
          <div ref={reticleMgrsElRef}>--</div>
        </div>
      </div>

      {/* Stacked Top-Left Operational Overlays (Zero Overlap Layout) */}
      <div className="absolute top-2 left-14 right-[118px] sm:right-auto sm:w-80 z-20 flex flex-col gap-1.5 pointer-events-none select-none">
        {/* Interactive Tactical Drawing & Range HUD */}
        {isDrawingActive && (
          <div className="pointer-events-auto shadow-2xl">
            <div className="p-2 rounded bg-[#0a0f0c]/95 border border-[#35D5D9]/80 backdrop-blur-md font-mono-tactical text-xs text-white space-y-1.5">
              <div className="flex items-center justify-between border-b border-[#1b251e] pb-1">
                <div className="flex items-center gap-1.5 text-[#35D5D9] font-bold text-[11px]">
                  <Pencil className="w-3.5 h-3.5 text-[#35D5D9] animate-pulse" />
                  <span>TACTICAL DRAW & MEASURE</span>
                </div>
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#102923] text-emerald-400 font-bold border border-emerald-800">
                  ARMED
                </span>
              </div>

              <div className="grid grid-cols-2 gap-1 text-[10px]">
                <div>
                  <span className="text-slate-400">VERTICES: </span>
                  <span className="font-bold text-white">{drawingPoints.length}</span>
                </div>
                <div className="text-right">
                  <span className="text-slate-400">RANGE: </span>
                  <span className="font-bold text-[#D1A34A]">
                    {distanceUnit === 'KM'
                      ? totalDrawDistKm < 1 ? `${Math.round(totalDrawDistKm * 1000)} M` : `${totalDrawDistKm.toFixed(2)} KM`
                      : `${(totalDrawDistKm * 0.621371).toFixed(2)} MI`}
                  </span>
                </div>
                {lastLegBearing !== null && (
                  <div className="col-span-2 text-slate-300 text-[9px] truncate">
                    <span className="text-slate-400">BEARING: </span>
                    <span className="font-bold text-cyan-300">{lastLegBearing.toFixed(1)}°</span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1 pt-1 border-t border-[#1b251e]">
                <button
                  onClick={undoDrawingPoint}
                  disabled={drawingPoints.length === 0}
                  className="flex-1 py-1 px-1 rounded bg-[#121c15] border border-[#2b3a2d] hover:bg-[#1a291f] disabled:opacity-30 text-[8.5px] font-bold flex items-center justify-center gap-0.5"
                  title="Undo Last Vertex"
                >
                  <Undo className="w-3 h-3" />
                  <span>UNDO</span>
                </button>
                <button
                  onClick={clearDrawing}
                  disabled={drawingPoints.length === 0}
                  className="flex-1 py-1 px-1 rounded bg-red-950/60 border border-red-800 hover:bg-red-900/60 disabled:opacity-30 text-red-300 text-[8.5px] font-bold flex items-center justify-center gap-0.5"
                  title="Clear All Drawing Points"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>CLEAR</span>
                </button>

                {/* Instant Drop Waypoint Button for currently selected / tapped points */}
                {drawingPoints.length > 0 && (
                  <button
                    onClick={() => {
                      const lastPt = drawingPoints[drawingPoints.length - 1];
                      const store = useTacticalStore.getState();
                      const nextNum = store.waypoints.length + 1;
                      const wpId = `wp-${callsign}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
                      const newWp = {
                        id: wpId,
                        name: `WP-${nextNum}`,
                        category: 'RP' as const,
                        lat: lastPt.lat,
                        lon: lastPt.lon,
                        description: `Marked via map drawing by ${callsign}`,
                        createdBy: callsign,
                      };
                      addWaypoint(newWp);
                      FieldlinkMeshService.broadcastWaypoint(newWp);
                      undoDrawingPoint();
                      showRecenterToast(`WAYPOINT ${newWp.name} BROADCAST TO SQUAD MESH`, 3000);
                    }}
                    className="flex-1 py-1 px-1 rounded bg-[#1b3d24] border border-[#2b5a35] hover:bg-[#254f30] text-[#9DBB72] text-[8.5px] font-bold flex items-center justify-center gap-0.5"
                    title="Drop Tactical Waypoint at Current Selected Vertex"
                  >
                    <MapPin className="w-3 h-3" />
                    <span>+ WP</span>
                  </button>
                )}

                <button
                  onClick={() => {
                    toggleDrawing();
                    if (drawingPoints.length === 1) {
                      const pt = drawingPoints[0];
                      const store = useTacticalStore.getState();
                      const nextNum = store.waypoints.length + 1;
                      const wpId = `wp-${callsign}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
                      const newWp = {
                        id: wpId,
                        name: `WP-${nextNum}`,
                        category: 'RP' as const,
                        lat: pt.lat,
                        lon: pt.lon,
                        description: `Marked on map by ${callsign}`,
                        createdBy: callsign,
                      };
                      addWaypoint(newWp);
                      FieldlinkMeshService.broadcastWaypoint(newWp);
                      clearDrawing();
                      showRecenterToast(`WAYPOINT ${newWp.name} BROADCAST TO SQUAD MESH`, 3000);
                    } else if (drawingPoints.length >= 2) {
                      const myCol = getCallsignColor(callsign);
                      const drawId = `draw-${callsign}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
                      const newDraw = {
                        id: drawId,
                        createdBy: callsign,
                        points: [...drawingPoints],
                        color: myCol.hex,
                        createdAt: Date.now(),
                      };
                      addDrawing(newDraw);
                      FieldlinkMeshService.broadcastDrawing(newDraw);
                      clearDrawing();
                      showRecenterToast('TACTICAL ROUTE BROADCAST TO SQUAD MESH', 3000);
                    }
                  }}
                  disabled={drawingPoints.length === 0}
                  className="flex-1 py-1 px-1 rounded bg-[#0c404a] border border-[#166c7d] hover:bg-[#125866] disabled:opacity-30 text-[#35D5D9] text-[8.5px] font-bold flex items-center justify-center gap-0.5"
                  title="Finish Drawing and Transmit to Squad Mesh"
                >
                  <Check className="w-3 h-3" />
                  <span>DONE</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Shared Cluster Tactical Drawings & Routes Badge List */}
        {drawings.length > 0 && (
          <div className="pointer-events-auto flex flex-col gap-1 max-w-[280px]">
            {drawings.map((d) => {
              let distKm = 0;
              for (let i = 0; i < d.points.length - 1; i++) {
                distKm += calculateDistanceKm(d.points[i].lat, d.points[i].lon, d.points[i + 1].lat, d.points[i + 1].lon);
              }
              const distText = distKm < 1 ? `${Math.round(distKm * 1000)} M` : `${distKm.toFixed(2)} KM`;
              const canDelete = isLeader || d.createdBy === callsign;
              const userCol = getCallsignColor(d.createdBy);

              return (
                <div
                  key={d.id}
                  className="px-2 py-0.5 rounded bg-black/95 font-mono-tactical text-[9px] font-bold flex items-center justify-between gap-2 shadow-md backdrop-blur-sm"
                  style={{ border: `1px solid ${userCol.borderHex}`, color: userCol.hex }}
                >
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: userCol.hex }} />
                    <span className="truncate">ROUTE by {d.createdBy === callsign ? 'YOU' : d.createdBy}: {distText}</span>
                  </div>
                  {canDelete && (
                    <button
                      onClick={() => {
                        removeDrawing(d.id);
                        FieldlinkMeshService.broadcastDeleteDrawing(d.id);
                      }}
                      className="text-slate-400 hover:text-red-400 font-bold px-1"
                      title={isLeader ? 'Leader Delete (Purges from cluster)' : 'Delete Route'}
                    >
                      ✕
                    </button>
                  )}
                </div>
              );
            })}

            {isLeader && (
              <button
                onClick={() => {
                  clearAllDrawings();
                  FieldlinkMeshService.broadcastClearAllDrawings();
                }}
                className="px-2 py-0.5 rounded bg-red-950/90 border border-red-500 text-red-300 font-mono-tactical text-[8px] font-black flex items-center gap-1 shadow-lg hover:bg-red-900/90 tracking-wider uppercase"
                title="Leader Authority: Purge all drawings across all cluster devices"
              >
                <Shield className="w-2.5 h-2.5 text-amber-400" />
                <span>PURGE ALL CLUSTER DRAWINGS</span>
              </button>
            )}
          </div>
        )}

        {/* Waypoint & Squad Telemetry Status Counters */}
        {(waypoints.length > 0 || squadMembers.length > 0) && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {waypoints.length > 0 && (
              <span className="px-2 py-0.5 rounded bg-[#101712]/90 border border-[#233125] text-[#9DBB72] font-mono-tactical text-[9px] font-bold">
                POI MARKERS: {waypoints.length}
              </span>
            )}
            {squadMembers.length > 0 && (
              <span className="px-2 py-0.5 rounded bg-[#090d16]/90 border border-[#35D5D9] text-[#35D5D9] font-mono-tactical text-[9px] font-bold">
                SQUAD PEERS: {squadMembers.length}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Real Target Selection Marker Banner with + MARK SIGN action */}
      {selectedTarget && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 pointer-events-auto">
          <div className="px-3 py-1 rounded bg-[#090d16]/95 border border-[#35D5D9] text-[#35D5D9] font-mono-tactical text-[10px] font-bold shadow-lg flex items-center gap-2 backdrop-blur-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-[#35D5D9] animate-pulse" />
            <span className="truncate max-w-[130px]">TARGET: {selectedTarget.name || `${selectedTarget.lat.toFixed(5)}, ${selectedTarget.lon.toFixed(5)}`}</span>
            {hasGpsFix && (
              <span className="text-[#D1A34A] font-bold">
                {(() => {
                  const dKm = calculateDistanceKm(lat, lon, selectedTarget.lat, selectedTarget.lon);
                  return distanceUnit === 'KM'
                    ? dKm < 1 ? `${Math.round(dKm * 1000)} M` : `${dKm.toFixed(2)} KM`
                    : `${(dKm * 0.621371).toFixed(2)} MI`;
                })()}
              </span>
            )}
            <button
              onClick={() => setActiveModal('waypoints')}
              className="px-1.5 py-0.5 rounded bg-[#102022] hover:bg-[#163033] border border-[#35D5D9]/60 text-cyan-200 text-[9px] font-bold tracking-wider"
              title="Save this location as a marked waypoint sign"
            >
              + MARK SIGN
            </button>
            <button
              onClick={() => setSelectedTarget(null)}
              className="text-slate-400 hover:text-red-400 text-xs font-bold"
              title="Clear Target"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Right Side Map Navigation Controls (+, -, Recenter) */}
      <div className="absolute right-3 bottom-24 flex flex-col gap-1.5 z-20 select-none shadow-2xl">
        <button
          onClick={handleZoomIn}
          className="w-8 h-8 rounded-none bg-[#121814]/90 border border-[#2b382d] text-white hover:text-emerald-400 flex items-center justify-center active:scale-95 transition-transform"
          title="Zoom In"
        >
          <Plus className="w-4 h-4 stroke-[2.5]" />
        </button>
        <button
          onClick={handleZoomOut}
          className="w-8 h-8 rounded-none bg-[#121814]/90 border border-[#2b382d] text-white hover:text-emerald-400 flex items-center justify-center active:scale-95 transition-transform"
          title="Zoom Out"
        >
          <Minus className="w-4 h-4 stroke-[2.5]" />
        </button>
        <button
          onClick={handleToggleTilt}
          className={`w-8 h-8 rounded-none bg-[#121814]/90 border border-[#2b382d] flex items-center justify-center active:scale-95 transition-transform font-mono-tactical text-[10px] font-black ${
            isTilted ? 'text-[#35D5D9] border-[#35D5D9] shadow-[0_0_8px_rgba(53,213,217,0.3)]' : 'text-slate-300 hover:text-white'
          }`}
          title={isTilted ? 'Switch to 2D Top-Down View' : 'Switch to 3D Perspective Tilt (Google Maps View)'}
        >
          {isTilted ? '2D' : '3D'}
        </button>
        <button
          onClick={handleCenterUser}
          className={`w-8 h-8 rounded-none bg-[#121814]/90 border border-[#2b382d] flex items-center justify-center active:scale-90 transition-all ${
            hasGpsFix
              ? 'text-emerald-400 border-emerald-500/50 hover:bg-emerald-950/40 shadow-[0_0_8px_rgba(16,185,129,0.3)]'
              : 'text-slate-500 hover:text-slate-300'
          }`}
          title="Center on Live Beacon (My Location)"
        >
          <LocateFixed className="w-4 h-4 stroke-[2.2]" />
        </button>
      </div>
    </div>
  );
};
