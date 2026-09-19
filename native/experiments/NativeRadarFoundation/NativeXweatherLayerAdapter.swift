#if canImport(MapsGLMapLibre) && canImport(MapsGLMaps) && canImport(MapLibre)
import Foundation
import Combine
import UIKit
import MapLibre
import MapsGLMaps
import MapsGLMapLibre

/// Compile-tested candidate, not wired into the production map. The host must
/// supply a verified native-audience lease and display Xweather attribution.
/// Never construct a controller before explicit activation: SDK initialization
/// itself may fetch authenticated styles/metadata.
@MainActor
final class NativeXweatherLayerAdapter {
    private weak var map: MLNMapView?
    private var controller: MapLibreMapController?
    private var subscriptions = Set<AnyCancellable>()
    private var expiryTask: Task<Void, Never>?
    private var gate = NativeXweatherSessionGate()
    private var surface: NativeXweatherContract.Surface?
    private var lightningRequested = false
    private var lightningEndsAt: Date?
    private var generation = 0
    private(set) var isActive = false
    /// Generic only; never pass SDK errors or keyed URLs into diagnostics.
    var onUnavailable: (() -> Void)?

    init(map: MLNMapView) { self.map = map }

    func activate(permit: NativeXweatherContract.Permit,
                  surface: NativeXweatherContract.Surface,
                  explicitLightningRequest: Bool = false,
                  now: Date = Date()) throws {
        stop()
        guard let map, map.style != nil else { throw NativeXweatherContract.Failure.unavailable }
        try gate.activate(permit, now: now, surface: surface)
        self.surface = surface
        lightningRequested = permit.allowsLightning(now: now, surface: surface,
            explicitLightningRequest: explicitLightningRequest)
        lightningEndsAt = lightningRequested ? min(permit.expiresAt.addingTimeInterval(-2), now.addingTimeInterval(90)) : nil
        let current = generation
        let controller = MapLibreMapController(map: map,
            account: XweatherAccount(id: permit.credentials.clientID, secret: permit.credentials.clientSecret))
        self.controller = controller
        // This first adapter intentionally offers observed radar only. Do not
        // advertise the provider's future timeline as native seam parity.
        controller.timeline.startDate = now.addingTimeInterval(-90 * 60)
        controller.timeline.endDate = now
        controller.animationOptions.shouldPreloadData = false
        controller.animationOptions.shouldResumeAfterLoading = false
        controller.onLoad.observe { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.generation == current else { return }
                self.addAuthorizedLayers()
            }
        }.store(in: &subscriptions)
        expiryTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
                guard let self, self.generation == current, let surface = self.surface else { return }
                self.update(surface: surface)
            }
        }
    }

    /// Must be called synchronously for background/disappear/source switches,
    /// and when the viewport/relevance changes. Returning does not auto-resume.
    func update(surface: NativeXweatherContract.Surface, now: Date = Date()) {
        self.surface = surface
        guard gate.reconcile(now: now, surface: surface) else { stop(); return }
        if lightningRequested && (surface.zoom < NativeXweatherContract.lightningMinimumZoom ||
            lightningEndsAt.map({ now >= $0 }) != false) {
            controller?.removeWeatherLayer(for: .lightningStrikesIcons)
            lightningRequested = false
            lightningEndsAt = nil
        }
    }

    func stop() {
        generation += 1
        expiryTask?.cancel(); expiryTask = nil
        subscriptions.removeAll()
        gate.stop(); surface = nil
        lightningRequested = false; lightningEndsAt = nil; isActive = false
        guard let controller else { return }
        controller.timeline.stop()
        controller.removeWeatherLayer(for: .lightningStrikesIcons)
        controller.removeWeatherLayer(for: .radar)
        // Hidden layers retain SDK resources; remove them and their sources
        // instead. Source cleanup is required before releasing the controller.
        for id in controller.sourceIds { controller.removeSource(id: id) }
        controller.timeline.clear()
        self.controller = nil
    }

    private func addAuthorizedLayers() {
        guard let surface, gate.reconcile(now: Date(), surface: surface), let controller else { stop(); return }
        do {
            try controller.addWeatherLayer(for: .radar, beforeId: "native-labels")
            if lightningRequested, let permit = gate.permit,
               permit.allowsLightning(now: Date(), surface: surface, explicitLightningRequest: true),
               lightningEndsAt.map({ Date() < $0 }) == true {
                try controller.addWeatherLayer(for: .lightningStrikesIcons, beforeId: "native-labels")
            }
            controller.timeline.goTo(date: controller.timeline.endDate)
            isActive = true
        } catch {
            stop()
            onUnavailable?()
        }
    }
}
#endif
