# Запуск 1cv8.exe: режимы и ключи

## Общий каркас

```
1cv8.exe <РЕЖИМ> [<параметры подключения>] [<ключи>]
```

Параметры подключения:

| Ключ | Значение |
|---|---|
| `/F"<путь>"` | файловая база (каталог с `1Cv8.1CD`) |
| `/S"<сервер>\<база>"` | серверная база (или `Srvr="srv";Ref="base"`) |
| `/N<пользователь>` `/P<пароль>` | аутентификация (если не задана — диалог/текущий пользователь ОС) |

Общие ключи: `/Out"<файл>"` — лог (обязательно), `/DisableStartupDialogs`, `/DisableStartupMessages`,
`/UC<код>` — блокировка соединения, `/RunModeOrdinaryApplication` — обычные формы.

Набор ключей не зависит от билда: подходит любая установленная версия `8.3.27.*` и ниже
(путь к `1cv8.exe` — [`environment.md`](environment.md), раздел «Платформа»).

## Пользовательский режим

```powershell
# открыть базу
& $exe ENTERPRISE /F"<ib>" /N"Пользователь" /P"***" /Out"<лог>" /DisableStartupDialogs

# выполнить внешнюю обработку
& $exe ENTERPRISE /F"<ib>" /Execute"<файл>.epf" /C"параметры" /Out"<лог>"

# выполнить скрипт (только с /Execute и обработкой, поддерживающей параметр)
```

## Конфигуратор

```powershell
# Версия платформы — любая установленная 8.3.27.* (и ниже); путь к exe определяется на машине.
# Как найти установленную платформу — 1cv8/environment.md, раздел «Платформа».
$exe = '<каталог платформы>\bin\1cv8.exe'   # пример: C:\Program Files\1cv8\8.3.27.1859\bin\1cv8.exe

# создать файловую базу
# ВАЖНО: в pwsh 7 форма "File=""<ib>"";" до 1С не доходит — использовать одинарные кавычки
& $exe CREATEINFOBASE "File='<ib>'" /Out"<лог>" /DisableStartupDialogs /DisableStartupMessages

# загрузить .cf / .cfu
& $exe DESIGNER /F"<ib>" /LoadCfg"<файл>.cf" /Out"<лог>" /DisableStartupDialogs /DisableStartupMessages

# обновить конфигурацию БД (после загрузки/изменения)
& $exe DESIGNER /F"<ib>" /UpdateCfg /Out"<лог>" /DisableStartupDialogs /DisableStartupMessages

# выгрузить конфигурацию в .cf
& $exe DESIGNER /F"<ib>" /DumpCfg"<файл>.cf" /Out"<лог>" /DisableStartupDialogs /DisableStartupMessages

# выгрузить в XML-файлы
& $exe DESIGNER /F"<ib>" /DumpConfigToFiles"<каталог>" /Out"<лог>" /DisableStartupDialogs /DisableStartupMessages

# загрузить из XML-файлов
& $exe DESIGNER /F"<ib>" /LoadConfigFromFiles"<каталог>" /Out"<лог>" /DisableStartupDialogs /DisableStartupMessages

# загрузить только перечисленные файлы XML
& $exe DESIGNER /F"<ib>" /LoadConfigFiles -listfile"<список.txt>" /Out"<лог>" /DisableStartupDialogs /DisableStartupMessages

# проверить модули (синтаксис)
& $exe DESIGNER /F"<ib>" /CheckModules -ThinClient -Server /Out"<лог>" /DisableStartupDialogs /DisableStartupMessages   # контексты: config/checkmodules.md

# управление поддержкой
& $exe DESIGNER /F"<ib>" /ManageCfgSupport -disableSupport -force /Out"<лог>"
```

## Подключение к серверной базе

```powershell
& $exe DESIGNER /S"<сервер>\<база>" /N"Администратор" /P"***" /DumpCfg"out.cf" /Out"log.txt"
# либо
& $exe DESIGNER "Srvr=""<сервер>"";Ref=""<база>"";" ...
```

## Возвращаемый код

| Код | Значение |
|---|---|
| 0 | успех |
| 1 | ошибка выполнения (смотреть лог) |
| 101 | `CheckModules` нашёл ошибки компиляции (смотреть лог; запускать с `-ThinClient -Server` — `config/checkmodules.md`) |
| 1 после принудительного завершения | процесс убит (на Windows маркера сигнала нет) |

Запуск из PowerShell:

```powershell
$p = Start-Process -FilePath $exe -ArgumentList $args -Wait -PassThru -NoNewWindow
"exit=$($p.ExitCode)"
```

Для длинных операций (38–49 мин) использовать фоновое задание/`run_in_background`, а не синхронное ожидание.

## Чего нельзя

- Полагаться на stdout: его нет.
- Запускать два процесса на одной файловой базе (блокировка/порча).
- Опускать `/Out`: ошибку не увидите и не докажете результат.
