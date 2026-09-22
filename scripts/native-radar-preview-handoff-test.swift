import Foundation

// Value-only UI/provider stand-ins let macOS compile the actual iOS handoff
// contract. Projection, metadata parsing and provider validity have their own
// full production-type suites; none of those implementations are copied here.
struct NativePreviewPlace {
    let latitude: Double, longitude: Double
    var coordinateIdentity: String { "\(latitude),\(longitude)" }
    var isValid: Bool { latitude.isFinite && longitude.isFinite && (-85...85).contains(latitude) && (-180...180).contains(longitude) }
}
struct NativeRadarImage { let west: Double, south: Double, east: Double, north: Double }
struct NativeRadarViewport {
    let west: Double, south: Double, east: Double, north: Double
    var isUsable: Bool { [west, south, east, north].allSatisfy(\.isFinite) && west < east && south < north }
}
enum MRMSContract { struct AdvertisedFrame { let validTimeMilliseconds: Int64 } }
struct NativeGlobalRadarFrame { let validTime: Date }
struct NativeGlobalRadarSnapshot { let frames: [NativeGlobalRadarFrame] }

@main enum NativeRadarPreviewHandoffTests {
    static func main() {
        let now = Date(timeIntervalSince1970: 1_790_000_000)
        let place = NativePreviewPlace(latitude: 38.72, longitude: -89.96)
        let image = NativeRadarImage(west: -92, south: 37, east: -88, north: 41)
        func context(age: TimeInterval = 120, camera: Double = 6.8,
                     selected: Date? = nil, picture: NativeRadarImage? = image,
                     global: Bool = false, wrongPlace: Bool = false) -> NativeRadarOpeningContext {
            let time = now.addingTimeInterval(-age)
            return .init(placeIdentity: wrongPlace ? "other" : place.coordinateIdentity,
                latitude: place.latitude, longitude: place.longitude, zoom: camera,
                frameTime: selected ?? time, image: global ? nil : picture,
                observedFrames: global ? [] : [.init(validTimeMilliseconds: Int64(time.timeIntervalSince1970 * 1000))],
                globalSnapshot: global ? .init(frames: [.init(validTime: time)]) : nil)
        }
        precondition(context().matches(place) && context().isUsable(for: place, at: now))
        precondition(!context(wrongPlace: true).matches(place))
        precondition(!context().isUsable(for: .init(latitude: 40, longitude: -90), at: now))
        precondition(!context(camera: .nan).matches(place))
        precondition(!context(camera: 3).matches(place))
        precondition(!context(camera: 17).matches(place))
        precondition(!context(age: -1).isUsable(for: place, at: now))
        precondition(context(age: 16 * 60).isUsable(for: place, at: now))
        precondition(!context(age: 36 * 60).isUsable(for: place, at: now))
        precondition(!context(selected: now.addingTimeInterval(-121)).isUsable(for: place, at: now))
        precondition(!context(picture: nil).isUsable(for: place, at: now))
        precondition(!context(picture: .init(west: 0, south: 1, east: -1, north: 2)).isUsable(for: place, at: now))
        precondition(context(global: true).isUsable(for: place, at: now))
        precondition(!context(age: 31 * 60, global: true).isUsable(for: place, at: now))
        precondition(!context(age: -1, global: true).isUsable(for: place, at: now))
        precondition(!context(selected: now.addingTimeInterval(-121), global: true).isUsable(for: place, at: now))
        precondition(!context().isUsable(for: place, at: Date(timeIntervalSince1970: .nan)))
        print("PASS native radar preview handoff: exact place/camera, observed membership, real image bounds, future/stale rejection and global observed freshness")
    }
}
