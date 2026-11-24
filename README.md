# Easy-Slicer by Becker

Ein eigenständiger 3D-Druck-Slicer für Windows — mit Betttisch-Vermessung pro
Druckermodell, elf geführten Kalibrier-Tests, Druckbarkeits-Audit und
Montage-Assistent. Kein Cloud-Zwang: Modelle, Profile und Messungen bleiben auf
dem eigenen Rechner.

> **Status: öffentliche Testversion 0.2.0.** Das Programm ist noch nicht fertig.
> Genau deshalb ist es hier: **Wir freuen uns über jedes Feedback** — Lob,
> Fehlerberichte, Messwerte, Screenshots und G-Code-Auszüge.
>
> **Besonders wichtig: Farbwechselsysteme testen.** AMS, ACE, CFS, IFS, MMU und
> ähnliche Systeme sind der Bereich mit den meisten offenen Fragen. Wenn du so
> ein System hast, ist dein Test gerade jetzt besonders wertvoll.

*English: Easy-Slicer by Becker is a source-available 3D printing slicer for
Windows. This is a public test build. Feedback is very welcome — especially from
testers with multi-material / color-change systems (AMS, ACE, CFS, IFS, MMU).*

---

## Inhalt

- [Was die App kann](#was-die-app-kann)
- [Download und erster Start](#download-und-erster-start)
- [Die ersten fünf Minuten](#die-ersten-fünf-minuten)
- [Besonders gesucht: Farbwechselsysteme](#besonders-gesucht-farbwechselsysteme)
- [Selbst bauen](#selbst-bauen)
- [Bedienungsanleitung](#bedienungsanleitung)
- [Was diese Testversion nicht enthält](#was-diese-testversion-nicht-enthält)
- [Bekannte Grenzen](#bekannte-grenzen)
- [Feedback und Fehlerberichte](#feedback-und-fehlerberichte)
- [Lizenz](#lizenz)

## Was die App kann

- **Werkstatt und Studio:** STL, 3MF, OBJ, PLY und GLB laden, mehrere Platten,
  Objekte bewegen, drehen, skalieren, teilen, reparieren, zusammenbauen.
- **Elf Kalibrier-Tests** mit eigenen Modellen: Fluss, Temperatur,
  Volumenstrom, Pressure Advance, Retract, Überhänge, Resonanz, Passung, erste
  Schicht, PA-Linientest und VFA/Tempo — inklusive Kalibrier-Kreislauf, der
  Messwerte in korrigierte Einstellungen umrechnet.
- **Betttisch-Vermessung pro Drucker** mit Messverlauf, Wölbungs- und
  Sprungerkennung sowie Software-Kompensation im G-Code.
- **Druckbarkeits-Audit** mit 17 Regeln, klaren Messwerten und Ein-Klick-Fixes.
- **Montage-Assistent** für große Teile: Schnittachse, Teilezahl, Verbinder,
  Passung und Naht — aus Bettmaß, Belastung und Werkstoff.
- **Scan-Pipeline:** Fotos oder Video über einen lokalen MeshScan-Server zu
  einem druckbaren Mesh; vorhandene Meshroom-/COLMAP-/openMVS-/MicMac-Ordner
  lassen sich direkt einlesen und im Scan-Assistenten prüfen, skalieren,
  reparieren und aushöhlen.
- **Mehrfarbig:** Filament-Slots, Farben und objektweise Zuordnung; Objekte mit
  unterschiedlichen Slots werden nacheinander mit `M600` gedruckt.
- **G-Code-Werkstatt:** G-Code einlesen, analysieren, prüfen, bearbeiten,
  konvertieren und in der 3D-Vorschau prüfen.
- **Drucken über USB** (Marlin-Serial) oder **Klipper im Netz**; Simulation ohne
  Hardware; Job-Steuerung, Pause, Abbruch und eine ausdrückliche
  Druckbestätigung.
- **Lokal und nachvollziehbar:** keine Cloud, keine Konten, keine Telemetrie.

## Download und erster Start

Die Testversion wird als portable Windows-EXE verteilt (kein Installer):

1. Im Bereich **Releases** die neueste `Easy-Slicer-by-Becker.exe` herunterladen.
2. Die Datei in einen eigenen Ordner legen und starten.
3. Die App öffnet die Oberfläche automatisch im Standardbrowser
   (`http://127.0.0.1:8787`).
4. Beim ersten Start einen Drucker wählen (Marke/Modell) und Material, Platte
   und Düse prüfen.

Die EXE braucht keine Installation. Sie legt ihre Daten unter
`%LOCALAPPDATA%\EasySlicerBecker\data` ab (Profile, Bett-Messungen, Entwürfe).
Ein anderer Ordner lässt sich mit der Umgebungsvariablen `KEPLER_DATA` setzen.

**Systemvoraussetzungen:** Windows 10/11 (64 Bit), ein aktueller Browser
(Chrome, Edge oder Firefox), mindestens 8 GB RAM. Für Scan-Rohdaten und sehr
große Modelle sind 16 GB angenehmer.

## Die ersten fünf Minuten

1. **Drucker einrichten:** oben auf den Druckernamen klicken oder
   **Drucker → Meine Drucker → + Drucker**. Marke und Modell wählen; Bauraum,
   Kinematik und Grenzen kommen aus dem Profil.
2. **Verbinden:** im Tab **Drucker → Verbindung** `Simulation`, `USB` oder
   `Klipper` wählen. Simulation ist zum Ausprobieren ohne Drucker gedacht.
3. **Modell laden:** Datei in das Fenster ziehen oder Rechtsklick →
   **Datei → Objekt laden …**. STL, 3MF, OBJ, PLY und GLB werden erkannt.
4. **Slicen:** im Studio **Slicen** drücken. Die Vorschau zeigt Schichten,
   Bahntypen und Problemstellen; das Ergebnis-Panel nennt Zeit, Material und
   Gewicht.
5. **Speichern oder drucken:** G-Code speichern oder — nach ausdrücklicher
   Bestätigung — an den verbundenen Drucker senden.

## Besonders gesucht: Farbwechselsysteme

Die Mehrfarb-Unterstützung ist bewusst einfach gehalten und braucht echte
Praxistests. Getestet werden soll vor allem:

- Erkennung und Anzeige der Slots (AMS, ACE, CFS, IFS, MMU, ERCF, Tradrack …)
- objektweise Filamentzuordnung und Filament-Metadaten im G-Code
- der erzeugte `M600`-Wechsel zwischen Objekten: Parkposition, Pause,
  Wiederaufnahme, Sauberkeit der Düse
- Maßhaltigkeit und erste Schicht **nach** einem Wechsel
- Verhalten bei 2, 4 und mehr Slots sowie bei leeren oder falsch zugeordneten
  Slots

Wie du das Schritt für Schritt prüfst, steht in der
[Bedienungsanleitung, Kapitel 12](BEDIENUNGSANLEITUNG.md#12-mehrfarbig-und-farbwechselsysteme).
Bitte im Fehlerbericht das System, die Slot-Zahl, die Firmware und den
Drucker nennen.

## Selbst bauen

Voraussetzung: Node.js 22 und npm.

```bash
npm install
npm run dev        # Server auf 8787, Oberfläche auf http://localhost:3000
npm test           # Prüfskripte für Geometrie, G-Code und Verhalten
npm run build      # Oberfläche bauen
npm run build:exe  # Windows-EXE und ZIP in release/ bauen
```

Die EXE wird mit Node SEA gebaut; ein Installer entsteht nur, wenn `makensis`
(NSIS) installiert ist. Ohne NSIS bleiben EXE und ZIP.

## Bedienungsanleitung

Die ausführliche Anleitung steht in **[BEDIENUNGSANLEITUNG.md](BEDIENUNGSANLEITUNG.md)**.
Sie erklärt jede Ansicht, die wichtigsten Einstellungen, die elf Kalibrier-Tests,
den Mehrfarbdruck, die Tastenkürzel und die Fehlersuche.

Ergänzende Dokumente:

- [Kalibrier-Tests: Modelle, Werte und Quellen](docs/KALIBRIERUNG-TESTS.md)
- [Slice-Engine: Schnittstelle und Verhalten](docs/slice-engine/README.md)
- [Drittanbieter-Lizenzen](THIRD_PARTY_NOTICES.md)

## Was diese Testversion nicht enthält

Zwei Funktionen sind in dieser Veröffentlichung bewusst nicht sichtbar. Der Code
bleibt im Repository; sie lassen sich später mit einem Schalter wieder
einschalten (`shared/release.ts`).

| Funktion | Status | Ersatz |
| --- | --- | --- |
| „Kratzerfreie Oberfläche“ (dichter Unterbau, extra Deckschichten, höherer Fahrweg-Hub) | nicht enthalten | normale Deckschichten, Z-Hop und Glätten |
| Eingebettete Web-Oberfläche (Mainsail/Fluidd/OctoPrint als Tab) und der Web-Verbindungsdialog | nicht enthalten | Klipper im Netz weiterhin unter **Drucker → Verbindung** |

Außerdem:

- Der **Scan-Start** (Fotos/Video → Mesh) braucht den externen
  MeshScan-Server auf `127.0.0.1:8000`. Ohne diesen Server bleibt der Dialog
  geschlossen und meldet den fehlenden Server. Das **Laden eines vorhandenen
  Scan-Ordners** funktioniert ohne ihn.
- Es gibt **keinen Purge-Tower** und **keine Farbwechsel pro Schicht**.
  Mehrfarbig heißt derzeit: Objekte mit unterschiedlichen Slots nacheinander,
  mit `M600` dazwischen.
- Die ausgelieferte EXE ist für Windows gebaut. Andere Systeme sind nicht
  getestet.

## Bekannte Grenzen

- Das Programm ist eine Testversion. Profile, G-Code und Messwerte können sich
  zwischen Versionen ändern.
- Der Slicer kennt die Kopfform deines Druckers nicht. Prüfe bei mehreren
  Objekten und beim sequenziellen Druck immer Kabelwege, Portal und Klemmen.
- Sehr feine oder beschädigte Netze brauchen Reparatur und Geduld; das Audit
  nennt die Stelle, aber nicht jede Reparatur gelingt.
- Drucken bleibt deine Entscheidung: Die App fragt vor jedem Start ausdrücklich
  nach einer Bestätigung.

## Feedback und Fehlerberichte

**Jedes Feedback hilft** — auch „läuft bei mir einfach“ ist wertvoll, weil es
die getestete Hardware absteckt.

Am schnellsten über ein **GitHub Issue**. Hilfreich sind:

1. Drucker (Marke/Modell), Firmware und Verbindungsart (USB/Klipper/Simulation)
2. Filament, Düse, Schichthöhe und die wichtigsten geänderten Einstellungen
3. Was du erwartet hast und was tatsächlich passiert ist
4. Screenshot der Oberfläche und, wenn möglich, die betroffene G-Code-Zeile
5. Bei Farbwechselsystemen: System, Slot-Zahl und ob `M600` vom Drucker
   verstanden wird

Bitte keine Druckaufträge oder vertraulichen Daten mitschicken. Für Fehler, die
den Druck betreffen: zuerst im **Simulation**-Modus oder mit angehobenem Bett
nachstellen.

## Lizenz

**Source-Available, keine Open-Source-Lizenz.** Ansehen, herunterladen, selbst
bauen und privat testen ist erlaubt. Weiterverkauf, kommerzielle Nutzung und die
Veröffentlichung abgeleiteter Fassungen als eigenes Produkt sind nicht erlaubt.
Der vollständige Text steht in [LICENSE](LICENSE); ergänzend gilt
[LICENSE-SLICE-ENGINE.md](LICENSE-SLICE-ENGINE.md). Drittanbieter-Komponenten
unterliegen ihren eigenen Lizenzen (siehe [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).

Copyright (c) 2026 Michael Becker.
