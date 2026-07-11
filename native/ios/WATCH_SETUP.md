# Nearcast Apple Watch setup

Nearcast already has a standalone `NearcastWatch` target. The repository script
turns the repeatable work into one command; Apple still requires a few one-time,
interactive trust and account steps on each development Mac and device.

## What this Mac needs

1. A Mac supported by the current Xcode release.
2. Full Xcode, with its license accepted and first-launch components installed.
3. The watchOS platform/runtime in **Xcode > Settings > Components**.
4. An Apple Account added in **Xcode > Settings > Apple Accounts**.
5. Membership in the Nearcast Apple Developer team (`22PRZ6YK2P`) and an Apple
   Development signing certificate in the login keychain.
6. The Nearcast app, widget, and Watch targets assigned to that team with
   **Automatically manage signing** enabled. These are already committed in the
   project.

Check all automatable prerequisites from the repository root:

```sh
scripts/nearcast-watch.sh doctor
```

## Run in watchOS Simulator

The script selects a booted Watch simulator, or the first available one, then
boots it, builds Nearcast, installs it, and launches it:

```sh
scripts/nearcast-watch.sh simulator
```

To target a particular simulator, copy its identifier from
`xcrun simctl list devices available`:

```sh
scripts/nearcast-watch.sh simulator WATCH_SIMULATOR_ID
```

## One-time physical iPhone and Watch setup

The Watch is reached through its paired iPhone.

1. Confirm the Watch is paired to the same iPhone you will connect to the Mac.
2. Update the iPhone and Watch to OS versions supported by the installed Xcode.
3. Connect the paired iPhone to the Mac by USB for the initial setup. Unlock it,
   tap **Trust This Computer**, and enter its passcode if prompted.
4. Open **Xcode > Window > Devices and Simulators** (Device Hub). Select the
   iPhone and wait for Xcode to finish preparing it. Keep the iPhone and Watch
   unlocked, nearby, on Bluetooth/Wi-Fi, and preferably on power.
5. Enable **Developer Mode** on the iPhone in **Settings > Privacy & Security >
   Developer Mode**, restart it, and confirm the prompt.
6. Enable **Developer Mode** on the Watch in **Settings > Privacy & Security >
   Developer Mode**, restart it, and confirm the prompt. If the option is not
   visible yet, first select the Watch as a run destination in Xcode/Device Hub
   and let Xcode begin pairing/preparation.
7. In Xcode, select the `NearcastWatch` scheme and the physical Watch. On the
   first run, accept any device-registration or signing prompts. Automatic
   signing registers the devices and creates the development provisioning
   profile for the Nearcast team.

Then verify that the Watch appears:

```sh
scripts/nearcast-watch.sh doctor
```

## Build, install, and launch on the Watch

Once the doctor reports a physical Watch destination:

```sh
scripts/nearcast-watch.sh device
```

The first signed device build may prompt for the login-keychain password or for
Apple-account authentication. Those prompts are intentionally not bypassed.
After trust, signing, and provisioning are established, the command is the
normal development loop.

If more than one Watch is available, pass the Xcode destination identifier:

```sh
scripts/nearcast-watch.sh device WATCH_DEVICE_ID
```

## What is and is not automated

Automated: environment diagnostics, destination selection, Simulator boot,
Watch build, installation, and launch.

Apple-interactive by design: Apple Account sign-in and two-factor
authentication, license acceptance, device trust, Developer Mode confirmation,
keychain access, initial device registration, and occasional provisioning
renewal.

For builds distributed to other people, keep using TestFlight. TestFlight does
not require Developer Mode, while locally development-signed builds do.
