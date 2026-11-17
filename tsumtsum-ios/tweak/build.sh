#!/bin/sh
# Builds TsumMod.dylib (arm64, iOS 14+). Needs macOS with Xcode. CI runs this on a macOS runner.
set -eu
cd "$(dirname "$0")"
SDK=$(xcrun --sdk iphoneos --show-sdk-path)
mkdir -p build

# Pure logic tests on the host first.
xcrun clang++ -std=c++20 -Wall -Wextra -Werror -Isrc tests/chain_solver_test.cpp src/ChainSolver.cpp -o build/chain_solver_test
xcrun clang++ -std=c++20 -Wall -Wextra -Werror -Isrc tests/value_rules_test.cpp src/AutoPlay.cpp src/ChainSolver.cpp -o build/value_rules_test
./build/chain_solver_test
./build/value_rules_test

xcrun --sdk iphoneos clang++ -target arm64-apple-ios14.0 -isysroot "$SDK" \
    -std=c++20 -fobjc-arc -O2 -Wall -Wextra -Wno-unused-parameter \
    -dynamiclib -install_name "@executable_path/Frameworks/TsumMod.dylib" \
    -framework Foundation -framework UIKit -framework QuartzCore -framework CoreGraphics \
    src/ChainSolver.cpp src/AutoPlay.cpp src/Runtime.mm src/Features.mm src/Menu.mm src/Entry.mm \
    -o build/TsumMod.dylib

codesign -f -s - build/TsumMod.dylib
xcrun otool -l build/TsumMod.dylib | grep -A2 LC_BUILD_VERSION || true
echo "built: $(pwd)/build/TsumMod.dylib"
