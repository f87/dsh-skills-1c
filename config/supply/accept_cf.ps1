param(
    [string]$Exe = '',
    # проверяемый файл конфигурации
    [Parameter(Mandatory)][string]$Cf,
    # чистая база для контрольной загрузки (существующая удаляется с -Force)
    [Parameter(Mandatory)][string]$Ib,
    # куда выгружать дерево после загрузки; по умолчанию <LogDir>\dump_<Tag>
    [string]$Dump = '',
    [string]$LogDir = '',
    [string]$Tag = 'accept',
    # JSON-отчёт; по умолчанию <LogDir>\<Tag>.acceptance.json
    [string]$Report = '',
    # эталонное дерево (принятая выгрузка), с которым сверяется результат
    [string]$Baseline = '',
    # либо готовая карта хэшей эталона (config\hash.js)
    [string]$BaselineHashes = '',
    # ожидаемый .bin (например, собранный сборщиком) — сверка SHA1 после цикла
    [string]$ExpectedBin = '',
    # явно допустимые отличия от эталона: маски относительных путей ('Catalogs/*/Ext/Predefined.xml')
    [string[]]$Allow = @(),
    [switch]$SkipCheckModules,
    [switch]$Force
)
<#
.SYNOPSIS
Приёмка .cf «полным циклом»: чистая база → LoadCfg → CheckModules → DumpConfigToFiles → сверки.

Проверяет то, что не видно по коду возврата LoadCfg:
  * сообщения загрузки по классам (ожидание: 0 любого класса);
  * синтаксис модулей (CheckModules -ThinClient -Server);
  * структуру поддержки после цикла: число поставок, флаги, копии *.cf и их SHA1;
  * Ext\ParentConfigurations.bin после цикла — байт-в-байт равен загруженному (и -ExpectedBin);
  * дерево после цикла совпадает с эталоном, кроме .bin, ConfigDumpInfo.xml и копий *.cf.

Универсально: пути — аргументами. Проверено на 8.3.27.1859, 28.10.2026.
Коды возврата: 0 — приёмка пройдена; 10–14 — отказ на шаге; 20 — шаги прошли, но сверка не сошлась.
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

# маски допустимых отличий: поддерживаем и массив, и строку с запятыми (powershell -File передаёт строки)
$allowPatterns = @($Allow | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($allowPatterns.Count -gt 0) { Write-Host ('допустимые отличия (-Allow): ' + ($allowPatterns -join '; ')) }

$exe = Resolve-Exe $Exe
$cfFull = (Resolve-Path -LiteralPath $Cf).Path
$ibFull = [IO.Path]::GetFullPath($Ib)
if (-not $LogDir) { $LogDir = Join-Path (Get-Location).Path 'logs' }
$LogDir = [IO.Path]::GetFullPath($LogDir)
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
if (-not $Dump) { $Dump = Join-Path $LogDir ("dump_{0}" -f $Tag) }
$dumpFull = [IO.Path]::GetFullPath($Dump)
if (-not $Report) { $Report = Join-Path $LogDir ("{0}.acceptance.json" -f $Tag) }
$Report = [IO.Path]::GetFullPath($Report)
New-Item -ItemType Directory -Force -Path (Split-Path $Report -Parent) | Out-Null

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

$res = [ordered]@{ cf = $cfFull; tag = $Tag; exe = $exe; step = '' }
$res.cfSize = (Get-Item -LiteralPath $cfFull).Length
$res.cfMd5 = (Get-FileHash -LiteralPath $cfFull -Algorithm MD5).Hash
$res.cfSha1 = (Get-FileHash -LiteralPath $cfFull -Algorithm SHA1).Hash
Write-Host ("cf: {0} Б  MD5 {1}" -f $res.cfSize, $res.cfMd5)

$c = Invoke-1C @('CREATEINFOBASE', "File='$ibFull'") 'create'
$res.create = $c.exit
if ($c.exit -ne 0) { $res.step = 'create'; $res | ConvertTo-Json -Depth 8; exit 10 }

$l = Invoke-1C @('DESIGNER', "/F$ibFull", "/LoadCfg$cfFull") 'loadcfg'
$res.loadcfg = $l.exit
$lines = Read-Log $l.log
$res.loadLogLines = $lines.Count
$res.messageClasses = Get-MessageClasses $lines
$res.loadLogHead = @($lines | Select-Object -First 10)
$res.loadLogTail = @($lines | Select-Object -Last 5)
if ($l.exit -ne 0) { $res.step = 'loadcfg'; $res | ConvertTo-Json -Depth 8; exit 11 }

if (-not $SkipCheckModules) {
    $m = Invoke-1C @('DESIGNER', "/F$ibFull", '/CheckModules', '-ThinClient', '-Server') 'checkmodules'
    $res.checkmodules = $m.exit
    $res.checkmodulesTail = @((Read-Log $m.log) | Select-Object -Last 3)
    if ($m.exit -ne 0) { $res.step = 'checkmodules'; $res | ConvertTo-Json -Depth 8; exit 12 }
}

if (Test-Path -LiteralPath $dumpFull) { Remove-Item -LiteralPath $dumpFull -Recurse -Force }
New-Item -ItemType Directory -Force -Path $dumpFull | Out-Null
$d = Invoke-1C @('DESIGNER', "/F$ibFull", "/DumpConfigToFiles$dumpFull") 'dumpfiles'
$res.dumpfiles = $d.exit
$res.dumpDir = $dumpFull
if ($d.exit -ne 0) { $res.step = 'dumpfiles'; $res | ConvertTo-Json -Depth 8; exit 13 }
$res.dumpFileCount = @(Get-ChildItem -LiteralPath $dumpFull -Recurse -File).Count

# --- состояние поддержки после цикла ---
$binDump = Join-Path $dumpFull 'Ext\ParentConfigurations.bin'
$summaryScript = Join-Path $PSScriptRoot 'bin_summary.js'
if (-not (Test-Path -LiteralPath $binDump)) {
    Write-Host 'ВНИМАНИЕ: в выгрузке нет Ext\ParentConfigurations.bin — конфигурация без поддержки.'
} else {
    $res.binSize = (Get-Item -LiteralPath $binDump).Length
    $res.binSha1 = (Get-FileHash -LiteralPath $binDump -Algorithm SHA1).Hash
    if (Test-Path -LiteralPath $summaryScript) {
        $res.bin = (& node $summaryScript $binDump | ConvertFrom-Json)
    }
    if ($ExpectedBin) {
        if (-not (Test-Path -LiteralPath $ExpectedBin)) { throw "нет -ExpectedBin: $ExpectedBin" }
        $res.expectedBin = [ordered]@{
            path = $ExpectedBin
            sha1 = (Get-FileHash -LiteralPath $ExpectedBin -Algorithm SHA1).Hash
            size = (Get-Item -LiteralPath $ExpectedBin).Length
        }
        $res.binMatchesExpected = ($res.expectedBin.sha1 -eq $res.binSha1)
    }
}

$cps = Join-Path $dumpFull 'Ext\ParentConfigurations'
$res.vendorCopies = @(Get-ChildItem -LiteralPath $cps -File -ErrorAction SilentlyContinue | ForEach-Object {
        [ordered]@{ name = $_.Name; size = $_.Length; sha1 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA1).Hash }
    })

