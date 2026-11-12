# Правка XML-выгрузки: реквизиты, объекты, подсистемы, корень

Универсально для любой конфигурации 8.3. Проверено на 8.3.27.1859; `version="2.20"` — версия формата выгрузки 8.3.27, у другой версии платформы проверяйте фактический атрибут `version` в `Configuration.xml`.
Речь о ручной правке дерева `DumpConfigToFiles` с последующей загрузкой `LoadConfigFromFiles`
(см. [`load-from-xml.md`](load-from-xml.md)).

**Предусловие:** объект, который правите, **не на замке** — снимите поддержку
([`support-state.md`](support-state.md), §4.2–4.3). Иначе 1С считает объект неизменяемым.

---

## 1. Что меняется в дереве

| Действие | Файлы |
|---|---|
| новый реквизит/ресурс/ТЧ, правка типа/подсказки | `<Каталог>\<Объект>.xml` |
| модуль объекта/менеджера | `<Объект>\Ext\ObjectModule.bsl` (правка) или новый файл модуля |
| новый объект | `<Каталог>\<Имя>.xml` + строка в `Configuration.xml` + запись в `ConfigDumpInfo.xml` |
| состав подсистемы | `Subsystems\<Имя>.xml` → `<Content>` |
| свойства корня | `Configuration.xml` → `<Properties>` + уровень `Configuration.<Имя>` в `.bin` |

`Ext\ParentConfigurations.bin` от добавления реквизитов/объектов **не меняется** (они не в поставке).
Меняется только `ConfigDumpInfo.xml`: записи новых элементов и `configVersion`, который 1С пересчитает
при следующей выгрузке (нам его считать не нужно).

---

## 2. Добавление реквизита

Внутри `<ChildObjects>` объекта — новый блок:

```xml
<Attribute uuid="00000000-0000-0000-0000-000000000001">
    <Properties>
        <Name>МойРеквизит</Name>
        <Synonym/>
        <Comment/>
        <Type>
            <v8:Type>xs:string</v8:Type>
            <v8:StringQualifiers>
                <v8:Length>10</v8:Length>
                <v8:AllowedLength>Variable</v8:AllowedLength>
            </v8:StringQualifiers>
        </Type>
        <PasswordMode>false</PasswordMode>
        <Format/>
        <EditFormat/>
        <ToolTip/>
        <MarkNegatives>false</MarkNegatives>
        <Mask/>
        <MultiLine>false</MultiLine>
        <ExtendedEdit>false</ExtendedEdit>
        <MinValue xsi:nil="true"/>
        <MaxValue xsi:nil="true"/>
        <FillFromFillingValue>false</FillFromFillingValue>
        <FillValue xsi:type="xs:string"/>
        <FillChecking>DontCheck</FillChecking>
        <ChoiceFoldersAndItems>Items</ChoiceFoldersAndItems>
        <ChoiceParameterLinks/>
        <ChoiceParameters/>
        <QuickChoice>Auto</QuickChoice>
        <CreateOnInput>Auto</CreateOnInput>
        <ChoiceForm/>
        <LinkByType/>
        <ChoiceHistoryOnInput>Auto</ChoiceHistoryOnInput>
        <Indexing>DontIndex</Indexing>
        <FullTextSearch>Use</FullTextSearch>
        <DataHistory>Use</DataHistory>
    </Properties>
</Attribute>
```

Правила:

1. `uuid` — свежий `[guid]::NewGuid()`, не встречающийся в дереве.
2. Вставлять в **конец группы своего типа** внутри `<ChildObjects>`. Порядок блоков в выгрузке:
   - справочник/документ: `Attribute…` → `Form…` → `TabularSection…` → `Command…`;
   - регистр (сведений/накопления): `Resource…` → `Attribute…` → `Dimension…`.
