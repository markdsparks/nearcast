import SwiftUI

struct ContentView: View {
    @ObservedObject var model: NearcastWebModel

    #if DEBUG
    @State private var showingDiagnostics = false
    #endif

    var body: some View {
        ZStack {
            NearcastWebView(model: model)
                .ignoresSafeArea()

            #if DEBUG
            VStack {
                debugBar
                Spacer()
            }
            .padding(.top, 10)
            .padding(.horizontal, 12)
            #endif
        }
        #if DEBUG
        .sheet(isPresented: $showingDiagnostics) {
            NativeDiagnosticsView(model: model)
        }
        #endif
    }

    #if DEBUG
    private var debugBar: some View {
        HStack(spacing: 10) {
            Circle()
                .fill(model.isLoading ? Color.yellow : Color.green)
                .frame(width: 8, height: 8)

            Text("Native \(model.mode.label)")
                .font(.caption.weight(.semibold))

            Spacer(minLength: 8)

            Button {
                model.reload()
            } label: {
                Image(systemName: "arrow.clockwise")
            }
            .accessibilityLabel("Reload Nearcast")

            Button {
                showingDiagnostics = true
            } label: {
                Image(systemName: "slider.horizontal.3")
            }
            .accessibilityLabel("Open native diagnostics")
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(.black.opacity(0.58), in: Capsule())
        .shadow(color: .black.opacity(0.22), radius: 12, y: 6)
    }
    #endif
}
