import SwiftUI
import UIKit
import MapLibre

/// Isolated MapLibre renderer: no shipping-provider configuration or permissions.
/// A synthetic image takes precedence over `frame`; test imagery is never blended
/// into a live NOAA frame. The caller must label this mode as synthetic.
struct RadarFoundationMap: UIViewRepresentable {
    let frame: RadarProofFrame?
    let syntheticImage: UIImage?
    /// Change this identity whenever the synthetic pixel content changes.
    let syntheticID: String?
    let recenter: Int
    let onDiagnostic: (String) -> Void

    static let publicCenter = CLLocationCoordinate2D(latitude: 38.7237, longitude: -89.9557)
    // Fixed test-image extent, not a claimed weather coverage boundary. The image's
    // first pixel row is north, first column west. Native quad order is TL, BL, BR, TR.
    static let syntheticQuad = MLNCoordinateQuad(
        topLeft: CLLocationCoordinate2D(latitude: 41, longitude: -93),
        bottomLeft: CLLocationCoordinate2D(latitude: 36, longitude: -93),
        bottomRight: CLLocationCoordinate2D(latitude: 36, longitude: -87),
        topRight: CLLocationCoordinate2D(latitude: 41, longitude: -87))

    func makeCoordinator() -> Coordinator { Coordinator(onDiagnostic: onDiagnostic) }

