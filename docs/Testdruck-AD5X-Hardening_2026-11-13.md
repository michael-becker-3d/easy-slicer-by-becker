# Testdruck-Coupon und AD5X-Start: Befund, Härtung und Brainstorming

Stand: 13.11.2026, abends  
Teil: `surface-guard-coupon`, 50 × 50 × 6 mm, AD5X-Job **000099**  
Fotos: `C:\Users\Michael Becker\Desktop\Pics` (5 Aufnahmen, 18:27 Uhr)

## 1. Was auf den Fotos zu sehen ist

Ich habe alle fünf Fotos und zusätzlich helle, kontrastverstärkte Ausschnitte angesehen.

**Außenseiten:**

- Die Seitenwände sind in mehreren Ansichten **nach außen gewölbt** (barrel-förmig), nicht gerade.
- Die Wölbung ist nicht nur eine einzelne Kante: Sie betrifft die sichtbaren Längs- und Stirnseiten.
- Die Schichtlinien laufen wellig; an der Unterseite und an einer Ecke sitzen kleine Materialpunkte/Blobs.
- Die Ecken sind stark gerundet. Das kann teilweise normal sein, passt aber zusammen mit der Wölbung zu Verzug.

**Deckfläche:**

- Die Fläche ist großflächig **gewellt/gedomt**, nicht plan.
- Darüber liegen viele parallele diagonale Bahnen. Das ist zuerst die normale Deckschicht-Richtung, keine automatisch erkannte Kratzspur.
- Eine **breite diagonale Linie** zieht über die Fläche. Auf dem Foto ist nicht sicher zu trennen, ob das eine Deckschichtbahn, eine Naht oder eine echte Riefe ist.
- **Wichtig:** Bitte mit dem Fingernagel quer über diese Linie fahren. Bleibt der Nagel hängen oder ist eine Kante fühlbar, ist es eine Riefe/Kratzspur. Ist sie glatt, ist es eine Bahn/Naht.

**Fazit:** Das ist mehr als das frühere Pillowing. Die G-code-Koordinaten der Außenwand sind über alle Schichten konstant; der Slicer zeichnet also keine Kurve. Die Form entsteht durch **Verzug/Schrumpfung nach dem Druck bzw. während der Abkühlung**. Eine Verzerrung durch die sehr nahe Handy-Kamera kann die Wölbung optisch verstärken, aber sie ist in mehreren Ansichten und an mehreren Seiten konsistent.

## 2. Warum du noch nicht sinnvoll messen kannst

Eine einzelne Höhenmessung von 6,0 mm ist bei diesem verzogenen Teil kein belastbarer Maßstab. Sie würde nur den Verzug mitmessen. Besser sind **relative Messungen**:

1. **Auflage:** Teil auf eine ebene Fläche legen und prüfen, ob es kippelt. Hohe Ecken markieren.
2. **Ebenheit oben:** Lineal/gerade Kante in beiden Diagonalen und parallel zu den Kanten auflegen; Spalt mit Fühlerlehre oder einem dünnen Streifen messen.
3. **Seitenwölbung:** Breite an Unterkante, Mitte und Oberkante messen. Ist die Mitte deutlich breiter als beide Kanten, ist die Barrel-Form bestätigt.
4. **Höhe:** Mitte und vier Ecken getrennt messen, nicht als einen 6,0-mm-Wert zusammenfassen.
5. **Wandstärke:** Nur an einer späteren Schnittprobe sinnvoll; nicht am ganzen Coupon opfern.

Bitte diese Werte notieren:

| Messung | Wert |
|---|---|
| Kippelt das Teil? | ja/nein, welche Ecke |
| Größter Spalt oben (mm) | |
| Breite unten / Mitte / oben (mm) | |
| Höhe Mitte / Ecken (mm) | |
| Diagonale Linie fühlbar? | ja/nein |

Erst wenn die Form bekannt ist, lässt sich A-51 (Maßhaltigkeit) sauber beurteilen. Der Coupon ist dafür wegen seiner 50-mm-Fläche und des dichten Deckschichtpakets ein schlechter Kalibrierkörper.

## 3. Wahrscheinliche Ursache und was ich nicht behaupte

**Wahrscheinlich:** thermischer Verzug eines großen, flachen PLA-Teils mit einem dichten Deckschichtpaket. Der Coupon hat sechs Schutzschichten plus volle Auflage darunter; das sind fast 2 mm massives Material an der Oberseite. Der obere Verbund schrumpft beim Abkühlen stärker als der Boden, der noch warm auf der 65-°C-Platte haftet. Die Seiten können dabei nach außen ausbeulen.

**Nicht bewiesen:** dass der Oberflächenschutz die alleinige Ursache ist. Auch Bett-Temperatur, Kühlung, Wandzahl, Füllung und die Geometrie spielen hinein. Die G-code-Berechnung selbst ist unauffällig; die Außenwand liegt in jeder Schicht auf denselben X/Y-Koordinaten.

**Nächster sinnvoller Vergleich, kein Druck ohne Freigabe:**

- A: kleiner flacher Coupon (z. B. 40 × 40 × 4 mm), 3 Wände, 30–40 % Füllung, **ohne** Oberflächenschutz, Bett 60 °C, Lüfter wie bisher.
- B: derselbe Körper **mit** Oberflächenschutz.
- Nur eine Variable ändern. Danach Form, Höhe und Oberfläche vergleichen.
- Falls A schon verzieht: zuerst Bett Temperatur/Kühlung und Wandzahl prüfen, nicht den Schutz weiter erhöhen.
- Falls nur B verzieht: Schutz auf große flache Teile begrenzen oder die zusätzlichen Deckschichten reduzieren.

