# Windows-Prüfanleitung — Easy-Slicer by Becker 0.1.0

Geprüft am 7. November 2026 auf Windows x64.

## 1. Start

1. `Easy-Slicer-by-Becker.exe` doppelklicken.
2. Die Oberfläche öffnet sich unter `http://127.0.0.1:8787` (bei belegtem Port auf 8788, 8789 …).
3. Es darf kein Konsolenfenster erscheinen. Logs liegen unter
   `%LOCALAPPDATA%\Easy-Slicer-by-Becker\data\logs\easy-slicer.log`.

## 2. Bett und Modell

1. Im 3D-Bereich müssen Bett, Achsen und Druckraum sichtbar sein.
2. Auf **Würfel** klicken. Der Würfel muss auf dem Bett erscheinen und sich mit
   Maus ziehen, zoomen und drehen lassen.
3. Eine STL oder 3MF über **Modell laden** öffnen. Das Modell muss nach dem
   Import sichtbar und ausgewählt sein.

## 3. Einstellungen

1. Im linken Bereich die Reiter **Qualität | Struktur | Geschwindigkeit |
   Stützen | Mehrfarbig | Sonstige** prüfen.
2. Es ist immer genau ein Reiter aktiv; die Reiterleiste bleibt beim Scrollen
   oben stehen.
3. Labels müssen vollständig lesbar sein, z. B. **Erste Schicht Linie Breite**
   und **Schichthöhe erste Schicht** — nicht abgeschnitten.
4. Unter der Suchzeile einen Profilnamen eintragen und **Profil speichern**
   drücken. Das Profil muss mit einem Stern in der Auswahl erscheinen, sich
   auswählen lassen und die gespeicherten Qualitätswerte wiederherstellen.
   Ein gleicher Name überschreibt das vorhandene Profil.
5. Das eigene Profil auswählen, **Umbenennen** drücken, einen neuen Namen
   eintragen und bestätigen. Danach **Löschen** drücken und die Rückfrage
   bestätigen. Das Profil muss aus Auswahl und Kacheln verschwinden; die
   aktuellen Qualitätswerte bleiben erhalten. Ein bereits vergebener Name darf
   beim Umbenennen nicht doppelt angelegt werden.

## 4. Druckreihenfolge

Unter **Struktur → Druckreihenfolge** die drei echten Optionen prüfen:

* **Wände:** innen zuerst / außen zuerst
* **Schicht:** Wände zuerst / Füllung und Decklage zuerst
* **Wege:** kürzeste Wege / Erzeugungsreihenfolge

Geprüft am G-Code der zweiten Schicht:

| Einstellung | erste Bahnen |
| --- | --- |
| innen zuerst | `inner-wall`, `inner-wall`, `outer-wall` |
| außen zuerst | `outer-wall`, `inner-wall`, `inner-wall` |
| Füllung zuerst | `solid`, … vor den Wänden |

Alle drei Varianten erzeugen unterschiedlichen G-Code.

## 5. AD5X-Z-Mod-Postprocessing

Getestet mit
`C:\Users\Michael Becker\Desktop\3D Drucker\AD5X\zmod_preprocess-windows-amd64.exe`.

1. Drucker **FlashForge AD5X** wählen.
2. Unter **Post-Processing** die EXE auswählen, Argumente `{gcode}` eintragen und
   **erforderlich** aktivieren.
3. Würfel slicen.
4. Die erzeugte G-Code-Datei muss mit folgenden Zeilen beginnen:

   ```gcode
   ; MD5:4eef44080e3e2f6f1809883aea0adb0b
   ; zmod_color_data = 0||
   ```

5. Der Testlauf verarbeitete 100 Schichten und 274.390 Bytes in 34 ms.
   Der physische Druck auf dem AD5X war nicht Teil dieser Prüfung.

## 6. 4-Platten-3MF

Getestet mit `samurai angepasst 4 platten.3mf` (AD5X):

* Import über Dateiablage: **4 Platten**, **32 Bauteile**.
* Bettbreite 220 mm, Plattenabstand 20 mm: Gruppen zentriert bei
  **110 / 350 / 590 / 830 mm**; Hauptobjekte stehen auf **Z = 0**.
* Plattenreiter **1–4** vorhanden. Auswahl eines Objekts auf Platte 3
  schaltet automatisch auf Reiter 3; der Reiter „Platte 2“ wählt das erste
  sichtbare Objekt dieser Platte.
* Die importierten Druckeinstellungen (0,20 mm, 25 % Füllung) wurden übernommen.

## 7. Ergebnis

* TypeScript-Prüfung: erfolgreich
* Windows-EXE-Build: erfolgreich
* G-Code-Reihenfolge: alle drei Optionen wirksam
* AD5X-Preprocessor: Exit 0, MD5- und Farbdatenzeilen vorhanden
