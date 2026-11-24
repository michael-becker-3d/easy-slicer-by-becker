# Easy-Slicer by Becker — Bedienungsanleitung

Stand: 24. November 2026 · Testversion 0.2.0

Diese Anleitung beschreibt die Funktionen der veröffentlichten Testversion. Sie
ist bewusst ausführlich: Du sollst nicht raten müssen, was ein Regler tut.
Gleichzeitig ist das Programm in Entwicklung — wenn etwas anders aussieht als
hier beschrieben, gilt die Oberfläche.

**Zwei Dinge vorweg:**

- **Wir freuen uns über jedes Feedback.** Auch ein „läuft“ hilft, weil es die
  getestete Hardware absteckt. Wie du gut berichtest, steht in Kapitel 17.
- **Farbwechselsysteme brauchen besondere Aufmerksamkeit.** AMS, ACE, CFS, IFS,
  MMU und Verwandte sind der Bereich mit den meisten offenen Fragen. Kapitel 12
  enthält eine eigene Testliste.

---

## Inhalt

1. [Überblick](#1-überblick)
2. [Erster Start](#2-erster-start)
3. [Die Oberfläche](#3-die-oberfläche)
4. [Drucker einrichten](#4-drucker-einrichten)
5. [Werkstück laden](#5-werkstück-laden)
6. [Objekte bearbeiten](#6-objekte-bearbeiten)
7. [Einstellungen](#7-einstellungen)
8. [Slicen und Vorschau](#8-slicen-und-vorschau)
9. [G-Code-Werkstatt](#9-g-code-werkstatt)
10. [Drucken](#10-drucken)
11. [Kalibrieren](#11-kalibrieren)
12. [Mehrfarbig und Farbwechselsysteme](#12-mehrfarbig-und-farbwechselsysteme)
13. [Multiprint](#13-multiprint)
14. [Daten, Profile und Sicherung](#14-daten-profile-und-sicherung)
15. [Tastenkürzel](#15-tastenkürzel)
16. [Problemlösung](#16-problemlösung)
17. [Feedback und Fehlerberichte](#17-feedback-und-fehlerberichte)

---

## 1. Überblick

Easy-Slicer by Becker bereitet 3D-Modelle für den Druck auf. Das Programm läuft
lokal auf deinem Rechner: Modelle werden nicht in eine Cloud geladen, es gibt
keine Konten und keine Telemetrie. Die Oberfläche läuft im Browser, der lokale
Server und die Slice-Engine laufen daneben auf demselben Rechner.

Die wichtigsten Bausteine:

| Baustein | Was er tut |
| --- | --- |
| **Studio** | Modell laden, platzieren, Einstellungen ändern, slicen, Vorschau prüfen |
| **Multiprint** | Mehrere Platten gleichzeitig auf mehrere Drucker verteilen und in eine Warteschlange legen |
| **G-Code** | Vorhandenen G-Code einlesen, prüfen, bearbeiten, konvertieren und in 3D ansehen |
| **Kalibrieren** | Elf geführte Tests mit fertigen Modellen und Wertebereichen |
| **Drucker** | Profile, Verbindung, Steuerung, Bettvermessung, Z-Korrektur, Grenzen, Konsole |

Das Besondere gegenüber einfachen Slicern:

- **Betttisch-Vermessung pro Druckermodell** mit Verlauf, Bewertung und
  Software-Kompensation.
- **Kalibrier-Kreislauf:** Messwerte werden in korrigierte Einstellungen
  umgerechnet — mit Formel, Vorher/Nachher und Begründung.
- **Druckbarkeits-Audit:** 17 Regeln prüfen Modell, Profil und Bett, bevor
  geslict wird.
- **Montage-Assistent:** schlägt Schnittachse, Teilezahl, Verbinder und Passung
  aus Bettmaß, Belastung und Werkstoff vor.
- **Scan-Pipeline:** Fotos oder Video werden zu einem druckbaren Mesh; fertige
  Engine-Ordner lassen sich direkt übernehmen.

## 2. Erster Start

### Starten

1. `Easy-Slicer-by-Becker.exe` starten. Es öffnet sich kein Installationsfenster.
2. Die App startet den lokalen Server (Standardport **8787**) und öffnet die
   Oberfläche im Standardbrowser.
3. Bleibt der Browser leer, öffne `http://127.0.0.1:8787` von Hand.

Die EXE läuft ohne Konsolenfenster. Meldungen stehen im **Protokoll** oben
rechts in der Kopfzeile.

### Beim ersten Start

1. Drucker wählen: Marke und Modell. Bauraum, Kinematik und Grenzen kommen aus
   dem Profil.
2. Material, Druckplatte und Düse prüfen. Diese drei Werte bestimmen Temp.,
   Haftung und Fluss.
3. Wer ohne Drucker ausprobieren will: **Drucker → Verbindung → Simulation**.
   Damit lassen sich alle Abläufe testen, ohne dass ein Gerät angesteuert wird.

### Wo die Daten liegen

| Betrieb | Ordner |
| --- | --- |
| EXE | `%LOCALAPPDATA%\EasySlicerBecker\data` |
| Entwicklung (`npm run dev`) | `data/` im Projektordner |
| eigener Ort | Umgebungsvariable `KEPLER_DATA` |

Dort liegen unter anderem `profiles.json` (eigene Profile und Druckerstände) und
`bedmeshes.json` (Bett-Messungen). Ein Backup ist einfach eine Kopie dieses
Ordners.

### Darstellung

In der Kopfzeile lassen sich Hell/Dunkel und die UI-Größe umschalten. Die
Studio-Ansicht hat zwei Layouts:

- **Klassisch:** Einstellungen links, Vorschläge und Ergebnis rechts.
- **Werkstatt:** Werkstück und Ergebnis links, Einstellungen rechts.

Beide Layouts zeigen dieselben Panels; nur die Anordnung unterscheidet sich.

## 3. Die Oberfläche

### Kopfzeile

- **Bereiche:** Studio, Multiprint, G-Code, Kalibrieren, Drucker.
- **Druckerwechsel:** Klick auf den Druckernamen öffnet die Auswahl. Beim
  Wechsel werden Filament, Platte, Düse und Einstellungen des Geräts geladen;
  Bett-Mesh und Messungen bleiben getrennt.
- **Darstellung:** Hell/Dunkel, UI-Größe, Layout.
- **Protokoll:** zeigt die Servermeldungen. Bei unklaren Fehlern ist das die
  erste Adresse.

### Studio

| Bereich | Inhalt |
| --- | --- |
| **Werkstück** | Datei, Format, Dreiecke, Maße, Objektliste, Export, Profil laden/speichern |
| **Absicht** | Grobes Ziel wählen, statt hunderte Regler einzeln zu stellen |
| **Vorschläge** | Konkrete Änderungen mit Begründung, einzeln oder alle übernehmen |
| **Audit** | Druckbarkeit prüfen: 17 Regeln mit Schwere, Messwert und Fix |
| **Ergebnis** | Zeit, Material, Gewicht, Kosten, Warnungen, Speichern und Senden |
| **Workflow-Leiste** | Laden → Material prüfen → Slicen → G-Code speichern |

### 3D-Ansicht

| Eingabe | Wirkung |
| --- | --- |
| Linke Maustaste ziehen | Ansicht drehen |
| Linke Maustaste klicken | Objekt auswählen (Strg-Klick: mehrere) |
| Rechte Maustaste ziehen | Ansicht verschieben |
| Rechtsklick ohne Ziehen | Objektmenü öffnen |
| Mausrad | Zoomen |
| `I` / `O` | Zoom rein / raus |
| `Strg` + Mausrad | Pinselgröße beim Malen ändern |

## 4. Drucker einrichten

### Meine Drucker

**Drucker → Meine Drucker** listet alle angelegten Geräte. **+ Drucker** öffnet
Marke und Modell. Beim Wechsel wird der komplette Stand des Geräts geladen:
Filament, Platte, Düse, Einstellungen, Bett-Mesh und Messungen.

Ein Druckerprofil enthält unter anderem:

- Bauraum und Kinematik (Bett bewegt sich / Kopf bewegt sich)
- Firmware-Dialekt (Marlin, Marlin 2, Klipper, RepRapFirmware, Repetier)
- Grenzen für Tempo, Beschleunigung, Düsentemperatur und Betttemperatur
- Start-, End-, Schicht- und Pause-G-Code
- Extruder, Rückzug, Z-Hop und Düsenmaterial
- Mehrfachzuführung (Slots) für Mehrfarbdruck

### Verbindung

**Drucker → Verbindung** bietet drei Wege:

| Modus | Wofür |
| --- | --- |
| **Simulation** | Alles ausprobieren, ohne Hardware. Ideal für Tests und Fehlersuche |
| **USB** | Marlin-Drucker über serielle Schnittstelle; Port und Baudrate wählen |
| **Klipper** | Klipper mit Moonraker über das Netz; Adresse des Hosts eintragen |

Die Wahl wird je Drucker gemerkt. Ein Drucker mit Marlin-Profil kann trotzdem
über Klipper angesprochen werden, wenn er mit einem Klipper-Mod läuft — dann
„Klipper“ wählen und die Moonraker-Adresse eintragen.

### Steuerung und Druck

- **Steuerung:** Achsen bewegen, Temperaturen setzen, Lüfter schalten.
- **Druck:** laufender Job, Fortschritt, Pause, Fortsetzen, Abbruch.
- **Konsole:** Firmware direkt ansprechen. Nur verwenden, wenn du weißt, was der
  Befehl tut.

### Bettvermessung

**Drucker → Bettvermessung** misst das Bett in einem Raster und speichert den
Verlauf pro Drucker (maximal zwölf Messungen). Die Bewertung erkennt Streuung,
Wölbung, Sprünge und alte Messungen. Beim Slicen kann das Mesh als
Software-Kompensation in den G-Code wandern.

Zusätzlich lässt sich ein vorhandenes Firmware-Mesh per `M420 V` lesen und
einrechnen. Nach dem Umbau des Bettes oder nach längerer Zeit neu messen.

### Z-Korrektur

**Drucker → Z-Korrektur** verändert den Z-Offset — live während eines Drucks
oder dauerhaft im Profil. Für die erste Schicht ist das der wichtigste Regler.

### Grenzen, G-Code und Prüfsatz

- **Druckergrenzen:** eigene Maximalwerte für Tempo, Beschleunigung, Reisetempo
  und Temperaturen. Sie ersetzen die Werkswerte.
- **G-Code-Prüfsatz:** Start-, End-, Schicht- und Pause-G-Code sowie
  Post-Processing. Platzhalter werden ersetzt; eigener G-Code wird nicht auf
  Syntax geprüft.
- **Eigener G-Code:** hier steht auch der Pause-Block, der vor einem
  Filamentwechsel eingefügt wird.

### Alle Drucker sichern

**Alle Drucker sichern** exportiert die gespeicherten Druckerstände als JSON und
liest sie wieder ein. Vor einem Versionswechsel ist das die einfachste
Sicherung.

## 5. Werkstück laden

### Wege zum Modell

- Datei in das Fenster ziehen.
- Rechtsklick → **Datei → Objekt laden …**
- Rechtsklick → **Datei → Objekt hinzufügen …** (zum vorhandenen Werkstück)
- `Strg + I` importieren, `Strg + N` neues Werkstück

Unterstützt werden **STL, 3MF, OBJ, PLY und GLB**. 3MF mit mehreren Platten
bringt seine Platten mit; jede Platte wird getrennt geslict.

### Maße und winzige Modelle

Nach dem Laden zeigt das Werkstück-Panel Format, Dreiecke und Maße. Ist die
größte Kante kleiner als 5 mm, bietet die App eine Ein-Klick-Skalierung auf
100 mm oder 200 mm an. Das ist vor allem für GLB-Dateien aus Scans wichtig, die
in Metern gespeichert sind. Die Skalierung lässt sich rückgängig machen.

### Formen und Demo-Teile

Das Rechtsklick-Menü enthält fertige Formen in Kategorien (Standard, Praktisch,
Testkörper). Darunter sind einfache Körper (Würfel, Zylinder, Brücke, Turm),
praktische Teile (Kabelklemme, Wandhaken, Schlüsselanhänger, Untersetzer) und
Testkörper (Orca-Würfel, Voron-Würfel, Benchy, Brücke, Turm, Flow-Würfel,
Retract-Turm, Kalibrierungswürfel, Hyperion Skiff X3).

### Lithophan-Lampe

**Datei → Lithophan-Lampe …** macht aus einem Bild einen Lampenschirm. Helligkeit
und Materialdicke bestimmen den Kontrast.

### Scan-Ordner laden

**Datei → Scan-Ordner laden …** liest die Ausgabe von Meshroom, COLMAP, openMVS
oder MicMac. Der Dialog erkennt die Engine, zählt die registrierten Bilder,
bewertet die Mesh-Dateien und warnt vor Punktwolken oder fehlenden dichten
Rekonstruktionen. Ein Klick lädt das gewählte Netz als Werkstück.

Der Ordner wird nur gelesen — nichts wird verändert, hochgeladen oder
umgerechnet.

### Scan starten

**Datei → Scan starten …** nimmt bis zu 80 Fotos oder ein Video bis 60 Sekunden,
lässt ein Rechenprogramm auf einem lokalen **MeshScan-Server** laufen und lädt
das fertige Mesh als Werkstück.

Voraussetzung: Der MeshScan-Server läuft auf `127.0.0.1:8000`. Ist er nicht
erreichbar, meldet der Dialog das klar. Ohne diesen Server funktioniert das
Laden vorhandener Scan-Ordner weiterhin.

## 6. Objekte bearbeiten

### Objektmenü (Rechtsklick)

| Gruppe | Einträge |
| --- | --- |
| **Datei** | Objekt hinzufügen, Objekt laden, Lithophan-Lampe, Scan starten, Scan-Ordner laden |
| **Objekt** | Größe/Position, Text aufbringen, Duplizieren, Löschen, Alles löschen |
| **Anordnen** | Auf Platte legen, Auf Bettmitte zentrieren, Automatisch ausrichten, Alle Objekte anordnen, Zusammenbauen |
| **Bearbeiten** | In Einzelteile trennen, Mesh reparieren, Teilen, Montage-Assistent, Scan-Assistent |
| **Platte** | Platte hinzufügen, Platte löschen |

### Größe und Position

**Größe / Position …** (`M`) öffnet einen Dialog mit X/Y/Z, Drehung und Maßstab.
Änderungen erscheinen live in der Vorschau; **Übernehmen** schreibt sie ins
Modell, **Abbrechen** verwirft sie. Bei gedrehten Objekten rechnet der Dialog in
der lokalen Achse.

### Text aufbringen

**Text aufbringen …** (`T`) legt erhabenen Text auf die Oberseite. Schriftgröße,
Tiefe und Ausrichtung sind einstellbar.

### Teilen und Montage

- **Teilen …** (`C`) zerlegt ein Teil in Stücke mit Verbindern
  (Schwalbenschwanz, Puzzle, Hinterschnitt, Nut/Feder) und Passung.
- **Montage-Assistent …** schlägt aus Bettgröße, Baumaßen, Belastung und
  Werkstoff Schnittachse, Teilezahl, Verbinder und Naht vor. Die Werte lassen
  sich direkt in den Teilen-Dialog übernehmen.

### Reparieren und trennen

- **Mesh reparieren** schließt offene Kanten und Löcher, entfernt doppelte
  Dreiecke und richtet Normalen aus.
- **In Einzelteile trennen** macht aus zusammenhängenden Körpern eigene Objekte.
  Danach lässt sich jedes Teil einzeln bewegen.

### Anordnen

- **Auf Platte legen** (`F`) setzt die Auswahl auf das Bett.
- **Automatisch ausrichten** (`Q`) dreht das Teil auf die größte Auflagefläche.
- **Alle Objekte anordnen** (`A`) verteilt alles ohne Überlappung.
- **Zusammenbauen** (`Y` / `B`) verbindet markierte Teile zu einem Objekt.

### Platten

Bis zu 32 Platten sind möglich. **Platte hinzufügen** legt rechts eine leere
Platte an; **Platte löschen** entfernt sie samt Inhalt. Beim Import landet ein
Teil auf der aktiven Platte.

### Messen und malen

- **Messen** (`U`): Strecke zwischen zwei Punkten in der 3D-Ansicht.
- **Stützen malen** (`L`): grün = Stütze, Shift = Blocker.
### Rückgängig

Die Werkzeugleiste führt einen Verlauf mit lesbaren Bezeichnungen („Teilen“,
„Maßstab“, „Platte löschen“ …). `Strg + Z` und `Strg + Y` arbeiten darauf.

## 7. Einstellungen

Die linke Leiste ist in Reiter gegliedert. Jeder Wert hat einen Info-Punkt mit
Erklärung; ein kleines Zurücksetzen-Symbol stellt den Profilwert wieder her.

| Reiter | Inhalt |
| --- | --- |
| **Qualität** | Schichthöhe, erste Schicht, Wände, Deck-/Bodenschichten, adaptive Schichthöhe, Gap-Fill, Elefantenfuß, Naht, Glätten, Fluss |
| **Struktur** | Füllung, Muster, Wandzahl, Verbindungen |
| **Geschwindigkeit** | Druck-, Wand-, Füll-, Reise- und Stützentempo, Beschleunigungen |
| **Kühlung** | Lüfterdrehzahlen, Mindestschichtzeit, langsame Schichten |
| **Stützen** | Typ, Muster, Überhangwinkel, Kontaktabstand, Schnittstelle |
| **Mehrfarbig** | Slots, Farben, aktiver Slot, objektweise Zuordnung |
| **Sonstige** | Sequenzieller Druck, Saum, Brim, Spezialmodus (Vase, Oberflächenstruktur), Arc-Fitting |

### Qualitätsprofile

Oben in der Leiste lässt sich ein Qualitätsprofil wählen (z. B. fein, normal,
schnell). Eigene Profile können gespeichert, umbenannt und wieder geladen
werden. **Alle Werte zurücksetzen** stellt das gewählte Profil wieder her.

### Wichtige Zusammenhänge

- **Schichthöhe** beeinflusst Zeit, Stabilität und Oberfläche. Sehr feine
  Schichten brauchen mehr Kühlung und Geduld.
- **Wände** bestimmen Stabilität und Maßhaltigkeit. Für Außenmaße ist der Fluss
  wichtiger als die Wandzahl.
- **Deckschichten** schließen die Oberfläche. Zu wenige Deckschichten zeigen
  Füllmuster durch.
- **Füllung** trägt innen. Für sichtbare Flächen zählt die Deckschicht, nicht die
  Füllung.
- **Z-Hop** verhindert Schleifspuren auf bereits gedruckten Flächen.
- **Glätten** fährt mit heißer Düse ohne Material über die Deckschicht. Es kann
  Kanten weichzeichnen und kleine Öffnungen zusetzen.

### Spezialmodi

- **Vasenmodus:** eine Außenwand, keine Füllung, keine Deck-/Bodenschichten.
  Wandzahl, Füllung und Deckschichten werden beim Slicen überstimmt.
- **Oberflächenstruktur:** prägt ein Muster in Wände, mit Flächenzuweisung je
  Seite und Vorschau in der 3D-Ansicht.
- **Sequenzieller Druck:** ein Objekt nach dem anderen in Höhenreihenfolge. Der
  Abstand zwischen den Bounding-Boxen ist einstellbar; Kopf-, Portal- und
  Kabelwege musst du selbst prüfen.

## 8. Slicen und Vorschau

### Slicen

**Slicen** (`Strg + R`) prüft zuerst die aktive Platte. Ist sie leer, kommt ein
Hinweis statt einer Fehlermeldung. Danach rechnet der Server und liefert G-Code,
Vorschau und Statistik.

Das Ergebnis-Panel nennt:

- Druckzeit und Schichtzahl
- Filamentlänge, Gewicht und Volumen
- geschätzte Kosten
- Warnungen (Bett-Mesh, dünne Bereiche, Sequenz, Mehrfarbdruck …)

### Vorschau

Die 3D-Ansicht zeigt den geslicten G-Code. Du kannst:

- Schichten durchblättern und einzeln ansehen
- nach Bahntyp einfärben (Außenwand, Innenwand, Deckschicht, Füllung, Stütze …)
- einzelne Bahntypen ausblenden
- Segmente anklicken und Details lesen
- die Legende und das Vorschau-Labor öffnen

**Vorschau-Labor:** zeigt Messwerte und Diagnosen, z. B. dünne Bereiche,
Überhänge, Kühlprobleme oder Stellen, an denen die Düse über bereits gedrucktes
Material fährt.

### Audit und Vorschläge

Das **Audit** prüft 17 Regeln und sortiert nach Schwere. Jeder Befund nennt Ort,
Messwert, Folge und — wo möglich — einen Ein-Klick-Fix.

Die **Vorschläge** sind weicher formuliert: Sie zeigen, was sich mit welcher
Begründung ändern lässt, und lassen sich einzeln ausblenden oder gesammelt
übernehmen.

### Speichern

- **G-Code speichern** legt die Datei lokal ab.
- **STL / 3MF exportieren** gibt Geometrie weiter.
- **Profil exportieren/importieren** sichert nur die Einstellungen.

Nach einem Absturz bietet die App den zuletzt automatisch gesicherten Entwurf
an. Der Entwurf wird lokal abgelegt und verlässt den Rechner nicht.

## 9. G-Code-Werkstatt

Der Reiter **G-Code** ist ein eigener Arbeitsbereich:

1. **Einlesen:** Datei ablegen oder öffnen (bis 200 MB). Die Datei wird lokal
   gelesen, nicht hochgeladen.
2. **Analysieren:** Befehlszählung, Temperaturen, Bewegungen, Zeit- und
   Materialschätzung.
3. **Prüfen:** Fehler und Hinweise mit Zeilennummer — z. B. fehlende
   Startsequenz, ungewöhnliche Temperaturen, Bewegungen außerhalb des Bauraums.
4. **Bearbeiten:** Zeilen ändern, suchen und ersetzen, Sprung zur Zeile.
5. **Vorschau:** derselbe 3D-Blick wie im Studio, inklusive Schichtfilter.
6. **Konvertieren:** Firmware-Geschmack wechseln (Marlin, Marlin 2, Klipper,
   RepRapFirmware, Repetier) mit Vorschau der Änderungen.
7. **Speichern:** als neue Datei.

Vor dem Druck eines bearbeiteten G-Codes immer die erste Schicht und die
Startsequenz prüfen.

## 10. Drucken

### Vor dem Start

1. Modell slicen.
2. Ergebnis prüfen: Zeit, Material, Warnungen.
3. Drucker verbinden (USB, Klipper) oder Simulation wählen.
4. Erste Schicht und Startsequenz im G-Code ansehen.
5. Im Ergebnis-Panel **Druckstart bestätigen** ankreuzen; erst dann wird der
   Startknopf aktiv.

Die Bestätigung ist Absicht: Ein Druck kann das Bett, die Düse oder das Teil
beschädigen, wenn etwas nicht passt.

### Während des Drucks

- **Pause / Fortsetzen / Abbruch** im Ergebnis-Panel oder unter
  **Drucker → Druck**.
- **Z-Korrektur** live verstellen, wenn die erste Schicht zu tief oder zu hoch
  liegt.
- **Konsole** für Firmware-Befehle.
- Das **Protokoll** zeichnet Meldungen auf.

### Nach dem Druck

Bett abkühlen lassen, Teil lösen, Düse reinigen. Bei Mehrfarbdruck die
Wechselstelle prüfen: Dort zeigen sich die meisten Probleme.

## 11. Kalibrieren

Kalibrieren ist der Kern des Programms. Die Reihenfolge ist wichtig, weil jeder
Test auf dem vorherigen aufbaut.

### Empfohlene Reihenfolge

1. **Fluss** — Grundlage für Maßhaltigkeit und alle anderen Werte.
2. **Temperatur** — bestimmt Oberfläche, Festigkeit und Fäden.
3. **Maximaler Volumenstrom** — Grenze für schnelle Schichten.
4. **Pressure Advance** — Ecken, Nähte und Beschleunigungswechsel.
5. **Retract** — Fäden und Oozing.
6. **Resonanz / Input Shaper** — Rippel und Ghosting.
7. **Überhänge** — wo Stützen nötig sind.
8. **Passung** — Spiel für Verbinder und bewegliche Teile.
9. **Erste Schicht** — Z-Offset.
10. **PA-Linientest** — feinere PA-Bestimmung.
11. **VFA / Tempo** — ruhigste Geschwindigkeit.

### Die elf Tests

| Test | Modell | Einstellbar |
| --- | --- | --- |
| Fluss | 30-mm-Würfel, eine Außenwand | Wandmessungen im Fluss-Rechner |
| Temperatur | Thermal-Cell, sechs Kammern à 8 mm | Von/Bis/Schritt in °C |
| Max. Volumenstrom | Max-Flow-Core, sieben Bänder à 5 mm | Von/Bis/Schritt in mm³/s |
| Pressure Advance | PA-Blade, zehn Stufen à 4 mm | Von/Bis/Schritt, Direct Drive/Bowden |
| Retract | Needle-Grid, fünf Nadeln | Von/Bis/Schritt, Direct Drive/Bowden |
| Überhänge | Overhang-Array | nichts — Formtest ohne Stützen |
| Resonanz | Resonance-Fin, fünf Stufen à 9 mm | Von/Bis/Schritt in Hz |
| Passung | Mech-Clutch | nichts — Formtest |
| Erste Schicht | fünf flache Felder | Z-Offset |
| PA-Linientest | Linienplatte über die Bettbreite | Von/Bis/Schritt, Extruder |
| VFA / Tempo | Geschwindigkeitsturm | Von/Bis/Schritt |

Die Stufenzahl steckt in der Geometrie. Ergibt deine Eingabe nicht genau diese
Stufenzahl, lehnt der Assistent mit einer klaren Meldung ab, statt den Bereich
still zu kürzen. Alle Modelle laufen mit 0,20 mm Schichthöhe.

### Ablauf eines Tests

1. Test wählen und Wertebereich einstellen.
2. **Modell erzeugen** — das Werkstück landet im Studio.
3. Slicen und drucken.
4. Ergebnis am gedruckten Teil ablesen (Wandstärke, Kammer, Stufe, Fadenbild).
5. Messwert eintragen und übernehmen.

### Kalibrier-Kreislauf

Das Panel **Kalibrier-Kreislauf** rechnet Messwerte in Korrekturen um:

| Messung | Korrektur |
| --- | --- |
| Wandstärke | Fluss |
| Ist-/Sollmaß | Schrumpfung |
| Fußbreite | Elefantenfuß |
| PA-Wert am Turm | Pressure Advance |
| Passungsspiel | Spiel für Verbinder |

Jede Korrektur nennt Formel, Vorher/Nachher und Begründung. **Nur übernehmen**
ändert die Einstellungen; **Übernehmen & Version sichern** legt zusätzlich eine
Version mit Drucker, Filament, Spule, Datum und Änderungstabelle an (maximal 40).

### Weitere Werkzeuge

- **Fluss-Rechner:** vier Wandmessungen → Fluss.
- **PA-Farbskala:** zeigt den PA-Verlauf farbig in der Vorschau.
- **Pressure Advance & Input Shaper übernehmen:** schreibt die Werte ins
  Filamentprofil.
- **Bewährte Testmodelle:** externe Modelle mit Lizenzhinweis, falls du
  gegenprüfen willst.

## 12. Mehrfarbig und Farbwechselsysteme

> **Dieses Kapitel ist für die Testphase besonders wichtig.** Bitte teste es
> auch dann, wenn du nur zwei Slots hast. Jeder Bericht hilft.

### Was die App derzeit tut

- Ein Druckerprofil kann eine **Mehrfachzuführung** haben: AMS, ACE, CFS, IFS,
  MMU oder ein vergleichbares System mit Slots.
- Jeder Slot hat eine **Farbe** und ein **Filamentprofil**.
- Ein Objekt kann einem Slot zugeordnet werden — im Bereich **Filament →
  Filament für dieses Objekt**.
- Beim Slicen wird der **aktive Slot** als Werkzeug verwendet.
- Objekte mit **unterschiedlichen** Slots werden **nacheinander** gedruckt. Vor
  jedem Wechsel steht ein `M600`-Pausebefehl aus dem Druckerprofil.

### Was die App derzeit nicht tut

- **Kein Purge-Tower.** Es gibt keine automatische Reinigungsstation.
- **Keine Farbwechsel pro Schicht.** Ein einzelnes Objekt kann nicht in
  mehreren Farben gedruckt werden.
- **Keine automatische Slot-Erkennung** am Drucker. Die Slots kommen aus dem
  Profil.
- **Kein Trocknen, kein Wiegen, keine Füllstandsmessung.**

### Einrichten

1. **Druckerprofil prüfen:** Unter **Drucker → Druckereinstellungen →
   Mehrfarbig** müssen die Slots angelegt sein. Ohne Mehrfachzuführung meldet
   die App: „Dieser Drucker hat keine Mehrfachzuführung.“
2. **Filament zuweisen:** Im Reiter **Mehrfarbig** der linken Leiste Slot
   wählen, Farbe und Material prüfen.
3. **Objekt zuordnen:** Objekt markieren, dann im Bereich **Filament →
   Filament für dieses Objekt** das passende Profil wählen.
4. **Prüfen:** Die Auswahl steht am Objekt; die Filament-Metadaten stehen im
   G-Code.
5. **Slicen:** Die Warnung nennt den sequenziellen Ablauf und die Zahl der
   Wechsel.
6. **Drucken:** Die Bestätigung ist Pflicht. Beim ersten Mal ohne Purge-Tower
   zuerst ein kleines Testteil drucken.

### Testliste für Farbwechselsysteme

Bitte diese Punkte durchgehen und mit „ok“ oder „Problem“ melden:

- [ ] Werden alle Slots im Profil angezeigt, mit richtiger Zahl und Farbe?
- [ ] Lässt sich ein Objekt einem Slot zuordnen — über die Objektauswahl?
- [ ] Bleibt die Zuordnung nach dem Speichern und erneuten Laden erhalten?
- [ ] Wird bei zwei Objekten mit verschiedenen Slots genau **ein** `M600`
      zwischen ihnen erzeugt?
- [ ] Fährt der Drucker vor dem Wechsel in eine sichere Parkposition?
- [ ] Wird die Pause vom Drucker verstanden und sauber fortgesetzt?
- [ ] Stimmt die erste Schicht **nach** dem Wechsel (Höhe, Haftung)?
- [ ] Bleibt das Maß nach dem Wechsel gleich (kein Versatz in X/Y)?
- [ ] Funktioniert der Wechsel mit 2, 4 und mehr Slots?
- [ ] Was passiert bei leerem oder falsch zugeordnetem Slot?
- [ ] Gibt es Fäden, Oozing oder Verschmieren an der Wechselstelle?
- [ ] Wird die Slot-Farbe im G-Code/Metadatenblock korrekt genannt?

### Was in den Bericht gehört

- System und Hersteller (z. B. Bambu AMS Lite, Anycubic ACE Pro, Creality CFS,
  Prusa MMU3, ERCF, Tradrack)
- Zahl der Slots und welche belegt waren
- Drucker und Firmware
- Filamente und Farben
- Ob ein `M600` im G-Code steht und ob der Drucker ihn versteht
- Foto der Wechselstelle und, wenn möglich, die G-Code-Zeilen um `M600`

**Sicherheit:** Beim ersten Test mit einem neuen Mehrfarb-Setup das Bett leeren,
die Düse reinigen und das Teil klein halten. Ein fehlgeschlagener Wechsel kann
Filament auf dem Bett hinterlassen.

## 13. Multiprint

**Multiprint** verteilt mehrere Platten auf mehrere Drucker:

1. Modell laden (bis zu acht Platten).
2. Plattenzahl festlegen und jeder Platte einen Drucker zuordnen.
3. **Alle slicen** — jede Platte bekommt ihren eigenen G-Code.
4. Jobs in die Warteschlange legen.
5. Status pro Platte und pro Drucker verfolgen.

Die Warteschlange liegt im Server und bleibt beim Ansichtswechsel erhalten. Ein
Druck startet nur nach der üblichen Bestätigung.

## 14. Daten, Profile und Sicherung

| Datei / Ordner | Inhalt |
| --- | --- |
| `profiles.json` | eigene Filament-, Qualitäts- und Druckerprofile |
| `bedmeshes.json` | Bett-Messungen je Drucker (max. 12) |
| Entwürfe | automatisch gesicherter Arbeitsstand nach Absturz |
| Protokoll | Servermeldungen der laufenden Sitzung |

**Sicherung:** den Datenordner kopieren (siehe Kapitel 2). Zusätzlich lassen
sich Profile und Druckerstände als JSON exportieren und wieder importieren.

**Zurücksetzen:** App schließen, den Datenordner umbenennen, App neu starten.
Dann beginnt die App mit den Standardwerten. Nichts wird dabei gelöscht.

## 15. Tastenkürzel

### Datei und Projekt

| Taste | Wirkung |
| --- | --- |
| `Strg + I` | Objekt importieren |
| `Strg + O` | Datei öffnen |
| `Strg + N` | Neues Werkstück laden |
| `Strg + R` | Aktuelle Platte slicen |

### Bearbeiten

| Taste | Wirkung |
| --- | --- |
| `Strg + Z` / `Strg + Y` | Rückgängig / Wiederholen |
| `Strg + C` / `Strg + V` | Kopieren / Einfügen |
| `Strg + K` | Auswahl klonen |
| `Strg + A` | Alle Objekte auswählen |
| `Entf` / `Backspace` | Auswahl löschen |
| `Strg + D` | Alles löschen |
| `Esc` | Auswahl und Werkzeug schließen |

### Objekt und Ansicht

| Taste | Wirkung |
| --- | --- |
| `A` | Alle Objekte anordnen |
| `Q` | Automatisch ausrichten |
| Pfeiltasten | Auswahl 10 mm verschieben |
| `Shift` + Pfeil | Auswahl 1 mm verschieben |
| `Bild ↑` / `Bild ↓` | Auswahl 45° um Z drehen |
| `M` | Größe / Position |
| `R` | Drehen |
| `S` | Skalieren |
| `F` | Auf die Platte legen |
| `V` | Druckbar ein/aus |
| `C` | Teilen |
| `T` | Text aufbringen |
| `U` | Messen |
| `L` | Stützen malen |
| `Y` / `B` | Ausgewählte Teile zusammenbauen |
| `I` / `O` | Zoom rein / raus |
| `?` | Tastenkürzel-Liste öffnen |

## 16. Problemlösung

### Die App startet, aber der Browser bleibt leer

1. `http://127.0.0.1:8787` von Hand öffnen.
2. Prüfen, ob der Port belegt ist. Ein anderer Port lässt sich mit der
   Umgebungsvariablen `PORT` setzen.
3. **Protokoll** öffnen. Steht dort „Server nicht erreichbar“, die App neu
   starten.

### „Server nicht erreichbar“

Der lokale Server antwortet nicht. App schließen, alle Instanzen beenden, neu
starten. Im Entwicklungsbetrieb: `npm run dev` neu starten.

### Ein Modell lädt nicht

- Format prüfen: STL, 3MF, OBJ, PLY, GLB.
- Bei 3MF: Ist die Datei wirklich ein 3MF-Archiv und kein umbenanntes ZIP?
- Bei GLB: Externe `.bin`-Dateien und GLB 1.0 werden nicht unterstützt.
- Beschädigte Netze zuerst reparieren, dann erneut laden.

### Das Objekt ist winzig

Das Modell ist wahrscheinlich in Metern gespeichert. Die angebotene
Ein-Klick-Skalierung auf 100 mm nutzen oder im Dialog **Größe / Position** den
Maßstab setzen.

### Der Druck startet nicht

1. Ist der richtige Drucker aktiv und verbunden?
2. Ist die Druckbestätigung angekreuzt?
3. Liegt das Objekt vollständig im Bauraum?
4. Meldet das Audit einen kritischen Befund?
5. Steht im Protokoll eine Firmware-Meldung?

### Die erste Schicht sitzt nicht

- Bett sauber und eben?
- Z-Offset korrigieren (**Drucker → Z-Korrektur**).
- Bettvermessung erneuern.
- Erste-Schicht-Test aus Kapitel 11 drucken.
- Fluss prüfen, wenn die Linien zu dünn oder zu dick sind.

### Fäden und Oozing

- Retract-Test drucken, Temperatur prüfen.
- Reisetempo und Z-Hop erhöhen.
- Filament trocknen.

### Mehrfarbdruck bricht ab oder verschmiert

- Prüfen, ob der Drucker `M600` versteht und was er dabei tut.
- Pause-G-Code im Druckerprofil anpassen.
- Parkposition und Düsenreinigung kontrollieren.
- Erst ein kleines Testteil drucken.
- Befund nach der Testliste in Kapitel 12 melden.

### Der Scan-Dialog meldet einen fehlenden Server

Der MeshScan-Server läuft nicht. `start.bat` des Scan-Servers starten und
prüfen, ob Port 8000 erreichbar ist. Ohne Server funktioniert nur das Laden
vorhandener Scan-Ordner.

### Es ist langsam

- Sehr große Modelle brauchen Speicher. Andere Programme schließen.
- Die Vorschau lässt sich auf einzelne Schichten begrenzen.
- Im G-Code-Bereich sehr große Dateien zuerst analysieren, dann bearbeiten.

## 17. Feedback und Fehlerberichte

**Wir freuen uns über jedes Feedback.** Auch „läuft bei mir“ ist wertvoll: Es
zeigt, welche Drucker und Filamente abgedeckt sind. Kritik ist ausdrücklich
willkommen — je konkreter, desto schneller die Korrektur.

### Am besten über ein GitHub Issue

Bitte diese Angaben mitgeben:

1. **Drucker:** Marke, Modell, Firmware, Verbindungsart (USB / Klipper /
   Simulation)
2. **Material:** Filament, Farbe, Düse, Schichthöhe
3. **Einstellungen:** die wichtigsten geänderten Werte oder das exportierte
   Profil
4. **Erwartung und Beobachtung:** Was sollte passieren, was ist passiert?
5. **Beweise:** Screenshot, Foto des Drucks, betroffene G-Code-Zeile
6. **Bei Mehrfarbdruck:** System, Slot-Zahl, ob `M600` verstanden wird

### Was du nicht mitschicken solltest

- Druckaufträge oder Dateien mit vertraulichen Daten
- Zugangsdaten, API-Keys oder Seriennummern
- Fotos, auf denen private Dinge zu sehen sind

### Was zuerst getestet wird

1. **Farbwechselsysteme** — siehe Kapitel 12
2. Erste Schicht und Bett-Haftung auf anderen Druckern
3. Kalibrier-Tests mit fremden Firmware-Varianten
4. Große und beschädigte Modelle
5. G-Code-Konvertierung zwischen Firmware-Typen

Danke, dass du testest. Jeder Bericht macht die nächste Version besser.

---

Copyright (c) 2026 Michael Becker. Lizenz: siehe [LICENSE](LICENSE).
