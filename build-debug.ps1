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
Push-Location $root
try {
    pnpm run mobile:typecheck
    if($LASTEXITCODE){throw 'Mobile typecheck failed'}
    pnpm test
    if($LASTEXITCODE){throw 'Mobile tests failed'}
    pnpm run android:sync
    if($LASTEXITCODE){throw 'Capacitor sync failed'}
    Push-Location android
    try { .\gradlew.bat assembleDebug; if($LASTEXITCODE){throw 'Android debug build failed'} } finally { Pop-Location }
} finally { Pop-Location }

