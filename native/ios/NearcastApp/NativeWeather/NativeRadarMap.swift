import SwiftUI
import MapLibre

/// Only already-authorized tile templates enter this renderer. Configuration and
/// credentials are never included in its diagnostics or accessibility labels.
struct NativeRadarTileLayer {
    let id: String
    let templates: [String]
    let minimumZoom: Int
    let maximumZoom: Int
    let credits: [(String, URL)]
}

struct NativeRadarImage {
    let id: String
    let image: UIImage
    let west: Double
    let south: Double
    let east: Double
    let north: Double
    var quad: MLNCoordinateQuad {
        MLNCoordinateQuad(topLeft: .init(latitude: north, longitude: west),
            bottomLeft: .init(latitude: south, longitude: west),
            bottomRight: .init(latitude: south, longitude: east),
            topRight: .init(latitude: north, longitude: east))
    }
}

struct NativeRadarViewport: Equatable, Sendable {
    let west: Double, south: Double, east: Double, north: Double
    var isUsable: Bool {
        (try? NativeRadarPresentationContract.Viewport(west: west, south: south, east: east, north: north)) != nil
    }
}

/// A fixed, full-screen map canvas. Controls float over it rather than changing
/// its size (and therefore its camera) when the timeline's content changes.
struct NativeRadarMap: UIViewRepresentable {
    let place: NativePreviewPlace
    let savedPlaces: [NativePreviewPlace]
    /// Camera-only focus, including a freshly authorized device fix. This never
    /// selects or saves a place in the app's authoritative places store.
    let focusPlace: NativePreviewPlace?
    let focusRevision: Int
    let base: NativeRadarTileLayer?
    let labels: NativeRadarTileLayer?
    let basemapRevision: Int
    let weatherRevision: Int
    let weather: RadarProofFrame?
    let weatherTiles: NativeRadarTileLayer?
    let image: NativeRadarImage?
    let recenter: Int
    let zoomCommand: Int
    let maximumZoom: Double
    let alerts: Data?
    let onAlert: (String) -> Void
    let onPlace: (NativePreviewPlace) -> Void
    let onViewport: (NativeRadarViewport) -> Void
    let onFailure: () -> Void
    let onTileActivity: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> MLNMapView {
        let map = MLNMapView(frame: .zero, styleJSON:
            ##"{"version":8,"sources":{},"layers":[{"id":"background","type":"background","paint":{"background-color":"#263743"}}]}"##)
        map.delegate = context.coordinator
        map.showsUserLocation = false
        map.isPitchEnabled = false
        map.isRotateEnabled = false
        map.isScrollEnabled = true
        map.isZoomEnabled = true
        map.minimumZoomLevel = 4
        map.maximumZoomLevel = maximumZoom
        // Credits are visible in the SwiftUI footer and linked in Info. SDK
        // ornaments would sit under the floating controls and be untappable.
        map.showsLogoView = false
        map.showsAttributionButton = false
        map.accessibilityLabel = "Weather map for \(place.name). Drag to pan; pinch or use the zoom buttons."
        map.setCenter(.init(latitude: place.latitude, longitude: place.longitude), zoomLevel: 6.8, animated: false)
        context.coordinator.installPlaces(on: map)
        let alertTap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.openAlert(_:)))
        alertTap.cancelsTouchesInView = false
        alertTap.delegate = context.coordinator
        for recognizer in map.gestureRecognizers ?? [] {
            if let doubleTap = recognizer as? UITapGestureRecognizer, doubleTap.numberOfTapsRequired == 2 {
                alertTap.require(toFail: doubleTap)
            }
        }
        map.addGestureRecognizer(alertTap)
        return map
    }

    func updateUIView(_ map: MLNMapView, context: Context) {
        let previous = context.coordinator.input
        context.coordinator.input = self
        map.maximumZoomLevel = maximumZoom
        if map.zoomLevel > maximumZoom { map.setZoomLevel(maximumZoom, animated: false) }
        if previous.place != place || previous.savedPlaces != savedPlaces || previous.focusPlace != focusPlace {
            context.coordinator.installPlaces(on: map)
        }
        if previous.focusRevision != focusRevision, let focus = focusPlace, focus.isValid {
            map.setCenter(.init(latitude: focus.latitude, longitude: focus.longitude),
                          zoomLevel: max(6.8, map.zoomLevel), animated: true)
        } else if previous.recenter != recenter || previous.place.coordinateIdentity != place.coordinateIdentity {
            map.setCenter(.init(latitude: place.latitude, longitude: place.longitude), zoomLevel: 6.8, animated: true)
        } else if previous.zoomCommand != zoomCommand {
            let delta = zoomCommand > previous.zoomCommand ? 0.8 : -0.8
            map.setZoomLevel(min(maximumZoom, max(4, map.zoomLevel + delta)), animated: true)
        }
        context.coordinator.applyLayers(to: map)
    }

    static func dismantleUIView(_ map: MLNMapView, coordinator: Coordinator) {
        coordinator.active = false
        map.delegate = nil
    }

    final class Coordinator: NSObject, MLNMapViewDelegate, UIGestureRecognizerDelegate {
        var input: NativeRadarMap
        var active = true
        private var ready = false
        private var baseRevision = -1
        private var weatherID: String?
        private var renderedTemplates: [String]?
        private var renderedWeatherRevision = -1
        private var markers: [MLNPointAnnotation] = []
        private var markerPlaces: [ObjectIdentifier: NativePreviewPlace] = [:]
        private var markerRoles: [ObjectIdentifier: String] = [:]
        private var renderedAlerts: Data?
        private var tileRequests = 0, tileParses = 0, tileErrors = 0
        init(_ input: NativeRadarMap) { self.input = input }

        func installPlaces(on map: MLNMapView) {
            let selectedCoordinate = (map.selectedAnnotations.first as? MLNPointAnnotation)
                .flatMap { markerPlaces[ObjectIdentifier($0)]?.coordinateIdentity }
            if !markers.isEmpty { map.removeAnnotations(markers) }
            markers.removeAll(keepingCapacity: true)
            markerPlaces.removeAll(keepingCapacity: true)
            markerRoles.removeAll(keepingCapacity: true)
            var seen = Set<String>()
            // The selected place wins a same-coordinate duplicate. A GPS focus
            // is only a transient additional marker, never a stored place.
            let candidates = [input.place] + Array(input.savedPlaces.prefix(60)) +
                (input.focusPlace.map { [$0] } ?? [])
            for place in candidates where place.isValid && seen.insert(place.coordinateIdentity).inserted {
                let point = MLNPointAnnotation()
                point.coordinate = .init(latitude: place.latitude, longitude: place.longitude)
                point.title = place.name
                let role = place.coordinateIdentity == input.place.coordinateIdentity ? "Selected place" :
                    (input.savedPlaces.contains(where: { $0.coordinateIdentity == place.coordinateIdentity }) ? "Saved place" : "Map location")
                point.subtitle = role
                markers.append(point)
                markerPlaces[ObjectIdentifier(point)] = place
                markerRoles[ObjectIdentifier(point)] = role
            }
            map.addAnnotations(markers)
            if let selectedCoordinate,
               let selected = markers.first(where: { markerPlaces[ObjectIdentifier($0)]?.coordinateIdentity == selectedCoordinate }) {
                map.selectAnnotation(selected, animated: false, completionHandler: nil)
            }
        }

        func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) {
            ready = true; baseRevision = -1; weatherID = nil
            applyLayers(to: mapView)
            reportViewport(mapView)
        }

        private func remove(_ id: String, from style: MLNStyle) {
            if let layer = style.layer(withIdentifier: id) { style.removeLayer(layer) }
            if let source = style.source(withIdentifier: id + "-source") { style.removeSource(source) }
        }

        private func add(_ descriptor: NativeRadarTileLayer, id: String, to style: MLNStyle) {
            let source = MLNRasterTileSource(identifier: id + "-source", tileURLTemplates: descriptor.templates,
                options: [.tileSize: 256, .minimumZoomLevel: descriptor.minimumZoom, .maximumZoomLevel: descriptor.maximumZoom,
                    .attributionInfos: descriptor.credits.map {
                        MLNAttributionInfo(title: NSAttributedString(string: $0.0), url: $0.1)
                    }])
            style.addSource(source)
            let layer = MLNRasterStyleLayer(identifier: id, source: source)
            layer.rasterFadeDuration = NSExpression(forConstantValue: 0)
            style.addLayer(layer)
        }

        func applyLayers(to map: MLNMapView) {
            // A tiny inline style can finish before the delegate is assigned in
            // makeUIView. MapLibre exposes a non-nil style only once loaded.
            guard let style = map.style else { return }
            if !ready { ready = true; baseRevision = -1; weatherID = nil }
            let nextID = input.image.map { "image:" + $0.id } ?? input.weatherTiles.map { "tiles:" + $0.id }
                ?? input.weather.map { "wms:" + $0.id } ?? "none"
            let basemapChanged = baseRevision != input.basemapRevision
            let templates = input.weatherTiles?.templates
            guard basemapChanged || weatherID != nextID || renderedTemplates != templates
                || renderedWeatherRevision != input.weatherRevision else { applyAlerts(to: style); return }
            removeAlerts(from: style)
            // Never leave an old time under a new timestamp while loading.
            remove("native-weather", from: style)
            if basemapChanged {
                remove("native-labels", from: style)
                remove("native-base", from: style)
                if let base = input.base { add(base, id: "native-base", to: style) }
                if let labels = input.labels { add(labels, id: "native-labels", to: style) }
                baseRevision = input.basemapRevision
            }
            let source: MLNSource?
            if let image = input.image {
                source = MLNImageSource(identifier: "native-weather-source", coordinateQuad: image.quad, image: image.image)
            } else if let tiles = input.weatherTiles {
                source = MLNRasterTileSource(identifier: "native-weather-source", tileURLTemplates: tiles.templates,
                    options: [.tileSize: 256, .minimumZoomLevel: tiles.minimumZoom, .maximumZoomLevel: tiles.maximumZoom,
                        .attributionInfos: tiles.credits.map { MLNAttributionInfo(title: NSAttributedString(string: $0.0), url: $0.1) }])
            } else if let frame = input.weather {
                source = MLNRasterTileSource(identifier: "native-weather-source",
                    tileURLTemplates: [RadarFoundationMap.Coordinator.wmsTemplate(for: frame)], options: [
                        .tileSize: 256, .maximumZoomLevel: frame.maximumZoom,
                        .attributionInfos: [MLNAttributionInfo(title: NSAttributedString(string: frame.attribution),
                                                             url: URL(string: "https://www.weather.gov/"))]])
            } else { source = nil }
            if let source {
                style.addSource(source)
                let layer = MLNRasterStyleLayer(identifier: "native-weather", source: source)
                layer.rasterFadeDuration = NSExpression(forConstantValue: 0)
                layer.rasterOpacity = NSExpression(forConstantValue: 0.76)
                layer.rasterOpacityTransition = MLNTransition(duration: 0, delay: 0)
                if let labels = style.layer(withIdentifier: "native-labels") { style.insertLayer(layer, below: labels) }
                else { style.addLayer(layer) }
            }
            weatherID = nextID
            renderedTemplates = templates
            renderedWeatherRevision = input.weatherRevision
            applyAlerts(to: style)
        }

        private let alertTones: [NativeRadarAlertsContract.Tone] = [.notice, .advisory, .watch, .warning]
        private func removeAlerts(from style: MLNStyle) {
            for tone in alertTones {
                for suffix in ["fill", "line"] {
                    if let layer = style.layer(withIdentifier: "native-alert-\(tone.rawValue)-\(suffix)") { style.removeLayer(layer) }
                }
            }
            if let source = style.source(withIdentifier: "native-alerts-source") { style.removeSource(source) }
            renderedAlerts = nil
        }
        private func applyAlerts(to style: MLNStyle) {
            guard renderedAlerts != input.alerts else { return }
            removeAlerts(from: style)
            guard let data = input.alerts, let shape = try? MLNShape(data: data, encoding: String.Encoding.utf8.rawValue) else { return }
            let source = MLNShapeSource(identifier: "native-alerts-source", shape: shape, options: nil)
            style.addSource(source)
            for tone in alertTones {
                let rgb = tone.rgb
                let color = UIColor(red: CGFloat(rgb[0]) / 255, green: CGFloat(rgb[1]) / 255, blue: CGFloat(rgb[2]) / 255, alpha: 1)
                let fill = MLNFillStyleLayer(identifier: "native-alert-\(tone.rawValue)-fill", source: source)
                fill.predicate = NSPredicate(format: "tone == %@", tone.rawValue)
                fill.fillColor = NSExpression(forConstantValue: color)
                fill.fillOpacity = NSExpression(forConstantValue: 0.12)
                let line = MLNLineStyleLayer(identifier: "native-alert-\(tone.rawValue)-line", source: source)
                line.predicate = fill.predicate
                line.lineColor = NSExpression(forConstantValue: color)
                line.lineWidth = NSExpression(forConstantValue: 2)
                if let labels = style.layer(withIdentifier: "native-labels") {
                    style.insertLayer(fill, below: labels); style.insertLayer(line, below: labels)
                } else { style.addLayer(fill); style.addLayer(line) }
            }
            renderedAlerts = data
        }
        @objc func openAlert(_ recognizer: UITapGestureRecognizer) {
            guard recognizer.state == .ended, let map = recognizer.view as? MLNMapView else { return }
            let ids = Set(alertTones.map { "native-alert-\($0.rawValue)-fill" })
            let features = map.visibleFeatures(at: recognizer.location(in: map), styleLayerIdentifiers: ids)
            guard let id = features.first?.attribute(forKey: "alertID") as? String else { return }
            input.onAlert(id)
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            // A saved-place marker or its callout owns its tap. Opening an
            // underlying alert as well would race the place detail presentation.
            var view = touch.view
            while let current = view {
                if current is MLNAnnotationView || current is UIControl || current is any MLNCalloutView { return false }
                view = current.superview
            }
            return true
        }

        func mapView(_ mapView: MLNMapView, regionDidChangeAnimated animated: Bool) { reportViewport(mapView) }
        func mapView(_ mapView: MLNMapView, tileDidTriggerAction operation: MLNTileOperation,
                     x: Int, y: Int, z: Int, wrap: Int, overscaledZ: Int, sourceID: String) {
            // Only aggregate counts leave the SDK. Never expose provider URLs,
            // tile coordinates or credentials in diagnostics.
            DispatchQueue.main.async { [weak self] in
                guard let self, self.active else { return }
                switch operation {
                case .requestedFromNetwork: self.tileRequests += 1
                case .endParse: self.tileParses += 1
                case .error: self.tileErrors += 1
                default: return
                }
                let summary = "Tile requests \(self.tileRequests) · parsed \(self.tileParses) · errors \(self.tileErrors)"
                self.input.onTileActivity(summary)
            }
        }
        private func reportViewport(_ map: MLNMapView) {
            let bounds = map.visibleCoordinateBounds
            let viewport = NativeRadarViewport(west: bounds.sw.longitude, south: bounds.sw.latitude,
                                               east: bounds.ne.longitude, north: bounds.ne.latitude)
            DispatchQueue.main.async { [weak self] in
                guard let self, self.active else { return }
                self.input.onViewport(viewport)
            }
        }

        func mapView(_ mapView: MLNMapView, viewFor annotation: any MLNAnnotation) -> MLNAnnotationView? {
            guard let point = annotation as? MLNPointAnnotation,
                  let place = markerPlaces[ObjectIdentifier(point)] else { return nil }
            let role = markerRoles[ObjectIdentifier(point)] ?? "Place"
            let reuseID = "native-place-" + role
            let marker = mapView.dequeueReusableAnnotationView(withIdentifier: reuseID) ?? MLNAnnotationView(reuseIdentifier: reuseID)
            marker.frame = CGRect(x: 0, y: 0, width: 44, height: 44)
            marker.isDraggable = false
            marker.isAccessibilityElement = true
            marker.accessibilityLabel = "\(place.name), \(role.lowercased())"
            marker.accessibilityHint = "Shows place actions."
            marker.accessibilityTraits = .button
            if marker.viewWithTag(2101) == nil {
                let symbol = UIImageView(image: UIImage(systemName: role == "Selected place" ? "mappin.circle.fill" :
                    (role == "Saved place" ? "house.circle.fill" : "location.circle.fill")))
                symbol.tag = 2101
                symbol.frame = CGRect(x: 8, y: 8, width: 28, height: 28)
                symbol.tintColor = role == "Selected place" ? .systemBlue : .label
                symbol.backgroundColor = .systemBackground
                symbol.layer.cornerRadius = 14
                symbol.layer.shadowColor = UIColor.black.cgColor
                symbol.layer.shadowOpacity = 0.25
                symbol.layer.shadowRadius = 3
                symbol.layer.shadowOffset = CGSize(width: 0, height: 1)
                marker.addSubview(symbol)
            }
            return marker
        }
        func mapView(_ mapView: MLNMapView, annotationCanShowCallout annotation: any MLNAnnotation) -> Bool {
            guard let point = annotation as? MLNPointAnnotation else { return false }
            return markerPlaces[ObjectIdentifier(point)] != nil
        }
        func mapView(_ mapView: MLNMapView, rightCalloutAccessoryViewFor annotation: any MLNAnnotation) -> UIView? {
            guard let point = annotation as? MLNPointAnnotation,
                  let place = markerPlaces[ObjectIdentifier(point)] else { return nil }
            let button = UIButton(type: .detailDisclosure)
            button.frame = CGRect(x: 0, y: 0, width: 44, height: 44)
            button.accessibilityLabel = "Open \(place.name) actions"
            return button
        }
        func mapView(_ mapView: MLNMapView, annotation: any MLNAnnotation, calloutAccessoryControlTapped control: UIControl) {
            guard active, let point = annotation as? MLNPointAnnotation,
                  let place = markerPlaces[ObjectIdentifier(point)] else { return }
            input.onPlace(place)
        }
        func mapView(_ mapView: MLNMapView, didFailToLoadImage imageName: String) -> UIImage? { nil }
        func mapViewDidFailLoadingMap(_ mapView: MLNMapView, withError error: any Error) { reportFailure() }
        func mapViewRendererDidError(_ mapView: MLNMapView) { reportFailure() }
        private func reportFailure() {
            DispatchQueue.main.async { [weak self] in
                guard let self, self.active else { return }
                self.input.onFailure()
            }
        }
    }
}
