#!/bin/bash
set -euo pipefail
PERF_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node - "$PERF_ROOT" <<'NODE'
const fs = require('fs');
const root = process.argv[2];
const project = fs.readFileSync(`${root}/native/ios/Nearcast.xcodeproj/project.pbxproj`, 'utf8');
const blocks = name => [...project.matchAll(new RegExp(`\\t\\t[A-F0-9]{24} /\\* ${name} \\*/ = \\{\\n\\t\\t\\tisa = XCBuildConfiguration;[\\s\\S]*?\\n\\t\\t\\};`, 'g'))].map(m => m[0]);
// App-hosted regression bundles do not ship. Keep the exact identity comparison
// scoped to the project and four shipping app/extension targets.
const shipping = name => blocks(name).filter(block => !block.includes('BUNDLE_LOADER ='));
const debug = shipping('Debug'), perf = shipping('DevPerformance');
if (debug.length !== 5 || perf.length !== 5) throw Error('Every shipping project/target must retain Debug and gain DevPerformance');
const normalized = s => s.replace(/^[^\n]+/, '').replace('name = DevPerformance;', 'name = Debug;')
  .replace('GCC_OPTIMIZATION_LEVEL = s;', 'GCC_OPTIMIZATION_LEVEL = 0;')
  .replace('SWIFT_OPTIMIZATION_LEVEL = "-O";', 'SWIFT_OPTIMIZATION_LEVEL = "-Onone";')
  .replace(/\n\t+SWIFT_COMPILATION_MODE = wholemodule;/, '')
  .replace('DEBUG_INFORMATION_FORMAT = "dwarf-with-dsym";', 'DEBUG_INFORMATION_FORMAT = dwarf;');
for (let i = 0; i < 5; i++) if (normalized(debug[i]) !== normalized(perf[i])) throw Error(`Dev identities/settings drifted in target ${i}`);
if (!perf[0].includes('SWIFT_OPTIMIZATION_LEVEL = "-O";')) throw Error('Performance code must be optimized');
const scheme = fs.readFileSync(`${root}/native/ios/Nearcast.xcodeproj/xcshareddata/xcschemes/Nearcast Dev Performance.xcscheme`, 'utf8');
if (scheme.includes('buildConfiguration = "Release"') || scheme.includes('buildConfiguration = "Debug"')) throw Error('Performance scheme must stay on DevPerformance');
if (!scheme.includes('selectedDebuggerIdentifier = ""')) throw Error('Performance launch must not attach debugger');
console.log('PASS optimized Dev preserves all native-only Debug identities, permissions and service configuration; Release untouched');
NODE
