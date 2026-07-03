import SwiftUI

struct NativeDiagnosticsView: View {
    @ObservedObject var model: NearcastWebModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Runtime") {
                    Picker("Source", selection: Binding(
                        get: { model.mode },
                        set: { model.load($0) }
                    )) {
                        ForEach(NearcastWebMode.allCases) { mode in
                            Text(mode.label).tag(mode)
                        }
                    }
                    .pickerStyle(.segmented)

                    Text(model.currentURL.absoluteString)
                        .font(.footnote.monospaced())
                        .foregroundStyle(.secondary)
                }

                Section("Local development server") {
                    TextField("http://192.168.1.20:4177", text: $model.localURLText)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()

                    Button("Save local URL") {
                        model.saveLocalURL()
                    }

                    Text("Simulator can use 127.0.0.1. A real iPhone needs your Mac LAN IP.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section("Controls") {
                    Button("Reload Nearcast") {
                        model.reload()
                    }

                    Button("Use production") {
                        model.load(.production)
                    }

                    Button("Use local") {
                        model.load(.local)
                    }
                }

                Section("Native bridge") {
                    Text(model.lastBridgeMessage)
                        .font(.footnote.monospaced())
                        .textSelection(.enabled)
                }

                if let lastError = model.lastError {
                    Section("Last load issue") {
                        Text(lastError)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Native Debug")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
    }
}