# --- сверка дерева с эталоном ---
$allowedChanged = @('Ext/ParentConfigurations.bin', 'ConfigDumpInfo.xml')
if ($Baseline -or $BaselineHashes) {
    $hashScript = Join-Path (Split-Path $PSScriptRoot -Parent) 'hash.js'
    if (-not (Test-Path -LiteralPath $hashScript)) { throw "не найден $hashScript (нужен для сверки деревьев)" }
    if (-not $BaselineHashes) {
        $baseFull = (Resolve-Path -LiteralPath $Baseline).Path
        $BaselineHashes = Join-Path $LogDir ("{0}.baseline.hashes.json" -f $Tag)
        & node $hashScript $baseFull $BaselineHashes | Out-Null
        $res.baselineTree = $baseFull
    }
    $newHashes = Join-Path $LogDir ("{0}.dump.hashes.json" -f $Tag)
    & node $hashScript $dumpFull $newHashes | Out-Null

    $A = Get-Content -LiteralPath $BaselineHashes -Raw | ConvertFrom-Json
    $B = Get-Content -LiteralPath $newHashes -Raw | ConvertFrom-Json
    $hb = @{}
    foreach ($pr in $B.PSObject.Properties) { $hb[$pr.Name] = $pr.Value }

    $onlyBaseline = New-Object System.Collections.Generic.List[string]
    $changed = New-Object System.Collections.Generic.List[string]
    $copiesAdded = New-Object System.Collections.Generic.List[string]
    $nA = 0
    foreach ($pr in $A.PSObject.Properties) {
        $nA++
        $name = $pr.Name
        if (-not $hb.ContainsKey($name)) { $onlyBaseline.Add($name); continue }
        if ($hb[$name] -eq $pr.Value) { continue }
        if ($name -like 'Ext/ParentConfigurations/*.cf') { $copiesAdded.Add($name); continue }
        $changed.Add($name)
    }
    $onlyDump = New-Object System.Collections.Generic.List[string]
    foreach ($k in $hb.Keys) {
        if ($A.PSObject.Properties[$k]) { continue }
        if ($k -like 'Ext/ParentConfigurations/*.cf') { $copiesAdded.Add($k); continue }
        $onlyDump.Add($k)
    }
    $changedByDesign = @($changed | Where-Object { $allowedChanged -contains $_ })
    $changedByUser = @($changed | Where-Object {
            $p = $_
            $allowedChanged -notcontains $p -and @($allowPatterns | Where-Object { $p -like $_ }).Count -gt 0
        })
    $changedUnexpected = @($changed | Where-Object {
            $p = $_
            $allowedChanged -notcontains $p -and @($allowPatterns | Where-Object { $p -like $_ }).Count -eq 0
        })

    $res.compareBaseline = [ordered]@{
        baselineFiles      = $nA
        dumpFiles          = $hb.Count
        onlyInBaseline     = @($onlyBaseline)
        onlyInDump         = @($onlyDump)
        changedAllowed     = @($changedByDesign) + @($changedByUser)
        changedByDesign    = @($changedByDesign)
        changedAllowedByUser = @($changedByUser)
        changedUnexpected  = $changedUnexpected
        vendorCopiesAdded  = @($copiesAdded)
    }
}

