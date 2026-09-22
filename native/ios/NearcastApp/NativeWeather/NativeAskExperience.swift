import SwiftUI

struct NativeAskExperience: View {
    let context: NativePreviewContext
    let day: Date
    let hour: Date?
    let onDone: () -> Void
    let onHourly: (NativeAskForecastTarget) -> Void
    let onNavigate: ((NativeAskNavigationAction) -> Void)?
    @ObservedObject private var conversation = NativeAskConversation.shared
    @StateObject private var speech = NativeAskSpeechController()
    @Environment(\.scenePhase) private var scenePhase
    @State private var draft = ""
    @State private var editor: NativePlanEditorRequest?
    @State private var editingMessageID: UUID?
    @State private var showingPlans = false
    @State private var confirmNewChat = false
    @State private var pendingNavigation: NativeAskNavigationAction?
    @State private var confirmNavigation = false
    @State private var dictationPrefix = ""
    @FocusState private var focused: Bool

    /// A deep link may suggest a question, but never sends it automatically.
    /// The reader can review or edit the native draft before any on-device AI
    /// work begins.
    init(
        context: NativePreviewContext,
        day: Date,
        hour: Date? = nil,
        initialQuery: String? = nil,
        onDone: @escaping () -> Void,
        onHourly: @escaping (NativeAskForecastTarget) -> Void,
        onNavigate: ((NativeAskNavigationAction) -> Void)? = nil
    ) {
        self.context = context
        self.day = day
        self.hour = hour
        self.onDone = onDone
        self.onHourly = onHourly
        self.onNavigate = onNavigate
        let compact = initialQuery?
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        _draft = State(initialValue: String(compact.prefix(1_200)))
    }

