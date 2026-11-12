<#
.SYNOPSIS
  Состояние поддержки в XML-выгрузке 1С:Предприятие 8.3: просмотр и правка.

.DESCRIPTION
  Универсальный инструмент: не зависит от конкретной конфигурации и каталога проекта.

  Работает с:
    <Tree>\Ext\ParentConfigurations.bin  — список поставок и уровень поддержки каждого объекта
                                           (текст UTF-8 с BOM, одна строка);
    <Tree>\ConfigDumpInfo.xml            — реестр uuid → полное имя объекта (для читаемых имён).

  Модель состояния (подробности — support-state.md):
    Заголовок каждой поставки: флаг «изменения запрещены» (1 — полная поддержка/замок,
    0 — возможность изменения включена), количество объектов.
    Каждый объект поставки — 4 токена: "<уровень>,<режим поставки>,<uuid>,<uuid в поставке>".
      уровень 0 — не редактируется (на замке) = объект на поддержке;
              1 — редактируется с сохранением поддержки;
              2 — снят с поддержки (не поддерживается поставщиком).
      режим   0 — изменения разрешены (типичное значение), 1 — не рекомендуются, 2 — запрещены.

  Объекты, добавленные в конфигурацию самостоятельно, в .bin отсутствуют — для них менять нечего.

.PARAMETER Tree
  Корень XML-выгрузки (каталог с Configuration.xml и ConfigDumpInfo.xml).

.PARAMETER ObjectName
  Полное имя объекта, как в ConfigDumpInfo: "Catalog.Номенклатура",
  "Document.Заказ.Attribute.Комментарий", "InformationRegister.Курсы.Resource.Значение".

.PARAMETER ObjectsFromFile
  Файл со списком имён (по одному в строке, «#» — комментарий) для -Level.

.PARAMETER Level
  Новый уровень: 0 (на поддержке/на замке) | 1 (с сохранением поддержки) | 2 (снят с поддержки).

.PARAMETER EnableChanges
  Включить возможность изменения у конфигурации: флаг 1 → 0 И всем объектам уровень 1 → 0
  (так же, как это делает Конфигуратор; проверено побайтным сравнением с выгрузкой 1С).

.PARAMETER Lock
  Полная поддержка/замок: флаг 0 → 1 И всем объектам уровень 0 → 1.

.PARAMETER All
  Показать все объекты поставки, а не только те, у которых уровень не 0.

.PARAMETER Compare
  Корень второй выгрузки (поставка/эталон). Показать объекты, файлы которых отличаются —
  такие нельзя ставить на поддержку (уровень 0).

.EXAMPLE
  .\support-state.ps1 -Tree .\dump\current

.EXAMPLE
  .\support-state.ps1 -Tree .\dump\current -EnableChanges

.EXAMPLE
  .\support-state.ps1 -Tree .\dump\current -ObjectName 'Catalog.НашСправочник' -Level 2

.EXAMPLE
  .\support-state.ps1 -Tree .\dump\current -ObjectsFromFile .\off-support.txt -Level 1

.EXAMPLE
  .\support-state.ps1 -Tree .\dump\current -Compare .\dump\vendor
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)][string]$Tree,
    [string]$ObjectName,
    [string]$ObjectsFromFile,
    [ValidateSet(0, 1, 2)][int]$Level = -1,
    [switch]$EnableChanges,
    [switch]$Lock,
    [switch]$All,
    [string]$Compare
)

$ErrorActionPreference = 'Stop'
$binPath = Join-Path $Tree 'Ext\ParentConfigurations.bin'
$dciPath = Join-Path $Tree 'ConfigDumpInfo.xml'

if (-not (Test-Path -LiteralPath $binPath)) { throw "Не найден $binPath — это не выгрузка конфигурации или конфигурация без поддержки." }

function Split-Tokens([string]$text) {
    $tokens = New-Object System.Collections.Generic.List[string]
    $sb = New-Object System.Text.StringBuilder
    $inQuotes = $false
    foreach ($ch in $text.ToCharArray()) {
        if ($ch -eq '"') { $inQuotes = -not $inQuotes; [void]$sb.Append($ch); continue }
        if ($ch -eq ',' -and -not $inQuotes) { $tokens.Add($sb.ToString()); [void]$sb.Clear(); continue }
        [void]$sb.Append($ch)
    }
    $tokens.Add($sb.ToString())
    return , $tokens
}

function Unquote([string]$s) {
    if ($s.Length -ge 2 -and $s.StartsWith('"') -and $s.EndsWith('"')) { $s = $s.Substring(1, $s.Length - 2) }
    return $s.Replace('""', '"')
}

