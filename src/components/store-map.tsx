"use client";
import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Store } from "@/lib/types";
export default function StoreMap({ stores }: { stores: Store[] }) {
  const container = useRef<HTMLDivElement>(null),
    [error, setError] = useState(false);
  useEffect(() => {
    if (!container.current) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: container.current,
        style:
          process.env.NEXT_PUBLIC_MAP_STYLE_URL ||
          "https://tiles.openfreemap.org/styles/liberty",
        center: [-79.394, 43.651],
        zoom: 13,
        attributionControl: {},
      });
      map.addControl(
        new maplibregl.NavigationControl({ showCompass: false }),
        "top-right",
      );
      map.on("error", () => setError(true));
      const markers: maplibregl.Marker[] = [];
      stores
        .filter((s) => s.latitude != null && s.longitude != null)
        .forEach((store) => {
          const el = document.createElement("button");
          el.className = "map-pin";
          el.type = "button";
          el.textContent = "●";
          el.setAttribute("aria-label", store.name);
          const popupNode = document.createElement("div");
          const title = document.createElement("strong");
          title.textContent = store.name;
          const address = document.createElement("p");
          address.textContent = store.address;
          popupNode.append(title, address);
          const marker = new maplibregl.Marker({ element: el })
            .setLngLat([store.longitude!, store.latitude!])
            .setPopup(
              new maplibregl.Popup({ offset: 18 }).setDOMContent(popupNode),
            )
            .addTo(map);
          markers.push(marker);
        });
      if (markers.length > 1) {
        const bounds = new maplibregl.LngLatBounds();
        stores.forEach((s) => {
          if (s.latitude != null && s.longitude != null)
            bounds.extend([s.longitude, s.latitude]);
        });
        map.fitBounds(bounds, { padding: 60, maxZoom: 14 });
      }
      return () => {
        markers.forEach((m) => m.remove());
        map.remove();
      };
    } catch {
      setError(true);
    }
  }, [stores]);
  return (
    <div>
      <div
        ref={container}
        className="store-map"
        aria-label="Price results map"
      />
      {error && (
        <p className="small muted">
          The map couldn’t load fully. Store addresses are available in the
          results.
        </p>
      )}
      <p className="small muted">
        {stores.filter((s) => s.latitude != null && s.longitude != null).length}{" "}
        known branches shown. Prices with an unknown branch stay in the list.
      </p>
    </div>
  );
}
