$ErrorActionPreference='Stop'
$root=$PSScriptRoot
$env:JAVA_HOME=Join-Path $root 'local-builds/android-toolchain/jdk21/jdk-21.0.12.1+1'
$env:ANDROID_HOME=Join-Path $root 'local-builds/android-toolchain/sdk'
$env:ANDROID_NDK_HOME=Join-Path $root 'local-builds/android-toolchain/ndk/android-ndk-r27c'
$env:CARGO_HOME=Join-Path $root 'local-builds/rust-toolchain/cargo'
$env:RUSTUP_HOME=Join-Path $root 'local-builds/rust-toolchain/rustup'
$env:Path="$(Join-Path $env:JAVA_HOME 'bin');$(Join-Path $env:CARGO_HOME 'bin');$(Join-Path $env:ANDROID_HOME 'platform-tools');$env:Path"
$sdkProperty=$env:ANDROID_HOME.Replace('\','\\').Replace(':','\:')
"sdk.dir=$sdkProperty" | Set-Content -LiteralPath (Join-Path $root 'android/local.properties') -Encoding ascii
& (Join-Path $root 'scripts/build-android-release.ps1') -SigningDirectory (Join-Path $root '_secrets/android-signing')
if($LASTEXITCODE){throw 'Android release build failed'}

