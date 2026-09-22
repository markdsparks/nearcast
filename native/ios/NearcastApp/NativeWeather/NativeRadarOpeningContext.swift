import Foundation

/// An in-memory handoff from the Today snapshot to the interactive map. The
/// weather image keeps its real geographic bounds; it is never stretched from
/// the landscape preview to fill the portrait map.
struct NativeRadarOpeningContext {
    let placeIdentity: String
    let latitude: Double
    let longitude: Double
    let zoom: Double
    let frameTime: Date
    let image: NativeRadarImage?
    let observedFrames: [MRMSContract.AdvertisedFrame]
    let globalSnapshot: NativeGlobalRadarSnapshot?

    func matches(_ place: NativePreviewPlace) -> Bool {
        place.isValid && placeIdentity == place.coordinateIdentity
            && latitude == place.latitude && longitude == place.longitude
            && zoom.isFinite && (4...16).contains(zoom)
    }

    func isUsable(for place: NativePreviewPlace, at now: Date = Date()) -> Bool {
        guard matches(place), frameTime.timeIntervalSince1970.isFinite,
              now.timeIntervalSince1970.isFinite, frameTime <= now else { return false }
        if let image {
            let times = observedFrames.map { Date(timeIntervalSince1970: Double($0.validTimeMilliseconds) / 1000) }
            return times.contains(frameTime)
                && NativeRadarFreshnessPolicy.assess(latest: times.max(), selected: frameTime, at: now).sourceIsUsable
                && NativeRadarViewport(west: image.west, south: image.south, east: image.east, north: image.north).isUsable
        }
        guard let globalSnapshot, globalSnapshot.frames.contains(where: { $0.validTime == frameTime }),
              let latest = globalSnapshot.frames.map(\.validTime).max(), latest <= now else { return false }
        return now.timeIntervalSince(latest) <= 30 * 60
    }
}
