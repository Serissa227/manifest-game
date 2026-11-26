# 打 Windows 安装包（NSIS，需要 PowerShell 7、Rust、Node.js）。
#
# 产物：<cargo 的 target 目录>/release/bundle/nsis/Manifest_<版本>_x64-setup.exe 与同名的 .sha256。
# 安装后的目录里有：
#   manifest-app.exe      桌面程序（前端已嵌在里面）
#   WebView2Loader.dll    GNU 工具链下 WebView2 的加载库，要与 exe 放在一起（MSVC 工具链是静态链接，没有这个文件）
#   data/                 仓库的 data/（程序先找 exe 旁的 data）
#   cache/nav/            预先算好的航线表（没有也能跑，只是第一次打开寰宇要现算几分钟）
#
# 用法（在仓库根目录）：
#   pwsh tools/release/package-installer.ps1
#   可选：-SkipNav（不预算航线表）、-SkipFrontendInstall（沿用已有的 frontend/node_modules）
#
# 打包用的配置在 crates/manifest-app/tauri.bundle.conf.json（只在这里合并进去，平时的 cargo build / test 不受影响）。

param(
    [switch]$SkipNav,
    [switch]$SkipFrontendInstall
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$targetDir = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $repo 'target' }

function Step($name) { Write-Host ("`n==== {0}  {1}" -f (Get-Date -Format 'HH:mm:ss'), $name) }
function Check($what) { if ($LASTEXITCODE -ne 0) { throw "$what 失败（退出码 $LASTEXITCODE）" } }

if (-not $SkipFrontendInstall) {
    Step '前端依赖（npm ci）'
    Push-Location (Join-Path $repo 'frontend')
    try { npm.cmd ci --no-audit --no-fund; Check 'npm ci' } finally { Pop-Location }
}

Step '预算寰宇的航线表（失败不拦打包，只是第一次打开寰宇要现算）'
$navDir = Join-Path $repo 'cache/nav'
New-Item -ItemType Directory -Force $navDir | Out-Null
if (-not $SkipNav) {
    $env:MANIFEST_DATA_DIR = Join-Path $repo 'data'
    $env:MANIFEST_NAV_CACHE_DIR = $navDir
    Push-Location $repo
    try {
        cargo run --release --locked -p manifest-cli -- --world terra16 validate-data
        if (-not (Get-ChildItem $navDir -Filter 'terra16-*.bin' -ErrorAction SilentlyContinue)) {
            cargo run --release --locked -p manifest-cli -- --world terra16 simulate --seed 42 --days 1 | Out-Null
        }
    } catch { Write-Host "航线表预算出错：$_" } finally { Pop-Location }
    $global:LASTEXITCODE = 0
    Remove-Item Env:MANIFEST_DATA_DIR, Env:MANIFEST_NAV_CACHE_DIR
}
$nav = Get-ChildItem $navDir -Filter '*.bin' -ErrorAction SilentlyContinue
if ($nav) { $nav | ForEach-Object { Write-Host ("  {0}  {1:n1} MB" -f $_.Name, ($_.Length / 1MB)) } } else { Write-Host '  没有航线表' }

# GNU 工具链编出来的程序运行时要找 WebView2Loader.dll，Tauri 的打包不会自动带上它：
# 先单独编出带着这个库的依赖，再把库作为一项资源并进打包配置（装到 exe 旁边）。
$configArgs = @('--config', 'tauri.bundle.conf.json')
$hostTriple = ((rustc -vV) | Where-Object { $_ -like 'host: *' }) -replace '^host:\s*', ''
if ($hostTriple -like '*-windows-gnu*') {
    Step 'WebView2 的加载库（GNU 工具链）'
    $arch = if ($hostTriple -like 'x86_64-*') { 'x64' } elseif ($hostTriple -like 'aarch64-*') { 'arm64' } else { 'x86' }
    Push-Location $repo
    try { cargo build --release --locked -p webview2-com-sys; Check '编译 webview2-com-sys' } finally { Pop-Location }
    $dll = Get-ChildItem (Join-Path $targetDir 'release/build') -Directory -Filter 'webview2-com-sys-*' |
        ForEach-Object { Join-Path $_.FullName "out/$arch/WebView2Loader.dll" } |
        Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $dll) { throw '没有找到 WebView2Loader.dll' }
    # 资源路径按通配符解析，统一写成正斜杠
    $dll = (Resolve-Path $dll).Path -replace '\\', '/'
    $extra = Join-Path $targetDir 'tauri.webview2loader.conf.json'
    @{ bundle = @{ resources = @{ $dll = 'WebView2Loader.dll' } } } | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 $extra
    $configArgs += @('--config', $extra)
    Write-Host "  $dll"
}

Step '前端构建、桌面程序与安装包（tauri build）'
$tauri = Join-Path $repo 'frontend/node_modules/.bin/tauri.cmd'
if (-not (Test-Path $tauri)) { throw '没有 frontend/node_modules/.bin/tauri.cmd：先在 frontend/ 下运行 npm ci' }
Push-Location (Join-Path $repo 'crates/manifest-app')
try { & $tauri build @configArgs; Check 'tauri build' } finally { Pop-Location }

Step '完成'
$setup = Get-ChildItem (Join-Path $targetDir 'release/bundle/nsis') -Filter '*-setup.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $setup) { throw '没有找到安装包' }
$hash = (Get-FileHash $setup.FullName -Algorithm SHA256).Hash.ToLower()
"$hash  $($setup.Name)" | Set-Content -Encoding ascii "$($setup.FullName).sha256"
Write-Host ("  {0}（{1:n1} MB）" -f $setup.FullName, ($setup.Length / 1MB))
Write-Host "  SHA256 $hash"
