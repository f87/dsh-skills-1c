param(
    # путь к 1cv8.exe; по умолчанию — самый свежий установленный в стандартных каталогах
    [string]$Exe = '',
    # дерево конфигурации в файлах (в нём читается Ext\ParentConfigurations.bin)
    [Parameter(Mandatory)][string]$Tree,
    # файловая база, в которую грузим; должна быть пустой (существующая удаляется с -Force)
    [Parameter(Mandatory)][string]$Ib,
    # куда писать логи и сводку; по умолчанию .\logs
    [string]$LogDir = '',
    # префикс имён логов и сводки
    [string]$Tag = 'load',
    # дополнительно прогнать синтаксический контроль модулей
    [switch]$CheckModules,
    # дополнительно выгрузить дерево (что вернула 1С) и сравнить .bin с загруженным
    [switch]$DumpFiles,
    [string]$DumpDir = '',
    # дополнительно собрать .cf из базы
    [string]$CfOut = '',
    # удалить существующую базу, если она не пуста
    [switch]$Force
)
<#
.SYNOPSIS
Загрузка дерева конфигурации в чистую файловую базу с проверкой сообщений и (.bin) поддержки.

Универсально: пути — аргументами, привязки к проекту нет.
Проверено на 8.3.27.1859, 28.10.2026 (две поставки в .bin: загрузка без сообщений,
CheckModules exit 0, .bin после цикла байт-в-байт равен загруженному).

Примеры:
  powershell.exe -NoProfile -File load_tree.ps1 -Tree <tree> -Ib <ib>\ib_load -CheckModules
  powershell.exe -NoProfile -File load_tree.ps1 -Exe '<каталог платформы>\bin\1cv8.exe' `
       -Tree <tree> -Ib <ib>\ib_load -DumpFiles -DumpDir <dump> -CfOut <out.cf> -Force

Коды возврата: 0 — всё запрошенное выполнено, 10/11/12/13/14 — отказ на соответствующем шаге.
#>
$ErrorActionPreference = 'Stop'

function Resolve-Exe([string]$p) {
    if ($p) {
        if (-not (Test-Path -LiteralPath $p)) { throw "1cv8.exe не найден: $p" }
        return (Resolve-Path -LiteralPath $p).Path
    }
    $found = @('C:\Program Files\1cv8', 'C:\Program Files (x86)\1cv8') |
        Where-Object { Test-Path -LiteralPath $_ } |
        ForEach-Object { Get-ChildItem -LiteralPath $_ -Directory } |
        Sort-Object { try { [version]$_.Name } catch { [version]'0.0' } } -Descending |
        ForEach-Object { Join-Path $_.FullName 'bin\1cv8.exe' } |
        Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $found) { throw 'Платформа 1С не найдена: укажите -Exe <путь к 1cv8.exe> (1cv8/environment.md)' }
    return $found
}

$exe = Resolve-Exe $Exe
$treeFull = (Resolve-Path -LiteralPath $Tree).Path
$ibFull = [IO.Path]::GetFullPath($Ib)
if (-not $LogDir) { $LogDir = Join-Path (Get-Location).Path 'logs' }
$LogDir = [IO.Path]::GetFullPath($LogDir)
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

if (Test-Path -LiteralPath $ibFull) {
    $nonEmpty = @(Get-ChildItem -LiteralPath $ibFull -Force -ErrorAction SilentlyContinue)
    if ($nonEmpty.Count -gt 0 -and -not $Force) {
        throw "база уже существует и не пуста: $ibFull (удалите её или добавьте -Force)"
    }
    Remove-Item -LiteralPath $ibFull -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $ibFull | Out-Null

function Invoke-1C([string[]]$argList, [string]$name) {
    $log = Join-Path $LogDir ("{0}.{1}.log" -f $Tag, $name)
    if (Test-Path -LiteralPath $log) { Remove-Item -LiteralPath $log -Force }
    $all = $argList + @('/DisableStartupDialogs', '/DisableStartupMessages', "/Out`"$log`"")
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $p = Start-Process -FilePath $exe -ArgumentList $all -Wait -PassThru -NoNewWindow
    $sw.Stop()
    Write-Host ("{0,-12} exit={1,-3} {2,7:N1} с   {3}" -f $name, $p.ExitCode, $sw.Elapsed.TotalSeconds, $log)
    [pscustomobject]@{ step = $name; exit = $p.ExitCode; sec = [math]::Round($sw.Elapsed.TotalSeconds, 1); log = $log }
}

function Read-Log([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) { return @() }
    return @((Get-Content -LiteralPath $path -Encoding UTF8 -Raw) -split "`r?`n" | Where-Object { $_.Trim() })
}

function Get-MessageClasses([string[]]$lines) {
    $classes = [ordered]@{}
    foreach ($p in @('Неизвестный объект', 'Файл объекта не существует', 'Неверный путь', 'Недопустимый тип',
            'Тип не найден', 'не соответствует', 'Ошибка', 'Предупреждение')) {
        $classes[$p] = @($lines | Where-Object { $_ -like "*$p*" }).Count
    }
    return $classes
}

$res = [ordered]@{ tree = $treeFull; ib = $ibFull; tag = $Tag; exe = $exe; step = '' }

