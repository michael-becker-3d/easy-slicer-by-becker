# Easy-Slicer – UI-Test A und Testdruck: Bericht

Stand: 13.11.2026, 18:18 Uhr  
Build: 0.2.0, UI-Testbuild A  
Testkörper: `surface-guard-coupon.gcode`, Job **000099**, AD5X

## Kurzfassung

Der Oberflächenschutz ist geslict und der Coupon wurde auf dem AD5X fertig gedruckt. Ob die Oberseite frei von **sichtbaren** Düsenkratzern ist, muss am gedruckten Teil geprüft werden; das ist mit Kamera und G-code nicht beweisbar. Der UI-Test A ist gebaut, startet standardmäßig in der neuen Reihenfolge und lässt sich über „Klassisch“ oder `?ui=classic` vollständig zurückstellen.

Der App-Druckstart für den AD5X ist im Code gegen einen lokalen Moonraker-Stub geprüft. Ein echter Druck **durch die App** ist noch offen, weil der Coupon auf dem Bett liegt. Kein Druck ohne freies Bett und ohne deine Freigabe.

## 1. Was du mit dem gedruckten Teil machen sollst

### Zuerst optisch, nicht messen

1. Bett abkühlen lassen und den Coupon vorsichtig abnehmen. Die PEI-Platte dabei nicht mit den Fingern auf der Druckfläche berühren.
2. Coupon unter eine helle Lampe halten und flach streifend beleuchten, am besten zusätzlich mit einer Taschenlampe von der Seite.
3. Oberseite (die zuletzt gedruckte 50 × 50 mm Fläche) auf **dünne Linien, Riefen, Schmelzspuren und Wellen** prüfen. Richtung notieren: X, Y oder diagonal.
4. Rand und Ecken auf **hochgezogene Ränder, Wellen und Löcher in der Deckschicht** prüfen.
5. Erst wenn optisch etwas auffällt, gezielt nachmessen. Eine glänzende Oberfläche allein ist kein Beweis; eine matte Stelle kann auch normale Textur sein.

**Bewertung:**

- Keine sichtbaren Kratzer/Riefen: Oberflächenschutz hat den sichtbaren Test bestanden. Das ist keine Garantie für „nie Kratzer“, sondern der Nachweis für diesen Coupon.
- Sichtbare Kratzer oder Riefen: Richtung und Stelle beschreiben, am besten mit Streiflicht fotografieren. Dann ist A-46 wieder offen und der Schutz muss nachjustiert werden.
- Nur Wellen oder ein hochgezogener Rand ohne Kratzer: Das ist eher Pillowing/Deckschicht-Durchhang, nicht der Oberflächenschutz. Das bleibt A-46, aber mit anderer Ursache.

### Optional messen

Die Messung ist **nicht** der erste Schritt und nicht nötig, wenn du nur die Kratzer beurteilen willst.

- **Höhe:** Messschieber an fünf Stellen (vier Ecken, Mitte). Soll bei 25 Schichten ungefähr **6,0 mm**; eine Toleranz von etwa ±0,15 mm ist für diesen Test sinnvoll. Die Mitte kann durch Deckschicht-Durchhang etwas niedriger sein.
- **Ebenheit:** Lineal oder gerade Kante über die Oberseite legen. Maximalen Spalt an der höchsten Stelle notieren; ein durchgehender Spalt von mehr als ca. 0,2 mm ist auffällig.
- **Deckschicht:** Nur wenn du den Coupon opfern willst, an einer Kante anschneiden und die oberste massive Zone messen. Sechs Schutzschichten mit 0,24 mm sind nominal ca. **1,4 mm**; die einzelnen Schichten sind mit dem Messschieber nicht sinnvoll messbar.
- **Wandstärke:** Nur bei einem Schnitt sinnvoll. Für A-51 ist der 20-mm-Würfel die bessere Probe.

Bitte notiere die Werte kurz; ich übernehme sie in `AUFGABEN.md`. Ohne deine Rückmeldung bleibt A-46 bei „Sichtprüfung offen“.

## 2. UI-Test A

### Neue Reihenfolge im Studio

- **Links:** Werkstück, Absicht und Ergebnis (Slicen, Fortschritt, Zusammenfassung).
- **Mitte:** Vorschau und Werkzeuge.
- **Rechts:** Einstellungen und Vorschläge.

Die klassische Ansicht ist nicht gelöscht. Sie bleibt über folgende Wege erreichbar:

1. Kopfschalter **„Klassisch“** oben rechts.
2. URL `http://127.0.0.1:8787/?ui=classic` (bzw. die jeweilige Adresse).
3. `localStorage`-Schlüssel `easy-slicer-ui-test` mit `classic` oder `test`.

Die Wahl wird lokal gespeichert. Modelle, Druckerprofile und Druckerdaten werden dabei nicht verändert. Ein Rücksetzen des Browserspeichers stellt den Standard (UI-Test A) wieder her.

### Geprüft

- Browser bei 1282 × 720: Testlayout **350 / 504 / 380 px**, klassisch **370 / 534 / 330 px**.
- Umschalten Test → Klassisch → Test funktioniert; das Banner und die Spalten wechseln korrekt.
- Kein horizontaler Überlauf. Die rechte Einstellungsspalte scrollt für sich.
- Typecheck und Vite-Build grün, EXE-Health und Beenden geprüft.

**Nicht geprüft:** andere Fenstergrößen, jeder einzelne Einstellungsdialog und das Verhalten auf einem Touchscreen. Das ist bewusst dein Sichttest.

### Rückbau