    func makeUIView(context: Context) -> MLNMapView {
        // Never use MapLibre's default remote style implicitly. A missing bundled
        // diagnostic style falls back to an entirely local, empty background.
        let map: MLNMapView
        if let styleURL = Bundle.main.url(forResource: "DiagnosticStyle", withExtension: "json") {
            map = MLNMapView(frame: .zero, styleURL: styleURL)
        } else {
            map = MLNMapView(frame: .zero, styleJSON:
                ##"{"version":8,"sources":{},"layers":[{"id":"diagnostic-background","type":"background","paint":{"background-color":"#17232d"}}]}"##)
        }
        context.coordinator.updateInputs(self)
        map.delegate = context.coordinator
        map.showsUserLocation = false
        map.isPitchEnabled = false
        map.isRotateEnabled = false
        map.minimumZoomLevel = 3
        map.maximumZoomLevel = 11
        map.showsLogoView = true
        map.showsAttributionButton = true
        map.logoViewMargins = CGPoint(x: 8, y: 8)
        map.attributionButtonMargins = CGPoint(x: 8, y: 8)
        map.accessibilityLabel = "Experimental native radar map. Offline coordinate grid, no street basemap."
        map.setCenter(Self.publicCenter, zoomLevel: 6.5, animated: false)
        context.coordinator.lastRecenter = recenter
        context.coordinator.installPublicMarker(on: map)
        return map
    }

    func updateUIView(_ map: MLNMapView, context: Context) {
        let coordinator = context.coordinator
        coordinator.updateInputs(self)
        if coordinator.lastRecenter != recenter {
            coordinator.lastRecenter = recenter
            map.setCenter(Self.publicCenter, zoomLevel: 6.5, animated: false)
        }
        coordinator.applySelection(to: map)
    }

    static func dismantleUIView(_ map: MLNMapView, coordinator: Coordinator) {
        coordinator.isActive = false
        map.delegate = nil
    }

    final class Coordinator: NSObject, MLNMapViewDelegate {
        private let gridSourceID = "foundation-grid-source"
        private let gridLayerID = "foundation-grid-layer"
        private let rasterLayerID = "foundation-weather-layer"
        private let rasterSourceID = "foundation-weather-source"
        private var frame: RadarProofFrame?
        private var image: UIImage?
        private var syntheticID: String?
        private var onDiagnostic: (String) -> Void
        private var appliedSelection: String?
        private var styleReady = false
        private var selectionStartedAt = CFAbsoluteTimeGetCurrent()
        private var recordedRender = false
        private var syntheticCorners: [MLNPointAnnotation] = []
        var lastRecenter = 0
        var isActive = true

        init(onDiagnostic: @escaping (String) -> Void) {
            self.onDiagnostic = onDiagnostic
        }

        func updateInputs(_ input: RadarFoundationMap) {
            frame = input.frame
            image = input.syntheticImage
            syntheticID = input.syntheticID
            onDiagnostic = input.onDiagnostic
        }

        private var selectionID: String {
            if image != nil, let syntheticID { return "synthetic:\(syntheticID)" }
            return frame.map { "noaa:\($0.id)" } ?? "empty"
        }

        func installPublicMarker(on map: MLNMapView) {
            let marker = MLNPointAnnotation()
            marker.coordinate = RadarFoundationMap.publicCenter
            marker.title = "Maryville · public test location"
            marker.subtitle = "38.7237° N, 89.9557° W · not device location"
            map.addAnnotation(marker)
        }

        func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) {
            styleReady = true
            appliedSelection = nil
            do {
                try installGrid(in: style)
                applySelection(to: mapView)
            } catch {
                publish("Diagnostic grid could not load: \(error.localizedDescription)")
            }
        }

        func applySelection(to map: MLNMapView) {
            guard styleReady, let style = map.style, appliedSelection != selectionID else { return }
            let selectedID = selectionID
            selectionStartedAt = CFAbsoluteTimeGetCurrent()
            recordedRender = false

            // Remove the old layer before its source; no opacity animation or
            // cross-source fade can make an NDFD amount look like radar motion.
            if let oldLayer = style.layer(withIdentifier: rasterLayerID) { style.removeLayer(oldLayer) }
            if let oldSource = style.source(withIdentifier: rasterSourceID) { style.removeSource(oldSource) }
            if !syntheticCorners.isEmpty {
                map.removeAnnotations(syntheticCorners)
                syntheticCorners.removeAll()
            }

            let source: MLNSource?
            if let image, syntheticID != nil {
                source = MLNImageSource(identifier: rasterSourceID,
                                        coordinateQuad: RadarFoundationMap.syntheticQuad, image: image)
                installSyntheticCorners(on: map)
            } else if let frame {
                source = MLNRasterTileSource(identifier: rasterSourceID,
                    tileURLTemplates: [Self.wmsTemplate(for: frame)], options: [
                        .tileSize: 256,
                        .minimumZoomLevel: 0,
                        .maximumZoomLevel: frame.maximumZoom,
                        .attributionInfos: [MLNAttributionInfo(
                            title: NSAttributedString(string: frame.attribution),
                            url: URL(string: "https://www.weather.gov/"))]
                    ])
            } else {
                source = nil
            }

            if let source {
                style.addSource(source)
                let layer = MLNRasterStyleLayer(identifier: rasterLayerID, source: source)
                layer.rasterFadeDuration = NSExpression(forConstantValue: 0)
                layer.rasterOpacity = NSExpression(forConstantValue: 1)
                layer.rasterOpacityTransition = MLNTransition(duration: 0, delay: 0)
                // Nearest-neighbor display retains the synthetic fixture's pixel
                // colors. NOAA imagery keeps the renderer's linear default.
                if image != nil, syntheticID != nil {
                    layer.rasterResamplingMode = NSExpression(forConstantValue: "nearest")
                }
                if let grid = style.layer(withIdentifier: gridLayerID) {
                    style.insertLayer(layer, below: grid)
                } else {
                    style.addLayer(layer)
                }
            }
            appliedSelection = selectedID
            publish(source == nil
                ? "Offline grid only · no weather selected"
                : "Renderer update requested · \(selectedID) · awaiting SDK draw")
        }

        /// The pinned Native SDK expands this WMS placeholder itself. URLComponents
        /// encodes every real query value; only a controlled sentinel becomes a token.
        static func wmsTemplate(for frame: RadarProofFrame) -> String {
            var components = URLComponents(string: frame.endpoint)!
            components.queryItems = [
                .init(name: "SERVICE", value: "WMS"), .init(name: "VERSION", value: "1.3.0"),
                .init(name: "REQUEST", value: "GetMap"), .init(name: "LAYERS", value: frame.layer),
                .init(name: "STYLES", value: frame.style), .init(name: "CRS", value: "EPSG:3857"),
                .init(name: "BBOX", value: "NEARCAST_DIAGNOSTIC_BBOX"),
                .init(name: "WIDTH", value: "256"), .init(name: "HEIGHT", value: "256"),
                .init(name: "FORMAT", value: "image/png"), .init(name: "TRANSPARENT", value: "true"),
                .init(name: "TIME", value: frame.sourceTime)
            ]
            // Form-style WMS servers may interpret a literal plus as a space.
            // Preserve timezone offsets in any explicitly advertised TIME value.
            components.percentEncodedQuery = components.percentEncodedQuery?
                .replacingOccurrences(of: "+", with: "%2B")
            return components.url!.absoluteString.replacingOccurrences(
                of: "NEARCAST_DIAGNOSTIC_BBOX", with: "{bbox-epsg-3857}")
        }

        private func installGrid(in style: MLNStyle) throws {
            guard style.source(withIdentifier: gridSourceID) == nil else { return }
            var features: [[String: Any]] = []
            for longitude in -104 ... -76 {
                features.append(["type": "Feature", "properties": [:], "geometry": [
                    "type": "LineString", "coordinates": [[Double(longitude), 25.0], [Double(longitude), 50.0]]]])
            }
            for latitude in 25 ... 50 {
                features.append(["type": "Feature", "properties": [:], "geometry": [
                    "type": "LineString", "coordinates": [[-104.0, Double(latitude)], [-76.0, Double(latitude)]]]])
            }
            let data = try JSONSerialization.data(withJSONObject: ["type": "FeatureCollection", "features": features])
            let shape = try MLNShape(data: data, encoding: String.Encoding.utf8.rawValue)
            let source = MLNShapeSource(identifier: gridSourceID, shape: shape, options: nil)
            style.addSource(source)
            let layer = MLNLineStyleLayer(identifier: gridLayerID, source: source)
            layer.lineColor = NSExpression(forConstantValue: UIColor(white: 0.8, alpha: 1))
            layer.lineWidth = NSExpression(forConstantValue: 0.7)
            layer.lineOpacity = NSExpression(forConstantValue: 0.25)
            style.addLayer(layer)
        }

        private func installSyntheticCorners(on map: MLNMapView) {
            let quad = RadarFoundationMap.syntheticQuad
            let points = [("NW", quad.topLeft), ("SW", quad.bottomLeft),
                          ("SE", quad.bottomRight), ("NE", quad.topRight)]
            syntheticCorners = points.map { label, coordinate in
                let point = MLNPointAnnotation()
                point.coordinate = coordinate
                point.title = label
                point.subtitle = "Synthetic extent corner: \(coordinate.latitude), \(coordinate.longitude)"
                return point
            }
            map.addAnnotations(syntheticCorners)
        }

        func mapView(_ mapView: MLNMapView, viewFor annotation: any MLNAnnotation) -> MLNAnnotationView? {
            guard let title = annotation.title ?? nil, ["NW", "SW", "SE", "NE"].contains(title) else { return nil }
            let reuseID = "synthetic-corner-\(title)"
            if let reused = mapView.dequeueReusableAnnotationView(withIdentifier: reuseID) { return reused }
            let view = MLNAnnotationView(reuseIdentifier: reuseID)
            view.frame = CGRect(x: 0, y: 0, width: 34, height: 24)
            view.backgroundColor = UIColor.black.withAlphaComponent(0.85)
            view.layer.cornerRadius = 5
            view.layer.borderWidth = 1
            view.layer.borderColor = UIColor.white.cgColor
            let label = UILabel(frame: view.bounds)
            label.text = title
            label.font = .monospacedSystemFont(ofSize: 11, weight: .bold)
            label.textColor = .white
            label.textAlignment = .center
            view.addSubview(label)
            view.accessibilityLabel = "Synthetic image \(title) corner"
            return view
        }

        func mapView(_ mapView: MLNMapView, annotationCanShowCallout annotation: any MLNAnnotation) -> Bool { true }

        func mapViewDidFinishRenderingFrame(_ mapView: MLNMapView, fullyRendered: Bool) {
            // SDK callbacks can be frequent. Publish at most once per selection,
            // and only report the SDK's state, not successful weather validation.
            guard fullyRendered, !recordedRender, let appliedSelection else { return }
            recordedRender = true
            let elapsedMS = (CFAbsoluteTimeGetCurrent() - selectionStartedAt) * 1_000
            publish("SDK fully-rendered callback \(Int(elapsedMS)) ms after update · \(appliedSelection). Not a tile-validity or alignment check.")
        }

        func mapView(_ mapView: MLNMapView, regionDidChangeAnimated animated: Bool) {
            let center = mapView.centerCoordinate
            publish(String(format: "Viewport %.3f, %.3f · zoom %.2f · native camera update", center.latitude, center.longitude, mapView.zoomLevel))
        }

        func mapViewDidFailLoadingMap(_ mapView: MLNMapView, withError error: any Error) {
            publish("Map SDK load error: \(error.localizedDescription) · weather availability unverified")
        }

        func mapViewRendererDidError(_ mapView: MLNMapView) {
            // This low-level delegate method is explicitly not thread-safe.
            // Only enqueue; no map or SwiftUI state is touched here.
            DispatchQueue.main.async { [weak self] in
                self?.publish("Map SDK rendering error · weather availability unverified")
            }
        }

        private func publish(_ message: String) {
            // Defer SwiftUI writes out of UIViewRepresentable update/render calls.
            DispatchQueue.main.async { [weak self] in
                guard let self, self.isActive else { return }
                self.onDiagnostic(message)
            }
        }
    }
}