3. У реквизита **справочника** добавляется `<Use>ForItem</Use>` — строго перед `<Indexing>`.
4. `<FillValue>` — по типу: строка `xsi:type="xs:string"` + значение, число `xs:decimal`,
   дата/ссылка/булево `xsi:nil="true"` (или значение нужного типа).
5. У реквизита нет `InternalInfo` — только `uuid`. `TypeId`/`ValueId` есть только у новых **объектов** (§5).

### Типы

```xml
<!-- число 15,2 -->
<Type><v8:Type>xs:decimal</v8:Type>
  <v8:NumberQualifiers><v8:Digits>15</v8:Digits><v8:FractionDigits>2</v8:FractionDigits>
    <v8:AllowedSign>Any</v8:AllowedSign></v8:NumberQualifiers></Type>

<!-- дата -->
<Type><v8:Type>xs:dateTime</v8:Type>
  <v8:DateQualifiers><v8:DateFractions>Date</v8:DateFractions></v8:DateQualifiers></Type>

<!-- булево -->
<Type><v8:Type>xs:boolean</v8:Type></Type>

<!-- ссылка -->
<Type><v8:Type>cfg:CatalogRef.Номенклатура</v8:Type></Type>

<!-- составной: Строка(10) + Дата -->
<Type>
  <v8:Type>xs:string</v8:Type>
  <v8:Type>xs:dateTime</v8:Type>
  <v8:StringQualifiers><v8:Length>10</v8:Length><v8:AllowedLength>Variable</v8:AllowedLength></v8:StringQualifiers>
  <v8:DateQualifiers><v8:DateFractions>Date</v8:DateFractions></v8:DateQualifiers>
</Type>
```

Составной тип — несколько `<v8:Type>` подряд, затем квалификаторы всех типов (это единственное место,
где 1С пишет несколько `<Type>` в одном блоке).

Ресурс регистра — тот же блок, но `<Resource uuid="…">`; у ресурсов нет `<ChoiceFoldersAndItems>` и `<Use>`.

---

## 3. Изменение существующего элемента

Меняются только нужные значения в `<Properties>` элемента, например у ресурса регистра:

```xml
<Comment>// пример</Comment>            <!-- было <Comment/> -->
<v8:Digits>16</v8:Digits>               <!-- было 15 -->
<v8:FractionDigits>3</v8:FractionDigits><!-- было 2 -->
<FillValue xsi:type="xs:decimal">0</FillValue> <!-- было xsi:nil="true" -->
```

> Смена типа реквизита/ресурса у существующего объекта — это реструктуризация данных. Для типовых объектов
> снимайте их с поддержки осознанно (уровень 2) и предупреждайте пользователя.

---

## 4. Модули

- правка существующего — просто отредактировать `<Объект>\Ext\ObjectModule.bsl` (UTF-8 с BOM);
- новый модуль (например `ManagerModule.bsl`) — создать файл и добавить в `ConfigDumpInfo.xml` запись:

```xml
<Metadata name="InformationRegister.МойРегистр.ManagerModule" id="<uuid объекта>.2"/>
```

Служебные части объекта в `ConfigDumpInfo` имеют `id = <uuid объекта> + "." + суффикс`
(встречались `.0`/`.1` для `Help`, `.2` для `ManagerModule`). Точный суффикс удобно подсмотреть в выгрузке,
где такой модуль уже есть у похожего объекта.

---

## 5. Новый объект

Минимальный набор — файл метаданных, регистрация в составе, запись в реестре.

### 5.1. Файл