function Read-Bin([string]$path) {
    $text = [System.IO.File]::ReadAllText($path)
    $tokens = Split-Tokens $text
    if (($tokens -join ',') -ne $text) { Write-Warning 'Токенизация не воспроизводит файл байт-в-байт — правку лучше не делать.' }
    $count = [int]$tokens[2]
    $deliveries = @()
    $pos = 3
    for ($i = 0; $i -lt $count; $i++) {
        $objects = [int]$tokens[$pos + 6]
        $deliveries += [pscustomobject]@{
            Index      = $i
            Start      = $pos
            FlagIndex  = $pos + 1
            CountIndex = $pos + 6
            ObjStart   = $pos + 7
            Objects    = $objects
            Flag       = [int]$tokens[$pos + 1]
            Name       = Unquote $tokens[$pos + 5]
            Version    = Unquote $tokens[$pos + 3]
            Vendor     = Unquote $tokens[$pos + 4]
        }
        $pos = $pos + 9 + 4 * $objects
    }
    return [pscustomobject]@{ Path = $path; Text = $text; Tokens = $tokens; Deliveries = $deliveries; HeaderFlag = [int]$tokens[1] }
}

function Save-Bin($bin) {
    $text = $bin.Tokens -join ','
    [System.IO.File]::WriteAllText($bin.Path, $text, (New-Object System.Text.UTF8Encoding($true)))
}

function Get-NameMap([string]$path) {
    $map = @{}
    if (-not (Test-Path -LiteralPath $path)) { Write-Warning "Нет $path — имена объектов будут показаны как uuid."; return $map }
    $doc = New-Object System.Xml.XmlDocument
    $doc.Load($path)
    $ns = New-Object System.Xml.XmlNamespaceManager($doc.NameTable)
    $ns.AddNamespace('d', 'http://v8.1c.ru/8.3/xcf/dumpinfo')
    foreach ($m in $doc.SelectNodes('//d:Metadata', $ns)) {
        $id = $m.GetAttribute('id'); $nm = $m.GetAttribute('name')
        if ($id -and $nm -and -not $map.ContainsKey($id)) { $map[$id] = $nm }
    }
    return $map
}

function Get-Objects($bin, $nameMap) {
    $result = New-Object System.Collections.Generic.List[object]
    foreach ($d in $bin.Deliveries) {
        for ($k = 0; $k -lt $d.Objects; $k++) {
            $g = $d.ObjStart + 4 * $k
            $uuid = $bin.Tokens[$g + 2]
            $result.Add([pscustomobject]@{
                Delivery = $d.Index
                Index    = $g
                Level    = [int]$bin.Tokens[$g]
                Mode     = [int]$bin.Tokens[$g + 1]
                Uuid     = $uuid
                Name     = if ($nameMap.ContainsKey($uuid)) { $nameMap[$uuid] } else { "<нет в ConfigDumpInfo: $uuid>" }
            })
        }
    }
    return $result
}

$bin = Read-Bin $binPath
$nameMap = Get-NameMap $dciPath
$objects = Get-Objects $bin $nameMap

# ---------- ПРОСМОТР ----------
if ($ObjectName -and $Level -lt 0 -and -not $EnableChanges -and -not $Lock -and -not $Compare) {
    $o = $objects | Where-Object { $_.Name -eq $ObjectName }
    if (-not $o) { Write-Host "Объект '$ObjectName' отсутствует в ParentConfigurations.bin (свой объект, переименование или опечатка)."; return }
    $o | Format-Table Delivery, Level, Mode, Uuid, Name -AutoSize | Out-String | Write-Host
    return
}