## 4. AD5X-Start: was jetzt gehärtet ist

### Vorher

Das Makro `SDCARD_PRINT_FILE` wurde aufgerufen; danach meldete die App sofort „printing“. Ein HTTP-Erfolg des Makros beweist aber keinen laufenden Druck. Genau dieser Fall hatte beim AD5X schon einmal zu einem scheinbar gestarteten, tatsächlich stehenden Job geführt.

### Jetzt

- `KlipperClient.startFileViaMacro()` prüft den Dateinamen und ruft das Makro auf.
- Danach liest die App alle 750 ms `print_stats`, bis Klipper **`printing`** oder **`paused`** mit dem erwarteten Dateinamen meldet.
- Timeout: 45 s. Danach kommt eine klare Fehlermeldung; es wird **nicht automatisch erneut gestartet**.
- Ein anderer laufender Dateiname wird als Fehler gemeldet, statt den alten Druck zu überschreiben.
- `PrinterManager` verhindert einen zweiten Start, solange der Status `printing`/`paused` ist, und hat zusätzlich eine Sperre für gleichzeitige Startaufrufe.
- Nur der AD5X (`flashforge-ad5x`) nutzt diesen Makro-Weg; andere Klipper-Drucker behalten den normalen Upload-mit-Start.

### Prüfung

`scripts/check-ad5x-start.ts` läuft gegen einen lokalen Moonraker-Stub:

- Upload mit `print=false`
- `SDCARD_PRINT_FILE FILENAME=ui-test.gcode`
- `print_stats` bestätigt `printing`
- zweiter Start wird abgelehnt
- Makro ohne Statusbestätigung wird abgelehnt
- ungültiger Dateiname wird abgelehnt

Ergebnis: grün. Ein echter Druck **durch die App** bleibt offen, bis das Bett frei ist. Job **000099** beweist den Makro-Weg am Gerät, nicht den App-Start.

## 5. Code-Review

**Kein blockierender Fehler** in der neuen Härtung gefunden. Positiv:

- Der Status wird erst nach der Bestätigung auf `printing` gesetzt; die UI lügt damit nicht mehr bei einem hängenden Makro.
- Kein Auto-Retry: Ein zweiter Makroaufruf könnte sonst zwei Jobs starten.
- Das Warten ist auf 45 s begrenzt; die API bleibt nicht dauerhaft hängen.
- Der Dateiname wird vor dem Makro validiert; der Manager bereinigt ihn zusätzlich.

**Risiken / offene Punkte:**

- 45 s können bei einer sehr langsamen SD-Karte knapp sein; der Wert ist zentral änderbar.
- `print_stats` kann `printing` melden, obwohl die Düse wegen eines Makrofehlers nicht fährt; die Statusabfrage ist die bestmögliche Moonraker-Bestätigung, kein physischer Bewegungssensor.
- Die UI sollte den Wartezustand sichtbar anzeigen („Start wird bestätigt …“), statt nur zu blockieren. Das ist eine UX-Idee, noch nicht umgesetzt.
- Der echte App-Start muss nach dem Freimachen des Betts einmal mit einem kleinen Teil geprüft werden.
- Die alte Webcam liefert 502; es gibt keinen automatischen Videobeweis.

## 6. Brainstorming

**Start:**

- Statusmaschine `uploaded → macro_sent → heating/printing → confirmed` in der UI anzeigen.
- Optional Makro-Log der letzten Zeilen abrufen und bei Timeout anzeigen.
- Bei Timeout nur „am Drucker prüfen“, niemals automatisch senden.
- Ein kleiner „Starttest“-Knopf mit 30 × 30 × 1,2 mm Pad, der nach der ersten bestätigten Schicht automatisch abbricht.

**Verzug / Oberfläche:**

- Oberflächenschutz nur auf die tatsächlich sichtbaren Deckschichten anwenden; bei großen flachen Teilen weniger zusätzliche Volldeckschichten.
- Test mit 3 Wänden und 30–40 % Füllung statt des dichten Coupon-Pakets.
- Bett 60 °C statt 65 °C testen; Lüfter erst ab Schicht 3 voll.
- Kleine Fase/Radius an der Oberkante als Sollform, damit eine Wölbung nicht als scharfe Kante bricht.
- Getrennte Bewertung: Oberflächenbild (Kratzer) und Maßhaltigkeit (Verzug) nicht in einer Note vermischen.

**Messung:**

- Verzug immer relativ messen (Kippeln, Spalt, Breite unten/Mitte/oben), nicht nur eine Höhe.
- Für A-51 einen separaten 20-mm-Würfel ohne Oberflächenschutz verwenden.

## 7. Prüfungen

| Prüfung | Ergebnis |
|---|---|
| TypeScript `--noEmit` | 0 |
| `check-ad5x-start.ts` | grün, inkl. Fehlerfällen |
| `check-surface-guard.ts` | 6 Deckschichten, 162 Hübe, max. 0,60 mm |
| `check-printer-hub.ts` | grün |
| `check-connector-fit.ts` | grün |
| Vite-/EXE-Build | 0 |
| EXE Health / Beenden | 200 / 200 |
| Physische Oberfläche | **offen** |
| Echter App-Druckstart | **offen, Bett belegt** |

Fotos und Bericht werden unter `C:\easy-slicer-projekt-files` archiviert. Kein Druck und keine Druckerkonfiguration wurden geändert.
