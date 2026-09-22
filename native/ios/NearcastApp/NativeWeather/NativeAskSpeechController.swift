import AVFoundation
import Combine
import Speech
import UIKit

/// Native composer dictation using the same strictly on-device recognition
/// policy as the former bridge. Transcripts are drafts, never auto-submitted.
@MainActor
final class NativeAskSpeechController: ObservableObject {
    enum Phase: Equatable { case idle, authorizing, listening, finishing }
    @Published private(set) var phase: Phase = .idle
    @Published private(set) var transcript = ""
    @Published private(set) var error: String?
    var isActive: Bool { phase != .idle }

    private let audioEngine = AVAudioEngine()
    private var recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var recognition: SFSpeechRecognitionTask?
    private var permissionTask: Task<Void, Never>?
    private var finishTask: Task<Void, Never>?
    private var limitTask: Task<Void, Never>?
    private var session = UUID()
    private var tapInstalled = false
    private var ownsAudioSession = false

    func start() {
        cancel()
        error = nil; transcript = ""
        guard UIApplication.shared.applicationState == .active else {
            error = "Return to Nearcast to use the microphone."; return
        }
        let token = UUID(); session = token; phase = .authorizing
        permissionTask = Task { [weak self] in
            let authorization = await withCheckedContinuation { continuation in
                SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
            }
            guard let self, self.session == token, !Task.isCancelled else { return }
            guard authorization == .authorized else {
                self.finish(error: "Speech recognition permission is off. You can type, or enable it in iPhone Settings."); return
            }
            let microphone = await withCheckedContinuation { continuation in
                AVAudioApplication.requestRecordPermission { continuation.resume(returning: $0) }
            }
            guard self.session == token, !Task.isCancelled else { return }
            guard microphone else {
                self.finish(error: "Microphone permission is off. You can type, or enable it in iPhone Settings."); return
            }
            guard UIApplication.shared.applicationState == .active else { self.cancel(); return }
            self.begin(token)
        }
    }

    func stop() {
        guard isActive else { return }
        if phase == .authorizing { cancel(); return }
        guard phase != .finishing else { return }
        phase = .finishing
        stopCapture(); request?.endAudio()
        let token = session
        finishTask = Task { [weak self] in
            do { try await Task.sleep(for: .milliseconds(1400)) } catch { return }
            guard let self, self.session == token else { return }
            self.finish()
        }
    }

    func cancel() { finish() }

    private func begin(_ token: UUID) {
        guard let recognizer = SFSpeechRecognizer(locale: .current), recognizer.isAvailable,
              recognizer.supportsOnDeviceRecognition else {
            finish(error: "On-device dictation is unavailable for this language on this iPhone. You can still type your question.")
            return
        }
        do {
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.record, mode: .measurement, options: [.duckOthers])
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
            ownsAudioSession = true
            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true
            request.requiresOnDeviceRecognition = true
            request.addsPunctuation = true
            let input = audioEngine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else {
                finish(error: "The microphone is unavailable. You can still type your question."); return
            }
            self.recognizer = recognizer; self.request = request
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak request] buffer, _ in request?.append(buffer) }
            tapInstalled = true
            audioEngine.prepare(); try audioEngine.start()
            recognition = recognizer.recognitionTask(with: request) { [weak self] result, error in
                Task { @MainActor in
                    guard let self, self.session == token else { return }
                    if let result {
                        self.transcript = String(result.bestTranscription.formattedString.prefix(1_200))
                        if result.isFinal { self.finish(); return }
                    }
                    if error != nil {
                        self.finish(error: self.transcript.isEmpty ? "Dictation stopped before a question was recognized. Try again or type your question." : nil)
                    }
                }
            }
            phase = .listening
            limitTask = Task { [weak self] in
                do { try await Task.sleep(for: .seconds(55)) } catch { return }
                guard let self, self.session == token else { return }
                self.stop()
            }
        } catch {
            finish(error: "The microphone could not start. Check that another app is not using it, or type your question.")
        }
    }

    private func stopCapture() {
        if audioEngine.isRunning { audioEngine.stop() }
        if tapInstalled { audioEngine.inputNode.removeTap(onBus: 0); tapInstalled = false }
    }

    private func finish(error: String? = nil) {
        session = UUID()
        permissionTask?.cancel(); permissionTask = nil
        finishTask?.cancel(); finishTask = nil
        limitTask?.cancel(); limitTask = nil
        stopCapture(); request?.endAudio(); recognition?.cancel()
        request = nil; recognition = nil; recognizer = nil
        if ownsAudioSession {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            ownsAudioSession = false
        }
        phase = .idle
        if let error { self.error = error }
    }
}