    var body: some View {
        NavigationStack {
            ScrollViewReader { scroll in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 20) {
                        if conversation.messages.isEmpty {
                            VStack(alignment: .leading, spacing: 14) {
                                Image(systemName: "sparkle").font(.largeTitle).foregroundStyle(.tint)
                                Text("Weather, with your day in mind.").font(.largeTitle.bold())
                                Text("Ask a question, compare days, or work out a plan. Follow-ups stay in this conversation.")
                                    .foregroundStyle(.secondary)
                                suggestion("Will it rain tomorrow?")
                                suggestion("Compare tomorrow and the next day for a walk.")
                                suggestion("Help me plan a walk tomorrow from 5 to 6 PM.")
                            }.padding(.vertical, 20)
                        }
                        ForEach(conversation.messages) { message in
                            messageView(message).id(message.id)
                        }
                        if conversation.isWorking {
                            HStack(spacing: 12) { ProgressView(); Text(conversation.progress).foregroundStyle(.secondary) }
                        }
                        if let error = conversation.persistenceError { Text(error).font(.footnote).foregroundStyle(.orange) }
                        Color.clear.frame(height: 1).id("bottom")
                    }.padding(20)
                }
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: conversation.messages.count) { _, _ in withAnimation { scroll.scrollTo("bottom", anchor: .bottom) } }
                .onChange(of: conversation.isWorking) { _, _ in withAnimation { scroll.scrollTo("bottom", anchor: .bottom) } }
            }
            .safeAreaInset(edge: .bottom) { composer }
            .navigationTitle("Ask Nearcast")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Done") { speech.cancel(); conversation.cancel(); onDone() } }
                ToolbarItem(placement: .topBarTrailing) { Button("New chat", systemImage: "square.and.pencil") { speech.cancel(); confirmNewChat = true } }
            }
            .confirmationDialog("Start a new conversation?", isPresented: $confirmNewChat, titleVisibility: .visible) {
                Button("New chat", role: .destructive) { speech.cancel(); conversation.newChat() }
            } message: { Text("This clears this chat, not your saved plans.") }
            .confirmationDialog(pendingNavigation?.label ?? "Switch place?", isPresented: $confirmNavigation, titleVisibility: .visible) {
                Button("Switch viewed place") {
                    if let action = pendingNavigation, action.isValid { navigate(action) }
                    pendingNavigation = nil
                }
                Button("Cancel", role: .cancel) { pendingNavigation = nil }
            } message: {
                Text("This changes only the forecast you’re viewing and keeps the requested day and time. It does not add or remove saved places.")
            }
            .sheet(item: $editor) { request in
                NativePlanEditor(context: context, day: day, request: request) { plan in
                    if let editingMessageID { conversation.planSaved(plan, messageID: editingMessageID) }
                    editor = nil
                }
            }
            .sheet(isPresented: $showingPlans, onDismiss: {
                if let target = deferredHourly { deferredHourly = nil; onHourly(target) }
            }) {
                NativePlansExperience(context: context, day: day, onDone: { showingPlans = false }, onHourly: { item in
                    guard let calendar = try? NativePlanSchedule.calendar(item.place),
                          let date = NativePlanSchedule.date(item.startDate, hour: item.startHour, calendar: calendar) else { return }
                    // Hourly stays inside the native hierarchy after dismissal.
                    deferredHourly = .init(place: item.place.previewPlace, day: date, hour: date)
                    showingPlans = false
                })
            }
            .interactiveDismissDisabled(conversation.isWorking)
            .onDisappear { speech.cancel() }
            .onChange(of: scenePhase) { _, phase in if phase != .active { speech.cancel() } }
            .onChange(of: speech.transcript) { _, transcript in
                guard !transcript.isEmpty else { return }
                draft = String((dictationPrefix + (dictationPrefix.isEmpty ? "" : " ") + transcript).prefix(1_200))
            }
        }
    }

    @State private var deferredHourly: NativeAskForecastTarget?

    private var composer: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("\(conversation.activePlaceName ?? context.selectedPlace.name) · On-device AI + quick forecast reads")
                .font(.caption).foregroundStyle(.secondary)
            HStack(alignment: .bottom, spacing: 12) {
                TextField("Ask about your weather…", text: $draft, axis: .vertical)
                    .lineLimit(1...5).focused($focused).submitLabel(.send).onSubmit(send)
                    .disabled(speech.isActive)
                    .accessibilityIdentifier("ask.composer")
                if conversation.isWorking {
                    Button("Stop", systemImage: "stop.circle.fill") { conversation.cancel() }.labelStyle(.iconOnly).font(.title2)
                } else {
                    Button(speech.isActive ? "Finish dictation" : "Dictate a question", systemImage: speech.isActive ? "stop.circle" : "mic") {
                        if speech.isActive { speech.stop() }
                        else { focused = false; dictationPrefix = draft.trimmingCharacters(in: .whitespacesAndNewlines); speech.start() }
                    }
                    .labelStyle(.iconOnly).font(.title2)
                    .disabled(speech.phase == .finishing)
                    .accessibilityIdentifier("ask.dictate")
                    Button("Send", systemImage: "arrow.up.circle.fill", action: send)
                        .labelStyle(.iconOnly).font(.title2)
                        .disabled(speech.isActive || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || draft.utf16.count > 1200)
                        .accessibilityIdentifier("ask.send")
                }
            }
            if speech.isActive {
                HStack {
                    Text(speech.phase == .authorizing ? "Requesting microphone access…" : speech.phase == .finishing ? "Finishing dictation…" : "Listening on this iPhone. Review the draft before sending.")
                    Button("Cancel") { speech.cancel(); draft = dictationPrefix }
                }.font(.caption).foregroundStyle(.secondary)
            }
            if let error = speech.error { Text(error).font(.caption).foregroundStyle(.orange) }
            if draft.utf16.count > 1200 { Text("Please keep the question under 1,200 characters.").font(.caption).foregroundStyle(.orange) }
        }.padding(16).background(.regularMaterial)
    }

    private func messageView(_ message: NativeAskMessage) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(message.text).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
            if message.usedQuickRead == true {
                Label("Quick forecast read · no AI required", systemImage: "iphone").font(.caption).foregroundStyle(.secondary)
            }
            if let source = message.forecastSource {
                Label(source.statusLabel, systemImage: source.statusSymbol)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(source.isSavedFallback ? .orange : .secondary)
                    .accessibilityIdentifier(source.isSavedFallback ? "ask.forecast-source.saved" : "ask.forecast-source.refreshed")
            }
            if let plan = message.plan {
                Text(NativePlanLabels.schedule(NativePlanSchedule.item(plan), clock24: context.uses24HourClock)).font(.subheadline)
                Button("Review plan", systemImage: "calendar.badge.plus") {
                    speech.cancel()
                    editingMessageID = message.id; editor = .init(suggested: plan)
                }.buttonStyle(.borderedProminent)
            }
            if let question = message.retryQuestion {
                Button("Try again") { speech.cancel(); conversation.send(question, context: context, day: day, hour: hour, retry: message.id) }
                    .disabled(conversation.isWorking)
                Button("Create a plan manually") { speech.cancel(); editingMessageID = nil; editor = .init() }
            }
            if message.showsPlanComposer == true {
                Button("Create a plan", systemImage: "calendar.badge.plus") { speech.cancel(); editingMessageID = nil; editor = .init() }
                    .buttonStyle(.borderedProminent)
            }
            if let action = message.navigation, action.isValid, onNavigate != nil {
                Button(action.label) {
                    speech.cancel()
                    if action.requiresConfirmation { pendingNavigation = action; confirmNavigation = true }
                    else { navigate(action) }
                }.buttonStyle(.borderedProminent).disabled(conversation.isWorking)
            }
            if message.showsPlans {
                Button("Open Plans", systemImage: "calendar") { speech.cancel(); showingPlans = true }.buttonStyle(.bordered)
            }
            if let target = message.target, target.isValid, message.plan == nil, message.navigation == nil {
                Button("See hourly", systemImage: "clock") { speech.cancel(); onHourly(target) }.buttonStyle(.bordered)
            }
            if let evidence = message.evidence {
                DisclosureGroup("Forecast used") { Text(evidence).font(.caption).foregroundStyle(.secondary).textSelection(.enabled) }
                    .font(.caption)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(message.role == "user" ? Color.accentColor.opacity(0.16) : Color.primary.opacity(0.045), in: RoundedRectangle(cornerRadius: 20))
        .padding(.leading, message.role == "user" ? 28 : 0)
        .padding(.trailing, message.role == "user" ? 0 : 12)
    }

    private func suggestion(_ query: String) -> some View {
        Button(query) { draft = query; send() }.buttonStyle(.bordered).multilineTextAlignment(.leading).disabled(speech.isActive)
    }
    private func send() {
        guard !speech.isActive, !conversation.isWorking, !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, draft.utf16.count <= 1200 else { return }
        let query = draft; draft = ""; focused = false
        conversation.send(query, context: context, day: day, hour: hour)
    }
    private func navigate(_ action: NativeAskNavigationAction) {
        guard action.isValid else { return }
        speech.cancel(); focused = false
        conversation.navigationAccepted(action)
        onNavigate?(action)
    }
}
