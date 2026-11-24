# Easy-Slicer Slice-Engine

**Dokumentation für Easy-Slicer by Becker 0.2.0**  
Stand: 9. November 2026

> Diese Dokumentation beschreibt die Nutzung und die lokale HTTP-Schnittstelle
> der Slice-Engine. Sie enthält bewusst **keinen Quellcode, keine internen
> Datenstrukturen und keine Beschreibung der Berechnungsverfahren**. Sie ist
> keine Open-Source-Lizenz, kein SDK-Vertrag und keine Zusage auf eine
> bestimmte G-Code-Qualität.

## Inhalt

1. [Zweck und Abgrenzung](#1-zweck-und-abgrenzung)
2. [Systemvoraussetzungen](#2-systemvoraussetzungen)
3. [Funktionsumfang](#3-funktionsumfang)
4. [Modelle und Koordinaten](#4-modelle-und-koordinaten)
5. [Druckerprofile und Grenzen](#5-druckerprofile-und-grenzen)
6. [Lokale HTTP-Schnittstelle](#6-lokale-http-schnittstelle)
7. [Einstellungsreferenz](#7-einstellungsreferenz)
8. [G-Code, Firmware und Post-Processing](#8-g-code-firmware-und-post-processing)
9. [Grenzen und Qualität](#9-grenzen-und-qualität)
10. [Betrieb und Sicherheit](#10-betrieb-und-sicherheit)
11. [Lizenz und Rechte](#11-lizenz-und-rechte)
12. [Version und Änderungen](#12-version-und-änderungen)

---

## 1. Zweck und Abgrenzung

Die Slice-Engine ist der proprietäre Kern von **Easy-Slicer by Becker**. Sie
wandelt ein Dreiecksnetz, ein Druckerprofil und einen Satz Druckeinstellungen
in druckbaren G-Code, eine Vorschau und eine Material-/Zeitstatistik um.

Die Engine ist in die Windows-Anwendung eingebettet. Es gibt derzeit **kein
separates npm-, Python- oder C-API-SDK**. Die hier dokumentierte Schnittstelle
ist die lokale HTTP-API der Anwendung.

Die Engine ist auf **FDM-Drucker** ausgelegt. Sie ist kein Slicer für
Harzdrucker (SLA/DLP/MSLA), kein CAD-Programm und kein Cloud-Dienst.

**Nicht Bestandteil dieser Dokumentation:**

- Quellcode oder auszugsweise Implementierungen
- interne Datenstrukturen, Dateinamen oder Modulaufbau
- Formeln, Schwellenwerte oder Zwischenschritte der Berechnung
- eine Erlaubnis, die Engine nachzubauen, zu extrahieren oder als eigene
  Bibliothek anzubieten

## 2. Systemvoraussetzungen

| Punkt | Anforderung |
|---|---|
| Betriebssystem | Windows 10/11, x64 |
| Installation | keine; portable EXE |
| Node.js | nicht erforderlich |
| Internet | nicht erforderlich |
| Datenablage | lokal unter `%LOCALAPPDATA%\Easy-Slicer-by-Becker\data` |
| Netzwerk | API ausschließlich über Loopback (`127.0.0.1`/`localhost`) |
| Signatur | Der Build ist unsigniert; SmartScreen kann warnen. |

Die Anwendung startet standardmäßig auf Port **8787**. Ist der Port belegt,
probiert sie die folgenden Ports bis **8796**. Der tatsächlich verwendete Port
steht im Log.

Das Log liegt unter:

```text
%LOCALAPPDATA%\Easy-Slicer-by-Becker\data\logs\easy-slicer.log
```

Für automatisierte lokale Tests kann die Oberfläche unterdrückt werden:

```bat
set KEPLER_NO_BROWSER=1
set PORT=8787
Easy-Slicer-by-Becker.exe
```

`PORT` ist nur der Startport. Die API bleibt in jedem Fall auf Loopback
beschränkt.

## 3. Funktionsumfang

Die Engine deckt die üblichen Arbeitsschritte eines FDM-Slicers ab:

- Schichten aus geschlossenen Dreiecksnetzen
- Außen- und Innenwände, Boden- und Deckschichten
- Füllmuster und Füllgrad
- sequenzieller Objekt-für-Objekt-Druck mit Höhensortierung und Abstandsprüfung
- optionales Arc-Fitting: geeignete geschlossene Konturen als G2/G3
- Brücken und Überhangbereiche
- Stützstrukturen (normal oder Baum) mit Kontaktlagen
- Haftung über Saum (Skirt) oder Brim
- Nahtlage, Wipe und Z-Hop
- Bügeln (Ironing), Fuzzy Skin und Vasenmodus
- Bett-Mesh-Kompensation direkt im G-Code
- Pressure Advance/Linear Advance, Input Shaper, Jerk, Junction Deviation
  und Square Corner Velocity
- Object Labels und Object Exclusion
- eigener Start-, End-, Schicht- und Pause-G-Code
- externes Post-Processing
- Vorschau, Zeit-/Materialstatistik und Warnungen

Die Anwendung bringt **93 Druckerprofile**, **13 Filamentprofile**, **6
Druckplatten** und **7 Düsengrößen** mit. Die Profile sind Daten der Anwendung;
sie sind nicht Teil des proprietären Engine-Codes.

### Mehrfarbdruck

Objekte mit unterschiedlich zugewiesenen Filamenten werden **nacheinander**
gedruckt. An den Wechselstellen steht `M600`; der Drucker muss diesen Befehl
unterstützen. Die Objekte benötigen ausreichend Abstand zueinander, damit der
Druckkopf nicht gegen bereits gedruckte Teile fährt.

Es gibt **keinen automatischen Purge-Tower** und keinen gleichzeitigen
Mehrfarbdruck. Die Farb-/Materialzuweisung erfolgt in der Anwendung und wird
im hochgeladenen Modell gespeichert. Die Slice-API legt diese Zuordnung nicht
selbst an; sie übernimmt sie aus dem Modell. Die optionale
`filaments`-Tabelle liefert nur die Materialwerte je Filament-ID.

### Sequenzieller Druck

Mit `sequentialPrint.enabled` werden mehrere Objekte **vollständig
nacheinander** gedruckt, auch wenn sie dasselbe Filament verwenden. Die
Reihenfolge ist nach der Objekthöhe sortiert (niedrige Teile zuerst), bei
Gleichstand nach Y und X. Vor dem Slicen prüft die Engine den horizontalen
Abstand der platzierten Bounding-Boxen; Saum und Brim werden als Rand
mitgerechnet. Ein zu geringer Abstand bricht den Slice mit einer Meldung ab,
statt kollisionsgefährdeten G-Code zu erzeugen.

Die Prüfung ist bewusst konservativ und ersetzt keine mechanische Kontrolle:
Druckkopfbreite, Portalhöhe, Kabelwege und die tatsächliche Kopfform sind
nicht Teil des Druckerprofils. Der Slice-Bericht weist darauf hin. Bei
unterschiedlichen Filamenten bleibt `M600` zwischen den Objekten aktiv.

### Arc-Fitting

Mit `arcFitting.enabled` prüft die Engine geschlossene Konturen auf Folgen,
die innerhalb von `arcFitting.tolerance` auf einem gemeinsamen Kreis liegen.
Ersetzt wird nur eine Folge von mindestens `arcFitting.minSegments` kurzen
Geraden; sie wird als `G2` (im Uhrzeigersinn) oder `G3` (gegen den
Uhrzeigersinn) mit `I`/`J`-Mittelpunkt und absoluter Extrusion ausgegeben. Die
Vorschau bleibt eine fein aufgelöste Polylinie, die auf dieselbe G-Code-Zeile
verweist.

Nicht umgestellt werden offene Bahnen, die Vasen-Spirale, Scarf-Nähte,
Deckflächentexturen und Pfade mit PA-Rampe, weil dort Z-/Flussänderungen oder
Nahtlücken sonst verfälscht würden. Die Firmware muss G2/G3 unterstützen; bei
unbekannter Firmware die Funktion ausschalten. Ohne Aktivierung bleibt der
G-Code unverändert.

### Brücken

Eine Brücke ist eine ungestützte Füll- oder Deckschichtfläche, die an **zwei
gegenüberliegenden Rändern** von der vorherigen Schicht getragen wird. Liegt
nur die Mitte ohne Auflage, aber ein Ende hängt frei, ist das ein Überhang und
keine Brücke. Die Engine prüft deshalb nicht nur den Mittelpunkt einer Bahn,
sondern sucht auf beiden Seiten einer ungestützten Fläche nach Auflage.

Die Bahnrichtung folgt der kürzeren unterstützten Spanne: Bei einer Lücke
zwischen zwei Türmen liegt sie quer zur Lücke, bei einem Loch in einer Platte
entlang der kürzeren Lochseite. Die Brückenbahn wird um einen **Ankerrand**
in die Auflage verlängert (mindestens 0,6 mm, sonst 1,5 Linienbreiten) und mit
der dichteren Solid-Spacing-Weite gedruckt. Die normale Füllung wird im
Brückenbereich ausgespart, damit keine doppelte Extrusion entsteht.

Fluss und Tempo kommen aus `bridgeFlow`, `speeds.bridge` und
`accelerations.bridge`. Der Anker liegt auf der Auflage, die freie Spanne
dazwischen wird mit dem reduzierten Brückenfluss gedruckt. Die Erkennung ist
konservativ: Einseitig gehaltene Flächen bleiben Überhang; bei sehr
unregelmäßigen Löchern kann eine Brücke ausgelassen werden, statt eine falsche
Richtung zu erzwingen.

## 4. Modelle und Koordinaten

### 4.1 Unterstützte Dateiformate

| Format | Unterstützung | Hinweis |
|---|---|---|
| STL | ASCII und binär | Das Standardformat. |
| 3MF | ja | Auch Mehrplatten-3MF; die gewünschte Platte wird über `plate` gewählt. |
| OBJ | ja | Dreiecksnetze; Materialdaten werden nicht als Druckprofile übernommen. |
| PLY | ja | Dreiecksnetze. |
| STEP | nein | Vorher nach STL/3MF konvertieren. |

Die Datei wird als Rohdatenstrom an `/api/models` gesendet. Der Dateiname
entscheidet über die Erkennung; die maximale Größe beträgt **150 MB**.

### 4.2 Einheiten und Ausrichtung

- Alle Koordinaten und Maße sind in **Millimetern**.
- Die Modelle werden für den Druck auf die Bettmitte gesetzt und mit der
  Unterseite auf `Z = 0` ausgerichtet.
- Die Vorschau verwendet Bettkoordinaten. Der G-Code verwendet den im
  Druckerprofil hinterlegten Nullpunkt: Ecke (typisch Marlin) oder Bettmitte
  (typisch Klipper-Delta).
- Bei Mehrplatten-3MF wird nur die gewählte Platte geslict. Die Plattenlage
  in der Vorschau beeinflusst die G-Code-Koordinaten nicht.

### 4.3 Modellqualität

Die Engine erwartet ein sinnvoll geschlossenes Dreiecksnetz. Offene Kanten,
nicht-manifold Geometrie, doppelte Flächen oder extrem dünne Bereiche können
zu Warnungen, fehlenden Bahnen oder einem unbrauchbaren Ergebnis führen. Eine
automatische Netzreparatur ist nicht Bestandteil der Engine.

### 4.4 Lebensdauer der Modelldaten

Hochgeladene Modelle liegen nur im Arbeitsspeicher der laufenden Anwendung.
Nach einem Neustart ist die `modelId` ungültig; das Modell muss erneut
hochgeladen werden. Es gibt keine dauerhafte Modellbibliothek über die hier
dokumentierte API.

## 5. Druckerprofile und Grenzen

Ein Druckerprofil beschreibt die Maschine. Die wichtigsten Felder sind:

| Feld | Bedeutung |
|---|---|
| `id` | Eindeutige Profilkennung, z. B. `anycubic-vyper`. |
| `name`, `brand` | Anzeigename und Hersteller. |
| `bed.x/y/z` | Bauvolumen in mm. |
| `nozzle` | Standarddüsendurchmesser in mm. |
| `nozzleOptions` | Zulässige Düsendurchmesser. |
| `layerRange` | Zulässiger Bereich für Schichthöhen in mm. |
| `maxPrintSpeed` | Maximale Druckgeschwindigkeit in mm/s. |
| `maxAccel` | Maximale Beschleunigung in mm/s². |
| `maxTravel` | Maximale Verfahrgeschwindigkeit in mm/s. |
| `maxNozzleTemp` | Maximale Düsentemperatur in °C. |
| `maxBedTemp` | Maximale Betttemperatur in °C. |
| `flavor` | Bevorzugter G-Code-Dialekt. |
| `control` | Steuerungsweg: `marlin-serial`, `klipper-moonraker` oder `manual`. |
| `kinematics` | `cartesian`, `corexy` oder `delta`. |
| `coordOrigin` | G-Code-Nullpunkt: `corner` oder `center`. |
| `defaultPlate` | Standard-Druckplatte. |
| `materials` | Vom Hersteller freigegebene Materialklassen, sofern dokumentiert. |
| `ifs` | Angaben zu einer Mehrfarb-Einheit, sofern vorhanden. |

Die vollständige Profilliste und die Standardeinstellungen liefert
`GET /api/catalog`. Ein unbekanntes Profil fällt auf das Standardprofil
zurück; für reproduzierbare Ergebnisse immer eine gültige `profileId` senden.

### Wirksame Grenzen

Die Engine begrenzt Schichthöhen, Düsen, Temperaturen, Geschwindigkeiten,
Beschleunigungen und Verfahrgeschwindigkeiten auf die Werte des Profils.
Die optionalen `limits` im Slice-Request können diese Werksgrenzen bewusst
überschreiben, auch nach oben. Das ist für gemoddete Maschinen gedacht und
verschiebt die Verantwortung für sichere Werte auf den Aufrufer.

## 6. Lokale HTTP-Schnittstelle

### 6.1 Basis-URL und Start

```text
http://127.0.0.1:8787
```

Die API ist nur über Loopback erreichbar. Anfragen mit fremdem `Host`-Header
oder fremdem `Origin` werden mit **403** abgewiesen. Es gibt keine
Benutzeranmeldung, weil der Dienst nicht für mehrere Benutzer oder für ein
Netzwerk gedacht ist.

Der Dienst ist nach dem Start erreichbar, sobald die Oberfläche erscheint.
Ein einfacher Test:

```bash
curl -s http://127.0.0.1:8787/api/health
```

```json
{ "ok": true, "models": 0 }
```

### 6.2 Ablauf

1. Modell mit `POST /api/models` hochladen.
2. Optional Katalog und Standardwerte mit `GET /api/catalog` lesen.
3. Modell mit `POST /api/slice` slicen.
4. G-Code, Statistik und Warnungen aus der Antwort übernehmen.

Die API arbeitet synchron: Die Slice-Antwort kommt erst, wenn der G-Code
fertig ist. Es gibt keinen Streaming- oder Fortschrittsendpunkt für das
Slicen.

### 6.3 Modell hochladen

```http
POST /api/models?name=wuerfel.stl&printerId=anycubic-vyper
Content-Type: application/octet-stream

<Binärdaten>
```

| Query-Parameter | Pflicht | Bedeutung |
|---|---|---|
| `name` | empfohlen | Dateiname inklusive Endung; bestimmt das Format. |
| `printerId` | optional | Wird für die Plattenanordnung bei Mehrplatten-3MF verwendet. |

Beispiel:

```bash
curl -s -X POST \
  "http://127.0.0.1:8787/api/models?name=wuerfel.stl&printerId=anycubic-vyper" \
  -H "Content-Type: application/octet-stream" \
  --data-binary "@wuerfel.stl"
```

Die Antwort enthält unter anderem:

```json
{
  "id": "4d3f0d38-2f0b-4a4e-9d8c-6d9a0f3b7c21",
  "format": "stl",
  "bytes": 684,
  "analysis": {
    "name": "wuerfel.stl",
    "triangles": 12,
    "bbox": {
      "min": { "x": -10, "y": -10, "z": 0 },
      "max": { "x": 10, "y": 10, "z": 20 },
      "size": { "x": 20, "y": 20, "z": 20 }
    },
    "volumeMm3": 8000,
    "surfaceAreaMm2": 2400,
    "overhangRatio": 0,
    "flatTopRatio": 0.17,
    "footprintAreaMm2": 400
  },
  "objects": [{ "id": "3f9a9c2e-0b1a-4f3a-9c2e-0b1a4f3a9c2e", "name": "wuerfel.stl" }],
  "warnings": [],
  "printerHint": null,
  "filamentHint": null,
  "plates": 1
}
```

`id` ist die `modelId` für den Slice-Request. Sie gilt nur für die laufende
Instanz.

### 6.4 Katalog und Standardwerte

```http
GET /api/catalog
```

Die Antwort enthält:

- `printers`: verfügbare Druckerprofile
- `filaments`: Filamentprofile
- `plates`: Druckplatten
- `nozzles`: zulässige Düsengrößen
- `defaults`: vollständige Standardeinstellungen

`defaults` ist der sinnvollste Ausgangspunkt für eigene Clients. Ein leerer
oder unvollständiger `settings`-Block wird mit diesen Werten ergänzt.

### 6.5 Slicen

```http
POST /api/slice
Content-Type: application/json
```

| Feld | Pflicht | Typ | Bedeutung |
|---|---|---|---|
| `modelId` | ja | String | ID aus dem Upload. |
| `profileId` | ja | String | ID aus `GET /api/catalog`. |
| `settings` | nein | Objekt | Teilmenge der Einstellungen; wird mit den Defaults zusammengeführt. |
| `plate` | nein | Zahl | 0-basierte Platte bei Mehrplatten-3MF. Standard: `0`. |
| `flavor` | nein | String | Überschreibt den G-Code-Dialekt des Profils. |
| `limits` | nein | Objekt | Eigene Maschinengrenzen; siehe [Abschnitt 7](#76-maschinen--und-bewegungsgrenzen). |
| `filaments` | nein | Objekt | Werte je Filament-ID für Mehrfarbdruck. |
| `customGcode` | nein | Objekt | Eigener Start-/End-/Schicht-/Pause-G-Code. |
| `postProcessing` | nein | Objekt | Externes Nachbearbeitungsskript. |

`settings` wird nicht als vollständiges neues Objekt interpretiert, sondern
mit den Defaults zusammengeführt. Für reproduzierbare Ergebnisse entweder
`defaults` vollständig übernehmen oder nur die bewusst geänderten Felder
senden.

#### `limits`

```json
{
  "maxPrintSpeed": 300,
  "maxAccel": 5000,
  "maxTravel": 500,
  "maxNozzleTemp": 300,
  "maxBedTemp": 110
}
```

Alle fünf Felder sind optional. Positive Zahlen überschreiben die Werte aus
dem Profil; fehlende oder ungültige Werte fallen auf das Profil zurück.

#### `filaments`

Die Tabelle wird über die Filament-ID adressiert, die einem Objekt zugewiesen
ist. Unterstützt werden:

```json
{
  "pla": {
    "nozzle": 210,
    "bed": 60,
    "flow": 1.0,
    "fanSpeed": 100,
    "maxVolumetricFlow": 12
  }
}
```

Die Werte überschreiben für das jeweilige Objekt die globalen Einstellungen.
Sie werden anschließend erneut durch die Maschinengrenzen begrenzt.

#### `customGcode`

| Feld | Standard | Bedeutung |
|---|---|---|
| `start` | `""` | Startblock; additiv oder als vollständiger Ersatz. |
| `end` | `""` | Endblock; additiv oder als vollständiger Ersatz. |
| `layerChange` | `""` | Wird zu Beginn jeder Schicht eingefügt. `{layer}` und `{z}` werden ersetzt. |
| `pause` | `""` | Wird vor einem Filamentwechsel eingefügt. |
| `fullMachineGcode` | `false` | `true`: `start`/`end` ersetzen die automatischen Blöcke. |

#### `postProcessing`

| Feld | Standard | Bedeutung |
|---|---|---|
| `enabled` | `false` | Schaltet das externe Skript ein. |
| `path` | `""` | Pfad zu einer EXE, BAT/CMD, PS1, Python-Datei oder ausführbaren Datei. |
| `args` | `"{gcode}"` | Argumentvorlage; `{gcode}` wird durch die temporäre Datei ersetzt. |
| `workingDirectory` | `""` | Optionaler Arbeitsordner. |
| `timeoutSeconds` | `120` | Zeitlimit; wird auf 5–600 s begrenzt. |
| `required` | `true` | Bei Fehler den Slice abbrechen. Bei `false` bleibt der unveränderte G-Code erhalten und es entsteht eine Warnung. |

Das Skript erhält eine temporäre G-Code-Datei und darf sie an Ort und Stelle
verändern. Es läuft mit den Rechten des angemeldeten Benutzers. **Nur
vertrauenswürdige Skripte eintragen.**

### 6.6 Antwort

Die Slice-Antwort ist ein JSON-Objekt:

| Feld | Bedeutung |
|---|---|
| `gcode` | Fertiger G-Code als Text. |
| `stats` | Geschätzte Zeit, Filamentlänge, Filamentgewicht, Schichtzahl, Volumen und maximaler Fluss. |
| `features` | Zeit- und Materialanteil je Bahntyp. |
| `warnings` | Liste von Hinweisen; keine Fehler. |
| `sliceMs` | Dauer des Slicens in Millisekunden. |
| `postProcess` | Optional: Informationen zum ausgeführten Post-Processing. |
| `layers` | Vorschaudaten für die mitgelieferte 3D-Ansicht. |
| `preview` | Gleichwertige Kopie von `layers`. |

`stats` enthält:

```json
{
  "estimatedSeconds": 1234,
  "filamentMm": 5678,
  "filamentGrams": 12.3,
  "layerCount": 100,
  "volumeCm3": 10.4,
  "maxFlowMm3s": 8.2
}
```

`features` enthält Einträge wie:

```json
[
  { "kind": "outer-wall", "seconds": 120.5, "grams": 2.4, "percent": 18.7 },
  { "kind": "sparse", "seconds": 310.2, "grams": 7.1, "percent": 48.1 }
]
```

Mögliche Bahntypen sind `outer-wall`, `inner-wall`, `overhang`, `bridge`,
`solid`, `sparse`, `support`, `iron`, `adhesion`, `travel` und `other`.

Die Struktur von `layers`/`preview` ist auf die mitgelieferte Vorschau
abgestimmt und **nicht als stabile Integrationsschnittstelle** gedacht. Für
eigene Auswertungen `gcode`, `stats` und `features` verwenden.

### 6.7 Fehler

| Status | Bedeutung |
|---|---|
| `400` | Ungültige Anfrage, kein druckbares Objekt, unbekannte Platte, Parsefehler oder fehlgeschlagenes Pflicht-Post-Processing. |
| `403` | Anfrage kommt nicht über Loopback oder von einer fremden Origin. |
| `404` | `modelId` unbekannt oder Modell nach einem Neustart nicht mehr vorhanden. |
| `500` | Interner Slice-Fehler. |

Fehlerantworten haben die Form:

```json
{ "error": "Modell nicht gefunden — bitte erneut hochladen." }
```

### 6.8 Vollständiges Beispiel

```bash
# 1. Modell hochladen
MODEL_ID=$(curl -s -X POST \
  "http://127.0.0.1:8787/api/models?name=wuerfel.stl&printerId=anycubic-vyper" \
  -H "Content-Type: application/octet-stream" \
  --data-binary "@wuerfel.stl" | jq -r .id)

# 2. Slicen
curl -s -X POST http://127.0.0.1:8787/api/slice \
  -H "Content-Type: application/json" \
  -d "{
    \"modelId\": \"$MODEL_ID\",
    \"profileId\": \"anycubic-vyper\",
    \"settings\": {
      \"layerHeight\": 0.2,
      \"firstLayerHeight\": 0.24,
      \"walls\": 3,
      \"infillDensity\": 20
    }
  }" > result.json
```

Das Beispiel verwendet `jq`; es ist nicht Voraussetzung für die Anwendung.

## 7. Einstellungsreferenz

Die folgenden Werte sind die Defaults aus dem Katalog. Sie gelten für eine
0,4-mm-Düse und ein typisches PLA-Profil. Druckerprofil und `limits` begrenzen
sie. Filamentwerte (Temperatur, Fluss, Lüfter) müssen im `settings`-Block
übergeben werden; die Slice-API liest kein separates Filamentprofil.

### 7.1 Schicht, Wand und Füllung

| Feld | Standard | Bedeutung |
|---|---:|---|
| `layerHeight` | `0.2` | Ausgangs- bzw. feste Schichthöhe in mm. |
| `firstLayerHeight` | `0.24` | Erste Schichthöhe in mm; bleibt auch bei adaptiver Höhe fest. |
| `adaptiveLayerHeight.enabled` | `false` | Schichthöhe ab Schicht 2 an die Moderneigung anpassen. |
| `adaptiveLayerHeight.minHeight` | `0.08` | Kleinste adaptive Schichthöhe in mm. |
| `adaptiveLayerHeight.maxHeight` | `0.28` | Größte adaptive Schichthöhe in mm, vor allem an steilen Wänden. |
| `adaptiveLayerHeight.quality` | `0.1` | Zulässige sichtbare Treppenabweichung in mm; kleiner = feiner und langsamer. |
| `gapFill.enabled` | `true` | Schmale Restflächen zwischen Wänden als Lückenfüllung drucken. |
| `gapFill.minWidth` | `0.2` | Kleinste zulässige Breite einer Lückenfüllung in mm. |
| `gapFill.maxWidth` | `0.44` | Größte zulässige Breite einer Lückenfüllung in mm; wird auf das 1,5-Fache der Linienbreite begrenzt. |
| `gapFill.flow` | `1.0` | Flussfaktor der Lückenfüllung; wirkt nur auf die variablen Bahnen. |
| `heightRanges[]` | `[]` | Höhenbereiche ab Schicht 2: `{ from, to, label?, patch: { speedFactor?, flow?, lineWidthFactor?, walls?, infillDensity? } }`. Erster passender Bereich gewinnt, `to` ist exklusiv. |
| `lineWidth` | `0.4` | Grundlinienbreite; `0` bedeutet Düsendurchmesser. |
| `firstLayerLineWidth` | `0.5` | Linienbreite der ersten Schicht. |
| `outerWallLineWidth` | `0.42` | Linienbreite der Außenwand. |
| `innerWallLineWidth` | `0.45` | Linienbreite der Innenwände. |
| `topSurfaceLineWidth` | `0.4` | Linienbreite der sichtbaren Deckschicht. |
| `walls` | `3` | Anzahl Wände. |
| `topLayers` | `4` | Anzahl Deckschichten. |
| `bottomLayers` | `3` | Anzahl Bodenschichten. |
| `infillDensity` | `20` | Füllgrad in Prozent. |
| `infillPattern` | `grid` | `lines`, `grid`, `triangles`, `zigzag`, `concentric`, `gyroid`, `honeycomb`, `crosshatch`, `cubic`, `octet`. |
| `infillAngle` | `45` | Grundwinkel der Füllung in Grad. |
| `infillOverlap` | `10` | Überlappung zwischen Füllung und Innenwand in Prozent einer Linienbreite. |
| `alternateExtraWall` | `false` | Zusätzliche Innenwand auf jeder zweiten Schicht. |
| `nozzle` | `0.4` | Düsendurchmesser in mm. |
| `filamentDiameter` | `1.75` | Filamentdurchmesser in mm. |
| `flow` | `1.0` | Globaler Flussfaktor. |
| `maxVolumetricFlow` | `12` | Obergrenze des Volumenstroms in mm³/s. |
| `shrinkage.x/y/z` | `0` | Schrumpfkompensation in Prozent; positive Werte vergrößern das Modell. |

### 7.2 Temperaturen, Geschwindigkeit und Beschleunigung

| Feld | Standard | Bedeutung |
|---|---|---|
| `temps.nozzle` | `210` | Düsentemperatur in °C. |
| `temps.bed` | `60` | Betttemperatur in °C. |
| `temps.firstLayerNozzle` | `215` | Düsentemperatur der ersten Schicht. |
| `temps.firstLayerBed` | `65` | Betttemperatur der ersten Schicht. |
| `speeds.print` | `60` | Grundtempo in mm/s. |
| `speeds.outerWall` | `35` | Außenwand. |
| `speeds.innerWall` | `50` | Innenwand. |
| `speeds.infill` | `60` | Füllung. |
| `speeds.solid` | `50` | Massive Schichten. |
| `speeds.topSurface` | `50` | Sichtbare Deckschicht. |
| `speeds.bridge` | `25` | Brücken. |
| `speeds.support` | `45` | Stützstruktur. |
| `speeds.supportInterface` | `35` | Stütz-Kontaktlage. |
| `speeds.overhang` | `25` | Überhang. |
| `speeds.travel` | `150` | Verfahrgeschwindigkeit. |
| `speeds.firstLayer` | `20` | Erste Schicht. |
| `accelerations.print` | `1000` | Grundbeschleunigung in mm/s². |
| `accelerations.outerWall` | `800` | Außenwand. |
| `accelerations.innerWall` | `1200` | Innenwand. |
| `accelerations.infill` | `1500` | Füllung. |
| `accelerations.solid` | `1000` | Massive Schichten. |
| `accelerations.topSurface` | `900` | Sichtbare Deckschicht. |
| `accelerations.bridge` | `800` | Brücken. |
| `accelerations.support` | `800` | Stützstruktur. |
| `accelerations.supportInterface` | `700` | Stütz-Kontaktlage. |
| `accelerations.travel` | `2000` | Verfahrbewegung. |
| `accelerations.firstLayer` | `800` | Erste Schicht. |
| `retraction.distance` | `0.8` | Rückzugslänge in mm. |
| `retraction.speed` | `40` | Rückzugsgeschwindigkeit in mm/s. |
| `retraction.minTravel` | `2` | Mindestfahrweg für einen Rückzug in mm. |
| `retraction.onLayerChange` | `true` | Rückzug vor dem Schichtwechsel. |
| `zHop` | `0.3` | Anheben der Düse bei Reisen in mm. |
| `cooling.fanOffLayers` | `1` | Lüfter in den ersten Schichten aus. |
| `cooling.minLayerTime` | `0` | Mindestschichtzeit in s. |
| `fanSpeed` | `100` | Lüftergeschwindigkeit in Prozent. |

### 7.3 Haftung, Saum und Brim

| Feld | Standard | Bedeutung |
|---|---|---|
| `adhesion` | `skirt` | `none`, `skirt` oder `brim`. |
| `skirt.loops` | `3` | Anzahl Runden. |
| `skirt.type` | `outer_only` | `outer_only` oder `combined`. |
| `skirt.minLength` | `0` | Kürzere Konturen werden nicht umfahren. |
| `skirt.distance` | `4` | Abstand zum Bauteil in mm. |
| `skirt.startAngle` | `-135` | Startpunkt in Grad. |
| `skirt.speed` | `20` | Geschwindigkeit in mm/s. |
| `skirt.layers` | `1` | Anzahl Schichten mit Saum. |
| `skirt.draftShield` | `false` | Zusätzliche Schutzwand um das Bauteil. |
| `brim.type` | `outer_only` | `outer_only`, `inner_only` oder `combined`. |
| `brim.width` | `5` | Gesamtbreite in mm. |
| `brim.gap` | `0.1` | Abstand zum Bauteil in mm. |
| `brim.flow` | `1.0` | Fluss relativ zum normalen Fluss. |
| `primeLine.enabled` | `true` | Düsenreinigungslinie vor dem Druck. |
| `primeLine.length` | `60` | Gewünschte Länge in mm. |
| `primeLine.speed` | `20` | Geschwindigkeit in mm/s. |

### 7.4 Stützstrukturen

| Feld | Standard | Bedeutung |
|---|---|---|
| `support.kind` | `none` | `none`, `normal` oder `tree`. |
| `support.threshold` | `50` | Überhangwinkel ab dem gestützt wird, in Grad zur Senkrechten. |
| `support.density` | `15` | Dichte der Stützfüllung in Prozent. |
| `support.pattern` | `grid` | `grid`, `lines` oder `zigzag`. |
| `support.interfaceLayers` | `3` | Verdichtete Kontaktlagen. |
| `support.interfaceDensity` | `80` | Dichte der Kontaktlagen in Prozent. |
| `support.zDistance` | `0.2` | Abstand zwischen Stützspitze und Bauteil in mm. |
| `support.xyDistance` | `0.7` | Seitlicher Abstand zum Bauteil in mm. |
| `support.branchAngle` | `30` | Aufweitung von Baumstützen nach unten in Grad; die Aufweitung wird je tatsächlicher Schichthöhe angewendet. |
| `support.interfacePattern` | `grid` | Muster der Kontaktlage. |

`support.zDistance` wird gegen die tatsächlichen Schichtoberkanten geprüft; die Stützspitze ist die höchste Lage, deren Abstand zur Überhangunterseite den Wert erreicht. `interfaceLayers` sind die obersten tatsächlichen Stützlagen. Bei adaptiver Schichthöhe werden weder der Z-Abstand noch die Kontaktlagen oder die Baumaufweitung aus einem Mittelwert abgeleitet.

`support.pattern` wird für den Stützkörper tatsächlich als gewähltes Muster ausgegeben: `grid` kreuzt zwei Richtungen, `lines` spart Material und `zigzag` verbindet die Bahnen. `support.interfacePattern` gilt separat für die verdichteten Kontaktlagen; `support.interfaceDensity` bestimmt deren Dichte. Der XY-Abstand vergrößert den Stützfuß und hält ihn von der Bauteilwand frei; der Z-Abstand bleibt eine physikalische Höhe über der tatsächlichen Schichtoberkante.

Bei sehr schmalen Überhängen kann ein Muster zwischen seinen regulären Linien liegen. Dann legt die Engine eine engere Querlinie quer zur längeren Bounding-Box-Achse, statt die Stütze leer zu lassen. Baumspitzen, die beim Verrunden verschwinden würden, fallen auf die ursprüngliche Überhangfläche zurück und bleiben gestützt.

### 7.5 Oberfläche und Naht

| Feld | Standard | Bedeutung |
|---|---|---|
| `seam.position` | `rear` | `nearest`, `aligned`, `rear` oder `random`. |
| `seam.gap` | `0` | Spalt an der Naht in mm. |
| `seam.wipe` | `false` | Wipe beim Rückzug. |
| `seam.scarf.enabled` | `false` | Scarf-Naht an geschlossenen Außenwänden ab Schicht 2; im Vasenmodus aus. |
| `seam.scarf.length` | `20` | Horizontale Länge der Z-/Flussrampe in mm; 0 schaltet sie ab. |
| `seam.scarf.startHeight` | `15` | Starthöhe der Rampe in Prozent der Schichthöhe über der vorherigen Schicht. |
| `seam.scarf.steps` | `10` | Mindestanzahl der Stützpunkte für die Rampe. |
| `seam.scarf.flow` | `1.0` | Zusätzlicher Flussfaktor im Scarf-Bereich; die wirksame Schichthöhe wird separat berücksichtigt. |
| `seam.scarf.innerWalls` | `false` | Scarf-Rampe zusätzlich an Innenwänden. |
| `fuzzySkin.mode` | `off` | `off`, `external` oder `all`. |
| `fuzzySkin.pattern` | `noise` | `noise`, `stone`, `stone-blocks`, `wood-grain`, `wood-rings`, `bark`, `hammered`, `knurl`, `ripple`, `marble`, `concrete`, `leather`, `basket` oder `rubble`. |
| `fuzzySkin.thickness` | `0.3` | Gesamte Auslenkung in mm (etwa ±`thickness / 2`). |
| `fuzzySkin.scale` | `3` | Merkmalsgröße des Musters in mm. |
| `fuzzySkin.angle` | `0` | Richtung des Musters in Grad; 0 = X, 90 = Y. |
| `fuzzySkin.pointDistance` | `0.8` | Maximaler Abstand der Stützpunkte in mm; lange Wände werden dafür aufgeteilt. |
| `ironing.enabled` | `false` | Bügeln der Oberfläche. |
| `ironing.flow` | `0.12` | Fluss beim Bügeln. |
| `ironing.speed` | `25` | Geschwindigkeit in mm/s. |
| `ironing.spacing` | `0.12` | Bahnabstand in mm. |
| `ironing.inset` | `0` | Abstand der Bahnen zur Wand in mm. |
| `ironing.angle` | `45` | Winkel der Bügelbahnen in Grad. |
| `ironing.type` | `top` | `top` oder `solid`. |
| `ironing.pattern` | `lines` | `lines`, `grid` oder `concentric`. |
| `topSurfaceFlow` | `1.0` | Fluss der obersten Sichtfläche. |
| `bridgeFlow` | `0.9` | Fluss für Brücken. |
| `special.vase` | `false` | Einwandiger Vasenmodus ohne Füllung und Deckschichten. |

### 7.6 Maschinen- und Bewegungsgrenzen

Diese Felder können im Slice-Request unter `limits` gesetzt werden. Sie
überschreiben die Werkswerte des Profils.

| Feld | Bedeutung |
|---|---|
| `maxPrintSpeed` | Obergrenze für Druckgeschwindigkeiten in mm/s. |
| `maxAccel` | Obergrenze für Beschleunigungen in mm/s². |
| `maxTravel` | Obergrenze für Verfahrgeschwindigkeiten in mm/s. |
| `maxNozzleTemp` | Obergrenze der Düsentemperatur in °C. |
| `maxBedTemp` | Obergrenze der Betttemperatur in °C. |

### 7.7 Druckreihenfolge und Ausgabe

| Feld | Standard | Bedeutung |
|---|---|---|
| `printOrder.walls` | `inner-first` | `inner-first` oder `outer-first`. |
| `printOrder.layer` | `walls-first` | `walls-first` oder `infill-first`. |
| `printOrder.paths` | `shortest` | `shortest` oder `generated`. |
| `sequentialPrint.enabled` | `false` | Objekte vollständig nacheinander drucken; niedrige zuerst. |
| `sequentialPrint.clearance` | `5` | Mindestabstand der Objekt-Bounding-Boxen in mm; Saum/Brim zählen mit. |
| `arcFitting.enabled` | `false` | Geeignete geschlossene Konturen als G2/G3 ausgeben. |
| `arcFitting.tolerance` | `0.05` | Größte radiale Abweichung eines ersetzten Punkts vom Kreis in mm. |
| `arcFitting.minSegments` | `4` | Mindestanzahl kurzer Geraden, die ein Bogen ersetzt. |
| `roleGcode.outerWall` | `""` | G-Code vor der ersten Außenwand je Schicht. |
| `roleGcode.innerWall` | `""` | G-Code vor der ersten Innenwand je Schicht. |
| `roleGcode.solid` | `""` | G-Code vor massiven Bahnen. |
| `roleGcode.sparse` | `""` | G-Code vor der Füllung. |
| `roleGcode.support` | `""` | G-Code vor Stützbahnen. |
| `roleGcode.bridge` | `""` | G-Code vor Brücken. |
| `roleGcode.iron` | `""` | G-Code vor Bügelbahnen. |
| `roleGcode.adhesion` | `""` | G-Code vor Saum/Brim. |
| `output.objectLabels` | `true` | Objektnamen als Kommentare und Objektgrenzen. |
| `output.verbosePaths` | `false` | Bahntyp vor der ersten Bahn als Kommentar. |
| `output.reduceInfillRetraction` | `false` | Rückzug bei Reisen innerhalb der Füllung halbieren. |
| `output.lineNumbers` | `false` | `N`-Nummern vor G-Code-Befehle setzen. |
| `output.excludeObjects` | `false` | Firmware-Marker für Object Exclusion. |
| `output.filenameFormat` | `{input_filename_base}_{filament_type[0]}_{print_time}.gcode` | Vorschlag für den Dateinamen. |

### 7.8 Bett-Mesh und Bewegungssteuerung

| Feld | Standard | Bedeutung |
|---|---|---|
| `meshCompensation` | `software` | `off` oder `software`; das Mesh wird in den G-Code eingerechnet. |
| `adaptiveMesh.enabled` | `true` | Nur den Modellbereich vor dem Druck messen. |
| `adaptiveMesh.margin` | `10` | Rand um das Modell in mm. |
| `adaptiveMesh.grid` | `5` | Rasterweite. |
| `autoZ.enabled` | `false` | Z-Offset gegen eine Referenz nachführen. |
| `autoZ.samples` | `3` | Anzahl Messungen. |
| `pressureAdvance.enabled` | `false` | Pressure/Linear Advance aktivieren. |
| `pressureAdvance.value` | `0.04` | Advance-Wert. |
| `inputShaper.enabled` | `false` | Input Shaper aktivieren. |
| `inputShaper.freqX` | `40` | Frequenz X in Hz. |
| `inputShaper.freqY` | `40` | Frequenz Y in Hz. |
| `inputShaper.damping` | `0.1` | Dämpfung. |
| `classicJerk.enabled` | `false` | Classic Jerk aktivieren. |
| `classicJerk.x/y/z/e` | `8 / 8 / 0.4 / 5` | Jerk-Werte. |
| `junctionDeviation.enabled` | `false` | Junction Deviation aktivieren. |
| `junctionDeviation.value` | `0.01` | Wert in mm. |
| `squareCornerVelocity.enabled` | `false` | Square Corner Velocity aktivieren. |
| `squareCornerVelocity.value` | `5` | Wert in mm/s. |
| `pressureAdvanceRamp.enabled` | `false` | Rampe für den PA-Linientest; im normalen Druck aus. |
| `pressureAdvanceRamp.from/to` | `0 / 0.1` | Start- und Endwert. |
| `pressureAdvanceRamp.startX/endX` | `0 / 200` | X-Bereich in mm. |

## 8. G-Code, Firmware und Post-Processing

### 8.1 Firmware-Dialekte

| ID | Anzeigename | Typische Befehle |
|---|---|---|
| `marlin` | Marlin (Legacy) | `M900`, `M205`, `M486` |
| `marlin2` | Marlin 2 | `M900`, `M205`, `M593`, `M486` |
| `klipper` | Klipper | `SET_PRESSURE_ADVANCE`, `SET_INPUT_SHAPER`, `SET_VELOCITY_LIMIT`, `EXCLUDE_OBJECT` |
| `reprapfirmware` | RepRapFirmware | `M566`, `M572`, `M593` |
| `repetier` | Repetier | `M233`, `M204`, `M205` |

Der Dialekt wird aus dem Druckerprofil übernommen und kann im Request mit
`flavor` überschrieben werden. Die erzeugten Befehle müssen zur installierten
Firmware passen. Ein Dialekt ist keine Garantie dafür, dass eine bestimmte
Firmware-Version jeden Befehl unterstützt.

### 8.2 Start, Ende und Schichtwechsel

Ohne eigenen G-Code erzeugt die Engine passende Start- und Endblöcke für den
gewählten Dialekt. Mit `customGcode` lassen sich diese Blöcke ergänzen oder
vollständig ersetzen:

- `start` und `end` werden standardmäßig **zusätzlich** eingefügt.
- Mit `fullMachineGcode: true` ersetzen sie die automatischen Blöcke.
- `layerChange` wird zu Beginn jeder Schicht eingefügt; `{layer}` und `{z}`
  werden ersetzt.
- `pause` wird vor einem Filamentwechsel eingefügt.

Eigener G-Code wird nicht auf Syntax oder Sicherheit geprüft. Falsche
Temperaturen, Achsgrenzen oder Befehle können den Drucker beschädigen.

### 8.3 Post-Processing

Ein Post-Processing-Skript bekommt eine temporäre G-Code-Datei und kann sie
verändern. Unterstützt werden unter Windows insbesondere:

- ausführbare Dateien (`.exe`)
- Batchdateien (`.bat`, `.cmd`)
- PowerShell (`.ps1`)
- Python (`.py`; sucht `py -3`, `python`, `python3`)
- direkt ausführbare Programme

Das Skript läuft ohne interaktive Shell; Batchdateien werden über `cmd.exe`
gestartet. Es unterliegt einem harten Timeout und läuft mit den Rechten des
angemeldeten Benutzers. Bei `required: false` bleibt der Original-G-Code
erhalten, wenn das Skript fehlschlägt; die Antwort enthält dann eine Warnung.

Nach erfolgreichem Post-Processing beschreiben `stats`, `features` und
`layers` weiterhin den **G-Code vor** der Nachbearbeitung. Die Antwort enthält
deshalb zusätzlich eine Warnung. Wer die veränderten Werte benötigt, muss den
zurückgegebenen G-Code selbst neu analysieren.

## 9. Grenzen und Qualität

- **Schichtzahl:** maximal 2000 Schichten. Wird die Grenze erreicht, enthält
  die Antwort eine Warnung; die Schichtzahl wird begrenzt.
- **Modellgröße:** maximal 150 MB pro Upload.
- **JSON-Größe:** maximal 16 MB pro Anfrage.
- **Netzqualität:** keine automatische Reparatur von offenen oder
  nicht-manifold Netzen.
- **Dünne Bereiche:** können ganz oder teilweise entfallen; die Engine meldet
  solche Fälle als Warnung, wenn sie erkannt werden.
- **Mehrfarbdruck:** sequenziell über `M600`; kein Purge-Tower, keine
  gleichzeitige Materialzufuhr.
- **Sequenzieller Druck:** Objekt-für-Objekt mit Höhensortierung und
  Abstandsprüfung; Kopfform und Portalhöhe müssen am Drucker geprüft werden.
- **Arc-Fitting:** nur geschlossene Konturen ohne Scarf-, Textur- und
  Vasen-Spirale. Die Firmware muss G2/G3 unterstützen; bei einer unbekannten
  Firmware die Funktion ausschalten.
- **Vasenmodus:** einwandig ohne Füllung und Deckschichten; kein
  spiralförmiger Z-Hub.
- **Baumstützen:** verfügbar, aber nicht mit jedem anderen Slicer
  deckungsgleich.
- **Harzdruck:** nicht unterstützt.
- **STEP:** nicht unterstützt.
- **G-Code-Qualität:** hängt von Modell, Profil, Mechanik, Filament und
  Kalibrierung ab. Vor jedem Druck den G-Code prüfen und den ersten Druck
  beaufsichtigen.

Warnungen sind Teil der Antwort und sollten nicht ignoriert werden. Sie
können auf fehlendes Bett-Mesh, begrenzte Schichtzahl, ausgelassene dünne
Bereiche, Mehrfarbdruck oder Post-Processing hinweisen.

## 10. Betrieb und Sicherheit

- Die API lauscht ausschließlich auf Loopback. Sie ist **kein Netzwerkdienst**
  und darf nicht über einen Reverse Proxy, Portforwarding oder eine
  Firewall-Freigabe exponiert werden.
- Es gibt keine Benutzerverwaltung und keine API-Schlüssel. Der Schutz beruht
  auf der lokalen Bindung und der Prüfung von `Host` und `Origin`.
- Post-Processing führt lokale Programme aus. Nur geprüfte Skripte verwenden.
- Modelldateien werden von einem Parser verarbeitet, nicht in einer Sandbox
  ausgeführt. Nur vertrauenswürdige Dateien laden.
- Die Anwendung schreibt Daten lokal. Es gibt keine Cloud-Synchronisierung
  und keinen Upload an einen Server.
- Der Build ist unsigniert. Windows SmartScreen kann beim Start warnen.

## 11. Lizenz und Rechte

Easy-Slicer by Becker und die Slice-Engine sind **proprietär**. Es gilt die
Lizenz im Projekt (`LICENSE`); für die Engine gilt zusätzlich der gesonderte
Schutzvermerk `LICENSE-SLICE-ENGINE.md`.

Diese Dokumentation:

- darf als Referenz gelesen und verlinkt werden;
- enthält **keinen Quellcode** und **keine Implementierungsdetails**;
- gewährt **keine Lizenz** an der Engine, am Quellcode, an internen Verfahren
  oder an einer Weiterverwendung als Bibliothek;
- ist kein Angebot, die Engine nachzubauen, zu extrahieren, zu decompilieren
  oder für ein anderes Produkt zu verwenden.

Copyright © 2026 Michael Becker. Alle Rechte vorbehalten.

## 12. Version und Änderungen

| Punkt | Wert |
|---|---|
| Produkt | Easy-Slicer by Becker |
| Dokumentierte Version | 0.2.0 |
| Stand | 9. November 2026 |
| Plattform | Windows x64, portable |
| Engine | proprietär, Quellcode nicht öffentlich |

Diese Dokumentation beschreibt den Stand des Builds 0.2.0. Schnittstellen,
Standardwerte und Profildaten können sich in späteren Versionen ändern. Es
gibt derzeit keine Zusage auf Rückwärtskompatibilität der HTTP-API.

---

**Hinweis:** Diese Datei ist die öffentliche Dokumentation der Slice-Engine.
Sie ersetzt keine Lizenzdatei und keine rechtliche Beratung.
