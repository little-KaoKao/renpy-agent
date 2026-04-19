# setup-renpy.ps1
# 幂等脚本:确保 Ren'Py SDK 就位在固定路径 E:\RenPy\renpy-sdk\
#
# 策略:
#   1. 读 .renpy-version 拿目标版本号
#   2. 如果 E:\RenPy\renpy-<version>-sdk\ 存在,只确保 junction renpy-sdk 指向它
#   3. 否则从官方站下载 + 解压到 E:\RenPy\renpy-<version>-sdk\,再建 junction
#
# 用法:
#   pwsh E:\RenPy\scripts\setup-renpy.ps1
#   pwsh E:\RenPy\scripts\setup-renpy.ps1 -Force    # 强制重下

[CmdletBinding()]
param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$VersionFile = Join-Path $Root ".renpy-version"
$JunctionPath = Join-Path $Root "renpy-sdk"

if (-not (Test-Path $VersionFile)) {
    throw "找不到 $VersionFile,请先写入目标版本号(如 8.3.4)"
}

$Version = (Get-Content $VersionFile -Raw).Trim()
$SdkDir = Join-Path $Root "renpy-$Version-sdk"

Write-Host "[setup-renpy] 目标版本: $Version"
Write-Host "[setup-renpy] SDK 目录: $SdkDir"

# --- 1. 下载/解压 SDK ---
if ((Test-Path $SdkDir) -and (-not $Force)) {
    Write-Host "[setup-renpy] SDK 已存在,跳过下载。(加 -Force 可强制重下)"
} else {
    if ($Force -and (Test-Path $SdkDir)) {
        Write-Host "[setup-renpy] -Force 指定,删除旧 SDK..."
        Remove-Item -Recurse -Force $SdkDir
    }

    $ZipName = "renpy-$Version-sdk.zip"
    $ZipPath = Join-Path $env:TEMP $ZipName
    $Url = "https://www.renpy.org/dl/$Version/$ZipName"

    Write-Host "[setup-renpy] 下载 $Url"
    Write-Host "[setup-renpy] (国内网络不稳时,可手动下载 zip 放到 $ZipPath 再重跑)"

    if (-not (Test-Path $ZipPath)) {
        Invoke-WebRequest -Uri $Url -OutFile $ZipPath -UseBasicParsing
    } else {
        Write-Host "[setup-renpy] 发现缓存 zip,复用: $ZipPath"
    }

    Write-Host "[setup-renpy] 解压到 $Root ..."
    Expand-Archive -Path $ZipPath -DestinationPath $Root -Force

    if (-not (Test-Path $SdkDir)) {
        throw "解压后未在 $SdkDir 找到 SDK,请检查 zip 内目录结构"
    }
}

# --- 2. 建立 junction renpy-sdk -> renpy-<version>-sdk ---
if (Test-Path $JunctionPath) {
    $item = Get-Item $JunctionPath -Force
    if ($item.LinkType -eq "Junction") {
        $currentTarget = $item.Target
        if ($currentTarget -eq $SdkDir -or $currentTarget -eq "$SdkDir\") {
            Write-Host "[setup-renpy] junction 已指向正确位置,跳过。"
        } else {
            Write-Host "[setup-renpy] junction 指向 $currentTarget,重建..."
            Remove-Item $JunctionPath -Force
            cmd.exe /c "mklink /J `"$JunctionPath`" `"$SdkDir`"" | Out-Null
        }
    } else {
        throw "$JunctionPath 已存在但不是 junction,请手动处理"
    }
} else {
    Write-Host "[setup-renpy] 创建 junction: $JunctionPath -> $SdkDir"
    cmd.exe /c "mklink /J `"$JunctionPath`" `"$SdkDir`"" | Out-Null
}

# --- 3. 自检 ---
$RenpyExe = Join-Path $JunctionPath "renpy.exe"
if (-not (Test-Path $RenpyExe)) {
    throw "自检失败:$RenpyExe 不存在"
}

Write-Host ""
Write-Host "[setup-renpy] OK. Ren'Py $Version 可用:"
Write-Host "  $RenpyExe <game-path>"