`UI-TEST-A-RUECKBAU.txt` liegt neben der EXE und im Build-Archiv. Der vorherige Stand liegt unverändert in `Build_2026-11-13_174900`; falls die neue Oberfläche gar nicht startet, kann diese EXE verwendet werden. Es gab keine Datenmigration.

## 3. App-Druckstart am AD5X

### Was bereits belegt ist

- Der AD5X startet Dateien über das Makro `SDCARD_PRINT_FILE`, nicht über Moonrakers `print/start`.
- Job **000099** wurde mit diesem Makro gestartet und in der Drucker-Historie als **completed** geführt (17:24–17:46, 21,9 min, 11,6 g).
- Der App-Pfad ist mit `scripts/check-ad5x-start.ts` gegen einen lokalen Moonraker-Stub geprüft:
  - Upload: `POST /server/files/upload?print=false`
  - Start: `POST /printer/gcode/script?script=SDCARD_PRINT_FILE%20FILENAME%3Dui-test.gcode`
  - Ergebnis: grün.

Das beweist die Reihenfolge und den Aufruf im App-Code, **nicht** den physischen Start durch die App.

### Noch offen

Der Coupon liegt auf dem Bett. Für den echten App-Test:

1. Coupon entfernen, Bett abkühlen lassen und die PEI-Fläche reinigen.
2. Kurzes, kleines Testteil über die App senden (z. B. 30 × 30 mm, 5 Schichten).
3. Prüfen, ob der Drucker in `print_stats` auf `printing` geht und sich die Düse bewegt.
4. Nach der ersten Schicht kannst du abbrechen, wenn nur der Start geprüft werden soll.

Keine Druckerkonfiguration wird dabei verändert. Für den Test brauche ich ein freies Bett und deine Freigabe.

## 4. Code-Review

### UI-Test A

- Beide Layouts bleiben im selben Code; die klassische Ansicht ist kein alter Build, sondern ein Zustand. Dadurch gibt es keine getrennten Datenpfade.
- `?ui=classic` und der Kopfschalter setzen denselben Zustand; die Auswahl wird nur lokal gespeichert.
- Eingebettete Panes (`?embedded=1`) bleiben bei der klassischen, kompakten Darstellung; der UI-Test ist dort nicht aktiv.
- Keine Funktion wurde entfernt: Slicen, Multiprint, Panes, Druckerleiste und Einstellungen bleiben erreichbar.
- **Risiko:** Die rechte Einstellungsspalte ist lang und scrollt bei 720 px Höhe stark. Das ist für den Test akzeptabel, aber ein Kandidat für einklappbare Gruppen.
- **Risiko:** Bei kleinen Fenstern stapeln die drei Spalten; das ist beabsichtigt, aber nicht gesondert durchgeklickt.

### Oberflächenschutz

- Der Deckschicht-Marker wird zu Beginn jeder Schicht zurückgesetzt; der Extra-Hub gilt nur für die markierten Deckschicht-Fahrten.
- Der Ironing-Mindestabstand wird nur bei aktivem Schutz angehoben, nicht global.
- Die volle Auflage unter der Deckschicht überlappt bewusst mit den unteren Schichten; der G-code-Prüflauf meldet keine offenen Konturen.
- **Grenze:** Der Test beweist keine unsichtbaren Mikrokratzer und keine Haftung auf jeder Geometrie. Die Aussage bleibt „keine sichtbaren Düsenkratzer bei aktiviertem Schutz“.

### AD5X-Start

- Die Sonderbehandlung ist auf `flashforge-ad5x` begrenzt; andere Klipper-Drucker behalten den normalen Upload-mit-Start.
- **Risiko:** Das Makro kann HTTP-success melden, bevor der physische Druck wirklich läuft. Eine Statusabfrage nach dem Start wäre die nächste Härtung; sie ist noch nicht eingebaut.
- Der physische App-Start bleibt bis zum Test mit freiem Bett offen.

## 5. Brainstorming für die nächste UI-Stufe

Nicht gebaut, nur gesammelt:

- **B – Kompakter Kopf:** Status und Druckerwahl in eine Zeile, Navigation in ein „Mehr“-Menü; gewinnt vertikalen Platz für die Vorschau.
- **C – Einklappbare Einstellungen:** rechts nur die zuletzt genutzte Gruppe, Rest als Akkordeon; Suche bleibt oben stehen.
- **D – Job-Leiste unten:** Ergebnis, Fortschritt und Warteschlange als feste Leiste; Vorschau wird höher.
- **E – Touch-Modus:** größere Ziele, Einstellungen als Bottom-Sheet, weniger gleichzeitige Spalten.
- **F – Geführter Ablauf:** oben eine kurze Schrittfolge „Objekt → Ziel → Prüfen → Senden“, die nur bei Bedarf Details öffnet.

## Prüfungen und Grenzen

| Prüfung | Ergebnis |
|---|---|
| TypeScript `--noEmit` | 0 |
| Vite-/EXE-Build | 0 |
| EXE Health / Beenden | 200 / 200 |
| `check-surface-guard.ts` | 6 Deckschichten, 162 Hübe, max. 0,60 mm |
| `check-ad5x-start.ts` | Upload ohne Start + `SDCARD_PRINT_FILE` grün |
| `check-printer-hub.ts` | grün |
| `check-connector-fit.ts` | grün |
| UI-Umschaltung im Browser | Test → Klassisch → Test grün |
| Physische Coupon-Oberfläche | **offen, deine Sichtprüfung** |
| Echter App-Druckstart | **offen, Bett belegt** |
| Webcam-Nachweis | 502, keine Aufnahme möglich |

Der Coupon darf erst als „keine sichtbaren Kratzer“ bezeichnet werden, wenn du die Oberseite geprüft hast. Der UI-Test ist ein Testbuild, kein endgültiger UI-Abschluss.