$res.step = 'done'
$res | ConvertTo-Json -Depth 10 | ForEach-Object { [IO.File]::WriteAllText($Report, [string]$_, (New-Object System.Text.UTF8Encoding($false))) }

# --- вердикт ---
$problems = New-Object System.Collections.Generic.List[string]
$errCount = 0
foreach ($k in $res.messageClasses.Keys) { $errCount += $res.messageClasses[$k] }
if ($errCount -gt 0) { $problems.Add("сообщения LoadCfg: $errCount (любое сообщение — не приёмка)") }
if ($res.Contains('checkmodules') -and $res.checkmodules -ne 0) { $problems.Add('CheckModules завершился с ошибкой') }
if ($res.bin) {
    if ($res.bin.count -lt 1) { $problems.Add('в .bin нет поставок') }
    $needCopies = @($res.bin.deliveries | Where-Object { [string]$_.flag -eq '0' })
    foreach ($nd in $needCopies) {
        $found = @($res.vendorCopies | Where-Object { [IO.Path]::GetFileNameWithoutExtension($_.name) -eq $nd.name })
        if (-not $found) { $problems.Add("нет копии .cf поставки «$($nd.name)» (flag=0)") }
    }
}
if ($res.Contains('binMatchesExpected') -and -not $res.binMatchesExpected) {
    $problems.Add("Ext\ParentConfigurations.bin после цикла не равен ожидаемому (-ExpectedBin)")
}
if ($res.compareBaseline) {
    if (@($res.compareBaseline.onlyInBaseline).Count -gt 0) {
        $problems.Add("потеряны файлы эталона: $(@($res.compareBaseline.onlyInBaseline).Count)")
    }
    if (@($res.compareBaseline.changedUnexpected).Count -gt 0) {
        $problems.Add("изменились файлы, которых не должно быть: $(@($res.compareBaseline.changedUnexpected).Count)")
    }
    if (@($res.compareBaseline.onlyInDump).Count -gt 0) {
        $problems.Add("добавлены файлы, которых нет в эталоне: $(@($res.compareBaseline.onlyInDump).Count)")
    }
}

Write-Host ''
Write-Host ("loadcfg exit={0}, строк в логе {1}, checkmodules exit={2}, файлов в выгрузке {3}" -f `
        $res.loadcfg, $res.loadLogLines, $res.checkmodules, $res.dumpFileCount)
if ($res.bin) {
    Write-Host ("bin: {0} Б SHA1 {1} flag={2} count={3} supportGuid={4}" -f `
            $res.bin.size, $res.bin.sha1, $res.bin.flag, $res.bin.count, $res.bin.supportGuid)
    foreach ($dd in $res.bin.deliveries) {
        Write-Host ("  [{0}] {1} {2} / {3} n={4} lv={5}/{6}/{7} flag={8} parent={9}{10}" -f `
                $dd.index, $dd.name, $dd.version, $dd.vendor, $dd.objects, $dd.levels.'0', $dd.levels.'1', $dd.levels.'2',
            $dd.flag, $dd.parentGuid, $(if ($dd.own) { '  ← своя' } else { '' }))
    }
}
foreach ($cp in $res.vendorCopies) { Write-Host ("  копия: {0} {1} Б {2}" -f $cp.name, $cp.size, $cp.sha1) }
if ($res.compareBaseline) {
    Write-Host ("сверка с эталоном: потеряно {0}, изменено допустимо {1}, изменено неожиданно {2}, добавлено {3}" -f `
            @($res.compareBaseline.onlyInBaseline).Count, @($res.compareBaseline.changedAllowed).Count,
        @($res.compareBaseline.changedUnexpected).Count, @($res.compareBaseline.onlyInDump).Count)
    $unexpected = @($res.compareBaseline.changedUnexpected)
    if ($unexpected.Count -gt 0) {
        Write-Host '  изменены неожиданно:'
        foreach ($u in ($unexpected | Select-Object -First 10)) { Write-Host ('   - ' + $u) }
        if ($unexpected.Count -gt 10) { Write-Host ("   … ещё {0}" -f ($unexpected.Count - 10)) }
        Write-Host '  Если это нормализация 1С (свойства по умолчанию, пустые <Group>, <Code/> у предопределённых),'
        Write-Host '  проверьте содержимое глазами и подтвердите маской -Allow; иначе — дефект сборки.'
    }
}
Write-Host ("отчёт: {0}" -f $Report)

if ($problems.Count -gt 0) {
    Write-Host ''
    Write-Host 'ПРИЁМКА НЕ ПРОЙДЕНА:'
    foreach ($p in $problems) { Write-Host (' - ' + $p) }
    exit 20
}
Write-Host ''
Write-Host 'ПРИЁМКА ПРОЙДЕНА.'
exit 0