$c = Invoke-1C @('CREATEINFOBASE', "File='$ibFull'") 'create'
$res.create = $c.exit
if ($c.exit -ne 0) { $res.step = 'create'; $res | ConvertTo-Json -Depth 5; exit 10 }

$l = Invoke-1C @('DESIGNER', "/F$ibFull", "/LoadConfigFromFiles$treeFull") 'load'
$res.load = $l.exit
$lines = Read-Log $l.log
$res.loadLogLines = $lines.Count
$res.messageClasses = Get-MessageClasses $lines
$res.loadLogHead = @($lines | Select-Object -First 12)
$res.loadLogTail = @($lines | Select-Object -Last 6)
if ($l.exit -ne 0) { $res.step = 'load'; $res | ConvertTo-Json -Depth 5; exit 11 }

if ($CheckModules) {
    $m = Invoke-1C @('DESIGNER', "/F$ibFull", '/CheckModules', '-ThinClient', '-Server') 'checkmodules'
    $res.checkmodules = $m.exit
    $res.checkmodulesTail = @((Read-Log $m.log) | Select-Object -Last 3)
    if ($m.exit -ne 0) { $res.step = 'checkmodules'; $res | ConvertTo-Json -Depth 5; exit 12 }
}

if ($DumpFiles -or $CfOut) {
    if ($DumpFiles) {
        if (-not $DumpDir) { $DumpDir = Join-Path $LogDir ("dump_{0}" -f $Tag) }
        $dumpFull = [IO.Path]::GetFullPath($DumpDir)
        if (Test-Path -LiteralPath $dumpFull) { Remove-Item -LiteralPath $dumpFull -Recurse -Force }
        New-Item -ItemType Directory -Force -Path $dumpFull | Out-Null
        $d = Invoke-1C @('DESIGNER', "/F$ibFull", "/DumpConfigToFiles$dumpFull") 'dumpfiles'
        $res.dumpfiles = $d.exit
        $res.dumpDir = $dumpFull
        if ($d.exit -ne 0) { $res.step = 'dumpfiles'; $res | ConvertTo-Json -Depth 5; exit 13 }
        $res.dumpFileCount = @(Get-ChildItem -LiteralPath $dumpFull -Recurse -File).Count

        $binDump = Join-Path $dumpFull 'Ext\ParentConfigurations.bin'
        if (Test-Path -LiteralPath $binDump) {
            $res.binAfterCycle = (Get-FileHash -LiteralPath $binDump -Algorithm SHA1).Hash
            $res.binAfterCycleSize = (Get-Item -LiteralPath $binDump).Length
            $summaryScript = Join-Path $PSScriptRoot 'bin_summary.js'
            if (Test-Path -LiteralPath $summaryScript) {
                $res.binAfterCycleStructure = (& node $summaryScript $binDump | ConvertFrom-Json)
            }
        }
        $cps = Join-Path $dumpFull 'Ext\ParentConfigurations'
        $res.vendorCopies = @(Get-ChildItem -LiteralPath $cps -File -ErrorAction SilentlyContinue | ForEach-Object {
                [ordered]@{ name = $_.Name; size = $_.Length; sha1 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA1).Hash }
            })
    }

    if ($CfOut) {
        $cfFull = [IO.Path]::GetFullPath($CfOut)
        New-Item -ItemType Directory -Force -Path (Split-Path $cfFull -Parent) | Out-Null
        if (Test-Path -LiteralPath $cfFull) { Remove-Item -LiteralPath $cfFull -Force }
        $dc = Invoke-1C @('DESIGNER', "/F$ibFull", "/DumpCfg$cfFull") 'dumpcfg'
        $res.dumpcfg = $dc.exit
        if ($dc.exit -ne 0) { $res.step = 'dumpcfg'; $res | ConvertTo-Json -Depth 5; exit 14 }
        $res.cf = $cfFull
        $res.cfSize = (Get-Item -LiteralPath $cfFull).Length
        $res.cfMd5 = (Get-FileHash -LiteralPath $cfFull -Algorithm MD5).Hash
        $res.cfSha1 = (Get-FileHash -LiteralPath $cfFull -Algorithm SHA1).Hash
    }
}

$res.step = 'done'
$jsonPath = Join-Path $LogDir ("{0}.summary.json" -f $Tag)
$res | ConvertTo-Json -Depth 8 | ForEach-Object { [IO.File]::WriteAllText($jsonPath, [string]$_, (New-Object System.Text.UTF8Encoding($false))) }

Write-Host ''
Write-Host ("load: exit={0}, строк в логе {1}" -f $res.load, $res.loadLogLines)
foreach ($k in $res.messageClasses.Keys) {
    if ($res.messageClasses[$k] -gt 0) { Write-Host ("  {0}: {1}" -f $k, $res.messageClasses[$k]) }
}
if ($res.Contains('checkmodules')) { Write-Host ("checkmodules: exit={0}  {1}" -f $res.checkmodules, ($res.checkmodulesTail -join ' ')) }
if ($res.Contains('binAfterCycle')) { Write-Host ("bin после цикла: {0} Б SHA1 {1}" -f $res.binAfterCycleSize, $res.binAfterCycle) }
if ($res.Contains('cf')) { Write-Host ("cf: {0} Б MD5 {1}" -f $res.cfSize, $res.cfMd5) }
Write-Host ("сводка: {0}" -f $jsonPath)
exit 0