if ($Level -lt 0 -and -not $EnableChanges -and -not $Lock -and -not $Compare) {
    Write-Host "=== $Tree ==="
    foreach ($d in $bin.Deliveries) {
        Write-Host ("поставка {0}: '{1}' {2} от {3}; объектов {4}; изменения {5}" -f `
            $d.Index, $d.Name, $d.Version, $d.Vendor, $d.Objects,
            $(if ($d.Flag -eq 1) { 'ЗАПРЕЩЕНЫ (полная поддержка/замок)' } else { 'разрешены' }))
    }
    $stat = $objects | Group-Object Level | Sort-Object Name
    Write-Host ('уровни: ' + (($stat | ForEach-Object { "$($_.Name)=$($_.Count)" }) -join '  '))
    $sel = if ($All) { $objects } else { $objects | Where-Object { $_.Level -ne 0 } }
    Write-Host ("показано объектов: {0} из {1} (-All — показать все)" -f $sel.Count, $objects.Count)
    $sel | Sort-Object Name | Format-Table Level, Mode, Name -AutoSize | Out-String | Write-Host
    return
}

# ---------- ФЛАГ КОНФИГУРАЦИИ ----------
if ($EnableChanges -or $Lock) {
    $newFlag = if ($Lock) { 1 } else { 0 }
    $from = if ($Lock) { 0 } else { 1 }
    $to = if ($Lock) { 1 } else { 0 }
    if ($PSCmdlet.ShouldProcess($Tree, "флаг 'изменения' -> $newFlag; уровни $from -> $to")) {
        $bin.Tokens[1] = "$newFlag"
        foreach ($d in $bin.Deliveries) { $bin.Tokens[$d.FlagIndex] = "$newFlag" }
        $n = 0
        foreach ($o in $objects) { if ($o.Level -eq $from) { $bin.Tokens[$o.Index] = "$to"; $n++ } }
        Save-Bin $bin
        Write-Host ("Флаг -> {0} ({1}); уровней {2}->{3}: {4}" -f $newFlag,
            $(if ($newFlag -eq 1) { 'изменения запрещены' } else { 'возможность изменения включена' }), $from, $to, $n)
    }
}

# ---------- УРОВНИ ОБЪЕКТОВ ----------
if ($Level -ge 0) {
    $names = @()
    if ($ObjectName) { $names += $ObjectName }
    if ($ObjectsFromFile) {
        $names += Get-Content -LiteralPath $ObjectsFromFile -Encoding UTF8 |
            ForEach-Object { $_.Trim() } | Where-Object { $_ -and -not $_.StartsWith('#') }
    }
    if (-not $names) { throw 'Укажите -ObjectName или -ObjectsFromFile вместе с -Level' }

    $missing = @(); $changed = 0
    foreach ($n in $names) {
        $targets = $objects | Where-Object { $_.Name -eq $n }
        if (-not $targets) { $missing += $n; continue }
        foreach ($t in $targets) {
            if ($t.Level -eq $Level) { continue }
            if ($PSCmdlet.ShouldProcess($Tree, "$n : $($t.Level) -> $Level")) { $bin.Tokens[$t.Index] = "$Level"; $changed++ }
        }
    }
    if ($missing) { Write-Warning ('Нет в поставке (свои объекты/переименования/опечатки): ' + ($missing -join '; ')) }
    if ($changed -gt 0 -and $PSCmdlet.ShouldProcess($Tree, "запись $changed записей")) {
        Save-Bin $bin
        Write-Host "Записано записей: $changed."
        if ($Level -ne 0 -and ($bin.Deliveries | Where-Object { $_.Flag -eq 1 })) {
            Write-Warning 'Флаг конфигурации = 1 (изменения запрещены). Для правки его обычно нужно снять: -EnableChanges.'
        }
        if ($Level -ne 0 -and -not (Test-Path -LiteralPath (Join-Path $Tree 'Ext\ParentConfigurations'))) {
            Write-Warning "Нет каталога 'Ext\ParentConfigurations' с копией .cf поставки: 1С хранит его, когда объекты не на полной поддержке. Возьмите из эталонной выгрузки."
        }
    }
}

# ---------- СРАВНЕНИЕ С ПОСТАВКОЙ ----------
if ($Compare) {
    if (-not (Test-Path -LiteralPath $Compare)) { throw "Не найден $Compare" }
    $tagToDir = @{}
    foreach ($d0 in Get-ChildItem -LiteralPath $Tree -Directory) {
        $sample = Get-ChildItem -LiteralPath $d0.FullName -Filter '*.xml' -File -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($sample) {
            $fs = [System.IO.File]::OpenRead($sample.FullName)
            try {
                $xr = New-Object System.Xml.XmlTextReader($fs)
                while ($xr.Read()) { if ($xr.NodeType -eq 'Element' -and $xr.Depth -ge 1) { $tagToDir[$xr.Name] = $d0.Name; break } }
                $xr.Close()
            } finally { $fs.Dispose() }
        }
    }
    $sha = [System.Security.Cryptography.SHA1]::Create()
    function Get-FileHash1([string]$p) { $fs = [System.IO.File]::OpenRead($p); try { [BitConverter]::ToString($sha.ComputeHash($fs)).Replace('-', '') } finally { $fs.Dispose() } }
    function Get-ObjectFiles([string]$root, [string]$name) {
        $parts = $name -split '\.'
        if ($parts[0] -eq 'Configuration') { return @('Configuration.xml') }
        if (-not $tagToDir.ContainsKey($parts[0])) { return @() }
        $dir = $tagToDir[$parts[0]]
        $list = New-Object System.Collections.Generic.List[string]
        $rel = Join-Path $dir ($parts[1] + '.xml')
        if (Test-Path -LiteralPath (Join-Path $root $rel)) { $list.Add($rel) }
        $sub = Join-Path $dir $parts[1]
        if (Test-Path -LiteralPath (Join-Path $root $sub)) {
            foreach ($f in Get-ChildItem -LiteralPath (Join-Path $root $sub) -Recurse -File) { $list.Add($f.FullName.Substring($root.Length + 1)) }
        }
        return $list
    }
    Write-Host "=== Объекты, отличающиеся от '$Compare' (их нельзя ставить на поддержку) ==="
    $diffs = @(); $total = 0
    foreach ($o in $objects) {
        if ($o.Name -like '*.*.*') { continue }
        $files = @(Get-ObjectFiles $Tree $o.Name)
        if ($files.Count -eq 0) { continue }
        $total++
        $isDiff = $false
        foreach ($rel in $files) {
            $a = Join-Path $Tree $rel; $b = Join-Path $Compare $rel
            if (-not (Test-Path -LiteralPath $b)) { $isDiff = $true; break }
            if ((Get-FileHash1 $a) -ne (Get-FileHash1 $b)) { $isDiff = $true; break }
        }
        if ($isDiff) { $diffs += [pscustomobject]@{ Level = $o.Level; Name = $o.Name } }
    }
    Write-Host ("отличаются: {0} из {1} объектов поставки" -f $diffs.Count, $total)
    $diffs | Sort-Object Name | Format-Table Level, Name -AutoSize | Out-String | Write-Host
}