`<Каталог>/<Имя>.xml`, где `<Каталог>` — множественное число (`Catalogs`, `Documents`,
`InformationRegisters`, …). Структура:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" … version="2.20">
    <Catalog uuid="…">
        <InternalInfo>
            <xr:GeneratedType name="CatalogObject.МойСправочник" category="Object">
                <xr:TypeId>…</xr:TypeId><xr:ValueId>…</xr:ValueId></xr:GeneratedType>
            <xr:GeneratedType name="CatalogRef.МойСправочник" category="Ref">…</xr:GeneratedType>
            <xr:GeneratedType name="CatalogSelection.МойСправочник" category="Selection">…</xr:GeneratedType>
            <xr:GeneratedType name="CatalogList.МойСправочник" category="List">…</xr:GeneratedType>
            <xr:GeneratedType name="CatalogManager.МойСправочник" category="Manager">…</xr:GeneratedType>
        </InternalInfo>
        <Properties>
            <Name>МойСправочник</Name>
            <Synonym/>
            <Comment/>
            … (полный набор свойств — из файла аналогичного объекта поставки)
        </Properties>
        <ChildObjects/>
    </Catalog>
</MetaDataObject>
```

Проще не изобретать: **скопируйте файл похожего объекта** из этой же выгрузки, замените `<Name>`,
все `uuid`/`TypeId`/`ValueId`, ссылки в `InputByString`, уберите ненужные `ChildObjects`.
Так гарантированно совпадут `version` и набор свойств для вашей платформы.

Все 5 пар `TypeId`/`ValueId` + `uuid` объекта — свежие и уникальные.

### 5.2. Регистрация в составе

`Configuration.xml`, **конец группы своего типа** (порядок групп фиксирован: `Language`, `Subsystem`,
`StyleItem`, …, `Catalog`, `Document`, …; новые объекты 1С дописывает в конец группы, алфавит не восстанавливает):

```xml
<Catalog>МойСправочник</Catalog>
```

### 5.3. Реестр

`ConfigDumpInfo.xml` — запись объекта и его элементов:

```xml
<Metadata name="Catalog.МойСправочник" id="<uuid объекта>" configVersion="<32 hex>00000000">
    <Metadata name="Catalog.МойСправочник.Attribute.МойРеквизит" id="<uuid реквизита>"/>
</Metadata>
```

`configVersion` при ручной сборке — любое уникальное значение из 32 hex + `00000000`; 1С пересчитает.

---

## 6. Подсистема и корень

Состав подсистемы — `<Content>` внутри `<Properties>`:

```xml
<Content>
    <xr:Item xsi:type="xr:MDObjectRef">Catalog.МойСправочник</xr:Item>
</Content>
```

Сама подсистема тоже регистрируется в `Configuration.xml`: `<Subsystem>МояПодсистема</Subsystem>`.

Корень: после правки `Configuration.xml` (состав, свойства) переведите `Configuration.<Имя>` в уровень 1
(`-ObjectName 'Configuration.<Имя>' -Level 1`), иначе корень останется «нередактируемым».
`<Version>` конфигурации не менять — остаётся версия поставки (её использует механизм обновления).

---

## 7. Байтовая точность и чек-лист

1С пишет XML: UTF-8 **с BOM**, CRLF, **без перевода строки в конце файла**. `Set-Content`/`WriteAllLines`
добавляют хвостовой `CRLF` — обрезайте, если сверяете SHA1 до/после.

- [ ] объект снят с замка (уровень 1/2);
- [ ] все новые `uuid`/`TypeId`/`ValueId` уникальны;
- [ ] блок вставлен в правильную группу `<ChildObjects>`;
- [ ] `<Type>`/`<FillValue>` согласованы;
- [ ] XML валиден: `[xml](Get-Content -Raw file.xml)` без ошибок;
- [ ] запись добавлена в `ConfigDumpInfo.xml`;
- [ ] объект зарегистрирован в `Configuration.xml` (если новый) и в `<Content>` подсистемы (если нужно);
- [ ] `LoadConfigFromFiles` → EXIT 0; объект/реквизит видны в Конфигураторе;
- [ ] обратная выгрузка: `Ext\ParentConfigurations.bin` не изменился, дерево совпадает кроме `ConfigDumpInfo.xml`.

Права: новые объекты/реквизиты не появляются в ролях поставщика. Права на свои объекты выдавайте
**отдельными ролями**, роли поставщика не правьте.
