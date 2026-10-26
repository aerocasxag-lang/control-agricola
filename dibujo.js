// Dibujar el borde de un lote sobre el satélite o caminarlo con GPS.
// Se engancha al formulario de lote: entrega el borde como un KML al campo de archivo.
(function () {
  const AREA = pts => {
    if (pts.length < 3) return 0;
    const lat0 = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
    const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110574;
    let a = 0;
    for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.lng * kx * q.lat * ky - q.lng * kx * p.lat * ky; }
    return Math.abs(a) / 2 / 10000;
  };

  new MutationObserver(() => {
    const inp = document.getElementById("loBorde");
    if (inp && !document.getElementById("btnDibujar")) {
      const b = document.createElement("button");
      b.type = "button"; b.id = "btnDibujar"; b.className = "btn";
      b.textContent = "Dibujar el borde en el mapa o caminarlo con GPS";
      b.addEventListener("click", () => abrir(inp));
      inp.closest("label").after(b);
    }
  }).observe(document.body, { childList: true, subtree: true });

  function abrir(inp) {
    const ov = document.createElement("div");
    ov.style.cssText = "position:fixed;inset:0;z-index:2000;background:#13251B;display:flex;flex-direction:column";
    ov.innerHTML = `
      <div style="padding:calc(env(safe-area-inset-top) + 10px) 14px 10px;color:#F3EFE4;font-size:.92rem">
        <b style="font-family:var(--display);font-size:1.2rem">Borde del lote</b><br>
        Toca cada esquina del lote en el mapa, o párate en cada esquina y toca «Punto GPS». Arrastra un punto para corregirlo.
      </div>
      <div id="dbMapa" style="flex:1;min-height:0"></div>
      <div style="background:#F3EFE4;padding:10px 14px calc(10px + env(safe-area-inset-bottom));display:grid;gap:8px">
        <div id="dbInfo" style="font-weight:600;font-variant-numeric:tabular-nums">0 puntos</div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
          <button type="button" class="btn small" id="dbGps">Punto GPS</button>
          <button type="button" class="btn small" id="dbDeshacer">Deshacer</button>
          <button type="button" class="btn small" id="dbCancelar">Cancelar</button>
          <button type="button" class="btn small primary" id="dbListo">Listo</button>
        </div>
      </div>`;
    document.body.append(ov);
    const $ = id => ov.querySelector("#" + id);

    const mapa = L.map($("dbMapa"), { zoomControl: false }).setView([5.33, -72.39], 15);
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 21, maxNativeZoom: 18, attribution: "Imágenes © Esri" }).addTo(mapa);

    let pts = [], marcas = [], pol = null, gps = null, punto = null, centrado = false;
    const icono = L.divIcon({ className: "", html: '<div style="width:18px;height:18px;border-radius:50%;background:#E0A33A;border:3px solid #fff"></div>', iconSize: [18, 18] });

    const watch = navigator.geolocation ? navigator.geolocation.watchPosition(p => {
      gps = { lat: p.coords.latitude, lng: p.coords.longitude, prec: Math.round(p.coords.accuracy) };
      const ll = [gps.lat, gps.lng];
      if (!punto) punto = L.circleMarker(ll, { radius: 8, color: "#fff", weight: 3, fillColor: "#2F7BEF", fillOpacity: 1 }).addTo(mapa);
      else punto.setLatLng(ll);
      if (!centrado) { mapa.setView(ll, 18); centrado = true; }
      pintar();
    }, () => {}, { enableHighAccuracy: true, maximumAge: 5000 }) : null;

    function pintar() {
      if (pol) mapa.removeLayer(pol);
      pol = pts.length >= 3 ? L.polygon(pts, { color: "#3DDC84", weight: 3, fillOpacity: .15 }).addTo(mapa)
        : pts.length === 2 ? L.polyline(pts, { color: "#3DDC84", weight: 3 }).addTo(mapa) : null;
      const a = AREA(pts);
      $("dbInfo").textContent = `${pts.length} punto(s)` + (pts.length >= 3 ? ` · ${a.toLocaleString("es-CO", { maximumFractionDigits: 2 })} ha` : "")
        + (gps ? ` · GPS ±${gps.prec} m` : " · esperando GPS");
    }
    function agregar(ll) {
      const i = pts.length; pts.push({ lat: ll.lat, lng: ll.lng });
      const m = L.marker(ll, { icon: icono, draggable: true }).addTo(mapa);
      m.on("drag", e => { pts[marcas.indexOf(m)] = { lat: e.latlng.lat, lng: e.latlng.lng }; pintar(); });
      marcas.push(m); pintar(); return i;
    }
    mapa.on("click", e => agregar(e.latlng));
    // Punto GPS: promedia las lecturas de 8 segundos para mejorar la precisión.
    let promediando = false;
    $("dbGps").onclick = () => {
      if (promediando) return;
      if (!gps) { $("dbInfo").textContent = "Todavía no hay señal GPS. Activa la ubicación y espera unos segundos."; return; }
      promediando = true; const lecturas = []; const t0 = Date.now(); const btn = $("dbGps");
      const tick = setInterval(() => {
        if (gps) lecturas.push({ ...gps });
        const s = 8 - Math.floor((Date.now() - t0) / 1000);
        btn.textContent = s > 0 ? `Quieto… ${s}` : "Punto GPS";
        if (s <= 0) {
          clearInterval(tick); promediando = false;
          const buenas = lecturas.filter(l => l.prec <= Math.max(10, Math.min(...lecturas.map(x => x.prec)) * 1.5));
          const usa = buenas.length ? buenas : lecturas;
          const w = usa.map(l => 1 / Math.max(1, l.prec) ** 2), sw = w.reduce((a, b) => a + b, 0);
          const lat = usa.reduce((a, l, i) => a + l.lat * w[i], 0) / sw, lng = usa.reduce((a, l, i) => a + l.lng * w[i], 0) / sw;
          const prec = Math.round(Math.min(...usa.map(l => l.prec)));
          agregar(L.latLng(lat, lng)); mapa.panTo([lat, lng]);
          $("dbInfo").textContent += ` · último punto ±${prec} m (${usa.length} lecturas)`;
          if (prec > 15) $("dbInfo").textContent += " · precisión baja, espera más cielo abierto";
        }
      }, 1000);
    };
    $("dbDeshacer").onclick = () => { if (!pts.length) return; pts.pop(); mapa.removeLayer(marcas.pop()); pintar(); };
    const cerrar = () => { if (watch != null) navigator.geolocation.clearWatch(watch); mapa.remove(); ov.remove(); };
    $("dbCancelar").onclick = cerrar;
    $("dbListo").onclick = () => {
      if (pts.length < 3) { $("dbInfo").textContent = "Necesitas al menos 3 puntos."; return; }
      const coords = [...pts, pts[0]].map(p => `${p.lng.toFixed(7)},${p.lat.toFixed(7)},0`).join(" ");
      const kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>`;
      const dt = new DataTransfer();
      dt.items.add(new File([kml], "borde-dibujado.kml", { type: "application/vnd.google-earth.kml+xml" }));
      inp.files = dt.files;
      inp.dispatchEvent(new Event("change", { bubbles: true }));
      cerrar();
    };
    setTimeout(() => mapa.invalidateSize(), 50);
    pintar();
  }
})();
